const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { createTokenPair, hashToken } = require("../../lib/tokens");
const { sendTeamInviteEmail } = require("../../lib/mail/sendTeamInviteEmail");
const { normalizeEmail, normalizeText } = require("../../lib/validation");

const invitePreviewSelect = {
  id: true,
  name: true,
  email: true,
  inviteStatus: true,
  team: {
    select: {
      id: true,
      name: true,
      captainUser: {
        select: {
          firstName: true,
          lastName: true,
          username: true,
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

const mapSavedTeam = (team) => ({
  id: team.id,
  name: team.name,
  logoName: team.logoName,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
  members: (team.members || [])
    .slice()
    .sort((left, right) => {
      if (left.role !== right.role) {
        return (ROLE_SORT_ORDER[left.role] || 99) - (ROLE_SORT_ORDER[right.role] || 99);
      }

      return left.memberOrder - right.memberOrder;
    })
    .map(mapSavedTeamMember),
});

const mapInvitePreview = (member) => {
  const captainName = [member.team.captainUser.firstName, member.team.captainUser.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    memberName: member.name,
    email: member.email,
    inviteStatus: member.inviteStatus,
    team: {
      id: member.team.id,
      name: member.team.name,
      captainName: captainName || member.team.captainUser.username,
    },
  };
};

const listProfileTeams = async ({ user }) => {
  const teams = await prisma.savedTeam.findMany({
    where: {
      captainUserId: user.id,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
      },
    },
  });

  return teams.map(mapSavedTeam);
};

const getTeamInvitePreview = async ({ token }) => {
  const normalizedToken = normalizeText(token);

  if (!normalizedToken) {
    throw new HttpError(400, "Team invite token is required.");
  }

  const member = await prisma.savedTeamMember.findFirst({
    where: {
      inviteTokenHash: hashToken(normalizedToken),
    },
    select: invitePreviewSelect,
  });

  if (!member) {
    throw new HttpError(400, "This team invite link is invalid or has expired.");
  }

  return mapInvitePreview(member);
};

const respondToTeamInvite = async ({ token, decision }) => {
  const normalizedToken = normalizeText(token);
  const normalizedDecision = normalizeText(decision).toLowerCase();

  if (!normalizedToken) {
    throw new HttpError(400, "Team invite token is required.");
  }

  if (!["accept", "decline"].includes(normalizedDecision)) {
    throw new HttpError(400, "A valid invite decision is required.");
  }

  const member = await prisma.savedTeamMember.findFirst({
    where: {
      inviteTokenHash: hashToken(normalizedToken),
    },
    select: invitePreviewSelect,
  });

  if (!member) {
    throw new HttpError(400, "This team invite link is invalid or has expired.");
  }

  if (member.inviteStatus !== "pending") {
    return {
      ...mapInvitePreview(member),
      inviteStatus: member.inviteStatus,
    };
  }

  const inviteStatus = normalizedDecision === "accept" ? "accepted" : "declined";
  const inviteRespondedAt = new Date();

  const updatedMember = await prisma.savedTeamMember.update({
    where: { id: member.id },
    data: {
      inviteStatus,
      inviteRespondedAt,
      inviteTokenHash: null,
    },
    select: invitePreviewSelect,
  });

  return {
    ...mapInvitePreview(updatedMember),
    inviteStatus,
  };
};

const syncSavedTeamFromRegistration = async ({
  tx,
  user,
  teamName,
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
        ...(logoName ? { logoName } : {}),
      },
    });
  }

  const existingAcceptedMembers = new Map(
    (existingTeam?.members || [])
      .filter((member) => member.inviteStatus === "accepted")
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
  const inviteSentAt = new Date();
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;

  await tx.savedTeamMember.createMany({
    data: members.map((member) => {
      const email = normalizeEmail(member.email);
      const acceptedMember = existingAcceptedMembers.get(
        `${member.role}:${member.order}:${email}`
      );

      if (member.role === "CAPTAIN" || acceptedMember) {
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
          inviteStatus: "accepted",
          inviteSentAt: acceptedMember?.inviteSentAt || null,
          inviteRespondedAt: acceptedMember?.inviteRespondedAt || new Date(),
        };
      }

      const token = createTokenPair({ hours: 72 });
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
      };
    }),
  });

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
};
