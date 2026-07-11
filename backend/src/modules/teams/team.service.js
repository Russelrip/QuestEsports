const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { createTokenPair, hashToken } = require("../../lib/tokens");
const { sendTeamInviteEmail } = require("../../lib/mail/sendTeamInviteEmail");
const { normalizeEmail, normalizeText } = require("../../lib/validation");

const invitePreviewSelect = {
  id: true,
  role: true,
  memberOrder: true,
  name: true,
  email: true,
  emailNormalized: true,
  inviteStatus: true,
  registration: {
    select: {
      id: true,
      teamName: true,
      captainName: true,
      savedTeamId: true,
      tournament: {
        select: {
          title: true,
        },
      },
    },
  },
};

const ROLE_SORT_ORDER = {
  CAPTAIN: 0,
  PLAYER: 1,
  SUBSTITUTE: 2,
  COACH: 3,
};
const TEAM_INVITE_TTL_HOURS = 72;

const mapSavedTeamMember = (member) => ({
  id: member.id,
  role: member.role,
  memberOrder: member.memberOrder,
  name: member.name,
  email: member.email,
  discord: member.discord,
  riotId: member.riotId,
  inviteStatus: member.inviteStatus,
  inviteSentAt: member.inviteSentAt,
  inviteRespondedAt: member.inviteRespondedAt,
});

const mapSavedTeam = (team, userId) => ({
  id: team.id,
  name: team.name,
  country: team.country,
  teamTag: team.teamTag,
  organizationRequested: team.organizationRequested,
  logoName: team.logoName,
  isCaptain: team.captainUserId === userId,
  captainName:
    [team.captainUser.firstName, team.captainUser.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || team.captainUser.username,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
  members: (team.members || [])
    .slice()
    .sort((left, right) => {
      if (left.role !== right.role) {
        return (ROLE_SORT_ORDER[left.role] ?? 99) - (ROLE_SORT_ORDER[right.role] ?? 99);
      }

      return left.memberOrder - right.memberOrder;
    })
    .map(mapSavedTeamMember),
});

const mapInvitePreview = (member) => {
  return {
    memberName: member.name,
    email: member.email,
    inviteStatus: member.inviteStatus,
    registrationId: member.registration.id,
    team: {
      id: member.registration.savedTeamId || member.registration.id,
      name: member.registration.teamName,
      captainName: member.registration.captainName,
      tournamentTitle: member.registration.tournament.title,
    },
  };
};

const listProfileTeams = async ({ user }) => {
  const teams = await prisma.savedTeam.findMany({
    where: {
      OR: [
        { captainUserId: user.id },
        {
          members: {
            some: {
              userId: user.id,
              inviteStatus: "accepted",
            },
          },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      captainUser: {
        select: {
          firstName: true,
          lastName: true,
          username: true,
        },
      },
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
      },
    },
  });

  return teams.map((team) => mapSavedTeam(team, user.id));
};

const refreshRegistrationVerificationStatus = async ({ tx, registrationId }) => {
  const members = await tx.registrationMember.findMany({
    where: { registrationId },
    select: { inviteStatus: true },
  });
  const verificationStatus = members.some((member) => member.inviteStatus === "declined")
    ? "flagged"
    : members.length > 0 && members.every((member) => member.inviteStatus === "accepted")
      ? "verified"
      : "pending";

  await tx.teamRegistration.update({
    where: { id: registrationId },
    data: { verificationStatus },
  });

  return verificationStatus;
};

const getTeamInvitePreview = async ({ token }) => {
  const normalizedToken = normalizeText(token);
  const now = new Date();

  if (!normalizedToken) {
    throw new HttpError(400, "Team invite token is required.");
  }

  const member = await prisma.registrationMember.findFirst({
    where: {
      inviteTokenHash: hashToken(normalizedToken),
      inviteStatus: "pending",
      inviteExpiresAt: {
        gt: now,
      },
    },
    select: invitePreviewSelect,
  });

  if (!member) {
    throw new HttpError(400, "This team invite link is invalid or has expired.");
  }

  return mapInvitePreview(member);
};

const respondToTeamInvite = async ({ token, decision, user }) => {
  const normalizedToken = normalizeText(token);
  const tokenHash = normalizedToken ? hashToken(normalizedToken) : "";
  const normalizedDecision = normalizeText(decision).toLowerCase();
  const now = new Date();

  if (!normalizedToken) {
    throw new HttpError(400, "Team invite token is required.");
  }

  if (!["accept", "decline"].includes(normalizedDecision)) {
    throw new HttpError(400, "A valid invite decision is required.");
  }

  if (!user) {
    throw new HttpError(401, "Create an account or sign in before responding to this invite.");
  }

  if (!user.emailVerified) {
    throw new HttpError(403, "Verify your account email before responding to this invite.");
  }

  const member = await prisma.registrationMember.findFirst({
    where: {
      inviteTokenHash: tokenHash,
      inviteStatus: "pending",
      inviteExpiresAt: {
        gt: now,
      },
    },
    select: invitePreviewSelect,
  });

  if (!member) {
    throw new HttpError(400, "This team invite link is invalid or has expired.");
  }

  if (normalizeEmail(user.email) !== member.emailNormalized) {
    throw new HttpError(
      403,
      `Sign in with the invited email address (${member.email}) to respond to this invite.`
    );
  }

  const inviteStatus = normalizedDecision === "accept" ? "accepted" : "declined";
  const inviteRespondedAt = new Date();
  const linkedUserId = inviteStatus === "accepted" ? user.id : null;
  const updatedMember = await prisma.$transaction(async (tx) => {
    const consumedInvite = await tx.registrationMember.updateMany({
      where: {
        id: member.id,
        inviteTokenHash: tokenHash,
        inviteStatus: "pending",
        inviteExpiresAt: {
          gt: new Date(),
        },
      },
      data: {
        userId: linkedUserId,
        inviteStatus,
        inviteRespondedAt,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });

    if (consumedInvite.count === 0) {
      throw new HttpError(400, "This team invite link is invalid or has expired.");
    }

    if (member.registration.savedTeamId) {
      await tx.savedTeamMember.updateMany({
        where: {
          teamId: member.registration.savedTeamId,
          role: member.role,
          memberOrder: member.memberOrder,
          emailNormalized: member.emailNormalized,
        },
        data: {
          userId: linkedUserId,
          inviteStatus,
          inviteRespondedAt,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
    }

    await refreshRegistrationVerificationStatus({
      tx,
      registrationId: member.registration.id,
    });

    const updatedRegistrationMember = await tx.registrationMember.findUnique({
      where: { id: member.id },
      select: invitePreviewSelect,
    });

    if (!updatedRegistrationMember) {
      throw new HttpError(400, "This team invite link is invalid or has expired.");
    }

    return updatedRegistrationMember;
  });

  return {
    ...mapInvitePreview(updatedMember),
    inviteStatus,
  };
};

const syncSavedTeamFromRegistration = async ({
  tx,
  registrationId,
  user,
  teamName,
  country,
  teamTag,
  organizationRequested,
  logoName,
  members,
  tournamentTitle,
}) => {
  const normalizedTeamName = normalizeText(teamName);

  const existingTeam = await tx.savedTeam.findUnique({
    where: {
      captainUserId_name: {
        captainUserId: user.id,
        name: normalizedTeamName,
      },
    },
    include: {
      members: true,
    },
  });

  const team =
    existingTeam ||
    (await tx.savedTeam.create({
      data: {
        id: crypto.randomUUID(),
        captainUserId: user.id,
        name: normalizedTeamName,
        country: country || null,
        teamTag: teamTag || null,
        organizationRequested: Boolean(organizationRequested),
        logoName: logoName || null,
      },
      include: {
        members: true,
      },
    }));

  if (existingTeam) {
    await tx.savedTeam.update({
      where: { id: existingTeam.id },
      data: {
        country: country || null,
        teamTag: teamTag || null,
        organizationRequested: Boolean(organizationRequested),
        ...(logoName ? { logoName } : {}),
      },
    });
  }

  const existingAcceptedMembers = new Map(
    (existingTeam?.members || [])
      .filter((member) => member.inviteStatus === "accepted" && member.userId)
      .map((member) => [
        `${member.role}:${member.memberOrder}:${member.emailNormalized}`,
        member,
      ])
  );

  await tx.savedTeamMember.deleteMany({
    where: {
      teamId: team.id,
    },
  });

  const inviteDispatches = [];
  const registrationMemberUpdates = [];
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;

  await tx.savedTeamMember.createMany({
    data: members.map((member) => {
      const email = normalizeEmail(member.email);
      const acceptedMember = existingAcceptedMembers.get(
        `${member.role}:${member.order}:${email}`
      );

      if (member.role === "CAPTAIN" || acceptedMember) {
        const linkedUserId = member.role === "CAPTAIN" ? user.id : acceptedMember.userId;
        const inviteRespondedAt = acceptedMember?.inviteRespondedAt || new Date();
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: linkedUserId,
            inviteStatus: "accepted",
            inviteTokenHash: null,
            inviteSentAt: acceptedMember?.inviteSentAt || null,
            inviteExpiresAt: null,
            inviteRespondedAt,
          },
        });

        return {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: linkedUserId,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          discord: member.discord,
          riotId: member.riotId,
          inviteStatus: "accepted",
          inviteSentAt: acceptedMember?.inviteSentAt || null,
          inviteExpiresAt: null,
          inviteRespondedAt,
        };
      }

      const token = createTokenPair({ hours: 72 });
      registrationMemberUpdates.push({
        role: member.role,
        memberOrder: member.order,
        data: {
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: token.tokenHash,
          inviteSentAt,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      inviteDispatches.push({
        email,
        recipientName: member.name,
        teamName: normalizedTeamName,
        captainName,
        tournamentTitle,
        rawToken: token.rawToken,
      });

      return {
        id: crypto.randomUUID(),
        teamId: team.id,
        role: member.role,
        memberOrder: member.order,
        name: member.name,
        email,
        emailNormalized: email,
        discord: member.discord,
        riotId: member.riotId,
        inviteStatus: "pending",
        inviteTokenHash: token.tokenHash,
        inviteSentAt,
        inviteExpiresAt,
      };
    }),
  });

  await tx.teamRegistration.update({
    where: { id: registrationId },
    data: { savedTeamId: team.id },
  });

  for (const member of registrationMemberUpdates) {
    await tx.registrationMember.update({
      where: {
        registrationId_role_memberOrder: {
          registrationId,
          role: member.role,
          memberOrder: member.memberOrder,
        },
      },
      data: member.data,
    });
  }

  await refreshRegistrationVerificationStatus({ tx, registrationId });

  return inviteDispatches;
};

const sendTeamInvites = async (inviteDispatches) => {
  await Promise.allSettled(
    inviteDispatches.map(async (invite) => {
      try {
        await sendTeamInviteEmail(invite);
      } catch (error) {
        logger.error("Failed to send team invite email.", {
          email: invite.email,
          teamName: invite.teamName,
          error,
        });
      }
    })
  );
};

module.exports = {
  listProfileTeams,
  getTeamInvitePreview,
  respondToTeamInvite,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
  refreshRegistrationVerificationStatus,
};
