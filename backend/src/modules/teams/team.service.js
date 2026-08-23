const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { createTokenPair, hashToken } = require("../../lib/tokens");
const {
  sendTeamInviteEmail,
  sendTeamInviteEmails,
} = require("../../lib/mail/sendTeamInviteEmail");
const { notifyInviteOnDiscord } = require("./invite-discord-notice");
const {
  removeUploadsQuietly,
  removeTeamLogoIfUnreferenced,
  scheduleTeamLogoCleanup,
} = require("../../lib/upload-cleanup");
const {
  persistTeamLogoUpload,
  teamLogoDirectory,
} = require("../../middleware/upload");
const {
  isValidEmail,
  normalizeEmail,
  normalizeText,
} = require("../../lib/validation");

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

const savedTeamInviteSelect = {
  id: true,
  name: true,
  email: true,
  emailNormalized: true,
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
const TEAM_INVITE_TTL_HOURS = 72;
const TEAM_INVITE_RESEND_COOLDOWN_SECONDS = 60;
const TEAM_SYNC_TRANSACTION_MAX_RETRIES = 4;
const TEAM_SYNC_TRANSACTION_MAX_WAIT_MS = 15 * 1000;
const TEAM_SYNC_TRANSACTION_TIMEOUT_MS = 30 * 1000;
const RETRYABLE_TEAM_SYNC_ERROR_CODES = new Set([
  "P2024",
  "P2028",
  "P2034",
  "P2037",
]);

const runRetryableTeamSyncOperation = async (work) => {
  for (let attempt = 1; attempt <= TEAM_SYNC_TRANSACTION_MAX_RETRIES; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const shouldRetry =
        RETRYABLE_TEAM_SYNC_ERROR_CODES.has(error?.code) &&
        attempt < TEAM_SYNC_TRANSACTION_MAX_RETRIES;
      if (!shouldRetry) throw error;

      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }

  throw new Error("Team synchronization transaction retry limit was exhausted.");
};

const runTeamSyncTransaction = async (work) =>
  runRetryableTeamSyncOperation(() =>
    prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: TEAM_SYNC_TRANSACTION_MAX_WAIT_MS,
      timeout: TEAM_SYNC_TRANSACTION_TIMEOUT_MS,
    })
  );

const mapSavedTeamMember = (member) => ({
  id: member.id,
  role: member.role,
  memberOrder: member.memberOrder,
  name: member.name,
  email: member.email,
  phone: member.phone,
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
  organizationName: team.organizationName || "Independent",
  logoName: team.logoName,
  logoUrl: team.logoName ? `/api/uploads/team-logos/${team.logoName}` : null,
  isCaptain: team.captainUserId === userId,
  registrationCount: team._count?.registrations || 0,
  canDelete: (team._count?.registrations || 0) === 0,
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

const mapSavedTeamInvitePreview = (member) => ({
  memberName: member.name,
  email: member.email,
  inviteStatus: member.inviteStatus,
  registrationId: null,
  team: {
    id: member.team.id,
    name: member.team.name,
    captainName:
      [member.team.captainUser.firstName, member.team.captainUser.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || member.team.captainUser.username,
    tournamentTitle: null,
  },
});

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
      _count: {
        select: { registrations: true },
      },
    },
  });

  return teams.map((team) => mapSavedTeam(team, user.id));
};

const MANAGEABLE_TEAM_MEMBER_ROLES = new Set(["PLAYER", "SUBSTITUTE", "COACH"]);

const parseStandaloneMembers = (value) => {
  let members;

  try {
    members = JSON.parse(String(value || "[]"));
  } catch {
    throw new HttpError(400, "Team members must be valid JSON.");
  }

  if (!Array.isArray(members) || members.length > 20) {
    throw new HttpError(400, "A team can include up to 20 invited members.");
  }

  const normalizedMembers = members.map((member) => {
    const role = normalizeText(member?.role).toUpperCase() || "PLAYER";
    if (!MANAGEABLE_TEAM_MEMBER_ROLES.has(role)) {
      throw new HttpError(400, "Team members must be players, substitutes, or coaches.");
    }

    return {
      role,
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
      phone: normalizeText(member?.phone) || null,
      discord: normalizeText(member?.discord) || null,
      riotId: normalizeText(member?.riotId) || null,
    };
  });

  if (normalizedMembers.filter((member) => member.role === "COACH").length > 1) {
    throw new HttpError(400, "A saved team can include at most one coach.");
  }

  if (
    normalizedMembers.some(
      (member) => !member.name || !isValidEmail(member.email)
        || member.name.length > 100
        || member.email.length > 254
        || (member.phone && member.phone.length > 50)
        || (member.discord && member.discord.length > 100)
        || (member.riotId && member.riotId.length > 100)
    )
  ) {
    throw new HttpError(400, "Each team member needs valid roster details.");
  }

  const uniqueEmails = new Set(normalizedMembers.map((member) => member.email));
  if (uniqueEmails.size !== normalizedMembers.length) {
    throw new HttpError(400, "Each team member must use a unique email address.");
  }

  return normalizedMembers;
};

const createSavedTeam = async ({ user, body, file }) => {
  const name = normalizeText(body.name);
  const country = normalizeText(body.country);
  const teamTag = normalizeText(body.teamTag);
  const organizationRequested = ["true", "1", "on"].includes(
    normalizeText(body.organizationRequested).toLowerCase()
  );
  const members = parseStandaloneMembers(body.members);
  const captainEmail = normalizeEmail(user.email);

  if (!name || !country || !teamTag || teamTag.length > 12) {
    throw new HttpError(400, "Team name, country, and a tag of up to 12 characters are required.");
  }

  if (members.some((member) => member.email === captainEmail)) {
    throw new HttpError(400, "The captain is already included in the member list.");
  }

  const persistedLogo = await persistTeamLogoUpload(file);
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username;
  const inviteDispatches = [];

  try {
    const team = await prisma.$transaction(async (tx) => {
      const createdTeam = await tx.savedTeam.create({
        data: {
          id: crypto.randomUUID(),
          captainUserId: user.id,
          name,
          country,
          teamTag,
          organizationRequested,
          logoName: persistedLogo?.filename || null,
        },
      });

      const memberOrders = { PLAYER: 0, SUBSTITUTE: 0, COACH: 0 };
      const memberRecords = [
        {
          id: crypto.randomUUID(),
          teamId: createdTeam.id,
          userId: user.id,
          role: "CAPTAIN",
          memberOrder: 0,
          name: captainName,
          email: captainEmail,
          emailNormalized: captainEmail,
          inviteStatus: "accepted",
          inviteRespondedAt: inviteSentAt,
        },
        ...members.map((member) => {
          memberOrders[member.role] += 1;
          const token = createTokenPair({ hours: TEAM_INVITE_TTL_HOURS });
          inviteDispatches.push({
            email: member.email,
            recipientName: member.name,
            teamName: name,
            captainName,
            tournamentTitle: null,
            rawToken: token.rawToken,
          });

          return {
            id: crypto.randomUUID(),
            teamId: createdTeam.id,
            role: member.role,
            memberOrder: memberOrders[member.role],
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
            phone: member.phone,
            discord: member.discord,
            riotId: member.riotId,
            inviteStatus: "pending",
            inviteTokenHash: token.tokenHash,
            inviteSentAt,
            inviteExpiresAt,
          };
        }),
      ];

      await tx.savedTeamMember.createMany({ data: memberRecords });

      return tx.savedTeam.findUnique({
        where: { id: createdTeam.id },
        include: {
          captainUser: {
            select: { firstName: true, lastName: true, username: true },
          },
          members: true,
          _count: {
            select: { registrations: true },
          },
        },
      });
    });

    await sendTeamInvites(inviteDispatches);
    return mapSavedTeam(team, user.id);
  } catch (error) {
    await removeUploadsQuietly(
      persistedLogo
        ? [{ directory: teamLogoDirectory, filename: persistedLogo.filename }]
        : [],
      { operation: "createSavedTeam", userId: user.id }
    );

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(400, "You already have a saved team with this name.");
    }

    throw error;
  }
};

const parseManagedMembers = (value) => {
  let members;

  try {
    members = JSON.parse(String(value || "[]"));
  } catch {
    throw new HttpError(400, "Team members must be valid JSON.");
  }

  if (!Array.isArray(members) || members.length > 20) {
    throw new HttpError(400, "A team can include up to 20 invited members.");
  }

  const roleCounts = { PLAYER: 0, SUBSTITUTE: 0, COACH: 0 };
  const normalizedMembers = members.map((member) => {
    const role = normalizeText(member?.role).toUpperCase() || "PLAYER";
    if (!MANAGEABLE_TEAM_MEMBER_ROLES.has(role)) {
      throw new HttpError(400, "Team members must be players, substitutes, or coaches.");
    }

    roleCounts[role] += 1;
    return {
      role,
      memberOrder: roleCounts[role],
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
      phone: normalizeText(member?.phone) || null,
      discord: normalizeText(member?.discord) || null,
      riotId: normalizeText(member?.riotId) || null,
    };
  });

  if (roleCounts.COACH > 1) {
    throw new HttpError(400, "A saved team can include at most one coach.");
  }

  if (
    normalizedMembers.some(
      (member) =>
        !member.name ||
        !isValidEmail(member.email) ||
        member.name.length > 100 ||
        member.email.length > 254 ||
        (member.phone && member.phone.length > 50) ||
        (member.discord && member.discord.length > 100) ||
        (member.riotId && member.riotId.length > 100)
    )
  ) {
    throw new HttpError(400, "Each team member needs valid roster details.");
  }

  const uniqueEmails = new Set(normalizedMembers.map((member) => member.email));
  if (uniqueEmails.size !== normalizedMembers.length) {
    throw new HttpError(400, "Each team member must use a unique email address.");
  }

  return normalizedMembers;
};

const updateSavedTeam = async ({ teamId, user, body, file }) => {
  const name = normalizeText(body.name);
  const country = normalizeText(body.country);
  const teamTag = normalizeText(body.teamTag);
  const organizationRequested = ["true", "1", "on"].includes(
    normalizeText(body.organizationRequested).toLowerCase()
  );
  const removeLogo = ["true", "1", "on"].includes(
    normalizeText(body.removeLogo).toLowerCase()
  );
  const members = parseManagedMembers(body.members);
  const captainEmail = normalizeEmail(user.email);

  if (!name || !country || !teamTag || teamTag.length > 12) {
    throw new HttpError(400, "Team name, country, and a tag of up to 12 characters are required.");
  }
  if (members.some((member) => member.email === captainEmail)) {
    throw new HttpError(400, "The captain is already included in the member list.");
  }

  const existingTeam = await runRetryableTeamSyncOperation(() =>
    prisma.savedTeam.findFirst({
      where: { id: teamId, captainUserId: user.id },
      include: {
        members: true,
      },
    })
  );
  if (!existingTeam) {
    throw new HttpError(404, "Team not found or you do not have permission to manage it.");
  }

  const persistedLogo = file ? await persistTeamLogoUpload(file) : null;
  const logoMutationRequested = Boolean(file) || removeLogo;
  const nextLogoName = file
    ? persistedLogo.filename
    : removeLogo
      ? null
      : existingTeam.logoName;
  const savedTeamData = { name, country, teamTag, organizationRequested };
  if (logoMutationRequested) savedTeamData.logoName = nextLogoName;
  // Record an explicit removal so the null logo reads as deliberate and a later
  // registration upload cannot resurrect it.
  if (logoMutationRequested && nextLogoName === null) savedTeamData.logoClearedAt = new Date();
  const existingMembersByEmail = new Map(
    existingTeam.members.map((member) => [member.emailNormalized, member])
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const inviteDispatches = [];

  const memberRecords = members.map((member) => {
    const existingMember = existingMembersByEmail.get(member.email);
    if (existingMember) {
      return {
        id: existingMember.id,
        teamId,
        userId: existingMember.userId,
        ...member,
        emailNormalized: member.email,
        inviteStatus: existingMember.inviteStatus,
        inviteTokenHash: existingMember.inviteTokenHash,
        inviteSentAt: existingMember.inviteSentAt,
        inviteExpiresAt: existingMember.inviteExpiresAt,
        inviteRespondedAt: existingMember.inviteRespondedAt,
      };
    }

    const token = createTokenPair({ hours: TEAM_INVITE_TTL_HOURS });
    inviteDispatches.push({
      email: member.email,
      recipientName: member.name,
      teamName: name,
      captainName,
      tournamentTitle: null,
      rawToken: token.rawToken,
    });
    return {
      id: crypto.randomUUID(),
      teamId,
      ...member,
      emailNormalized: member.email,
      inviteStatus: "pending",
      inviteTokenHash: token.tokenHash,
      inviteSentAt,
      inviteExpiresAt,
    };
  });

  try {
    const transactionResult = await runTeamSyncTransaction(async (tx) => {
      const currentTeam = logoMutationRequested
        ? await tx.savedTeam.findUnique({
            where: { id: teamId },
            select: { logoName: true },
          })
        : null;
      const previousLogoName = currentTeam?.logoName ?? null;

      await tx.savedTeam.update({
        where: { id: teamId },
        data: savedTeamData,
      });
      if (logoMutationRequested) {
        await tx.teamRegistration.updateMany({
          where: { savedTeamId: teamId },
          data: { teamLogoName: nextLogoName },
        });
      }
      await tx.savedTeamMember.deleteMany({
        where: { teamId, role: { not: "CAPTAIN" } },
      });
      if (memberRecords.length > 0) {
        await tx.savedTeamMember.createMany({ data: memberRecords });
      }

      if (previousLogoName && previousLogoName !== nextLogoName) {
        await scheduleTeamLogoCleanup({
          filename: previousLogoName,
          tx,
          context: { operation: "updateSavedTeam", teamId, userId: user.id },
        });
      }

      const team = await tx.savedTeam.findUnique({
        where: { id: teamId },
        include: {
          captainUser: {
            select: { firstName: true, lastName: true, username: true },
          },
          members: true,
          _count: {
            select: { registrations: true },
          },
        },
      });

      return { team, previousLogoName };
    });

    const { team } = transactionResult;
    await sendTeamInvites(inviteDispatches);
    return mapSavedTeam(team, user.id);
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "updateSavedTeamRollback", teamId, userId: user.id }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "A team or member already uses these details.");
    }
    throw error;
  }
};

const deleteSavedTeam = async ({ teamId, user }) => {
  const team = await prisma.savedTeam.findFirst({
    where: { id: teamId, captainUserId: user.id },
    select: {
      id: true,
      logoName: true,
      _count: { select: { registrations: true } },
    },
  });
  if (!team) {
    throw new HttpError(404, "Team not found or you do not have permission to delete it.");
  }
  if (team._count.registrations > 0) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has a tournament registration."
    );
  }

  const activeBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId: team.id, status: "active" },
    select: { id: true },
  });
  if (activeBinding) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first."
    );
  }

  await prisma.savedTeam.delete({ where: { id: team.id } });
  if (team.logoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: team.logoName,
      context: { operation: "deleteSavedTeam", teamId, userId: user.id },
    });
  }
};

const resendSavedTeamInvite = async ({ teamId, memberId, user, now = new Date() }) => {
  const member = await prisma.savedTeamMember.findFirst({
    where: {
      id: memberId,
      teamId,
      team: { captainUserId: user.id },
    },
    include: {
      team: {
        select: {
          name: true,
          captainUser: {
            select: { firstName: true, lastName: true, username: true },
          },
        },
      },
    },
  });

  if (!member) {
    throw new HttpError(404, "Team member not found or you do not have permission to manage this invite.");
  }
  if (member.role === "CAPTAIN" || !["pending", "declined"].includes(member.inviteStatus)) {
    throw new HttpError(409, "Only pending or declined team invitations can be sent again.");
  }

  const nextAllowedAt = member.inviteSentAt
    ? new Date(member.inviteSentAt).getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    : 0;
  if (nextAllowedAt > now.getTime()) {
    const retryAfterSeconds = Math.max(Math.ceil((nextAllowedAt - now.getTime()) / 1000), 1);
    throw new HttpError(429, `Wait ${retryAfterSeconds} seconds before resending this invitation.`, {
      retryAfterSeconds,
    });
  }

  const token = createTokenPair({ hours: TEAM_INVITE_TTL_HOURS });
  const inviteExpiresAt = new Date(
    now.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const relatedRegistrationMember = prisma.registrationMember?.findFirst
    ? await prisma.registrationMember.findFirst({
        where: {
          emailNormalized: member.emailNormalized,
          inviteStatus: { in: ["pending", "declined"] },
          registration: { savedTeamId: teamId },
        },
        orderBy: { createdAt: "desc" },
        include: { registration: { include: { tournament: { select: { title: true } } } } },
      })
    : null;

  const updatedMember = await prisma.$transaction(async (tx) => {
    const updated = await tx.savedTeamMember.update({
      where: { id: member.id },
      data: {
        userId: null,
        inviteStatus: "pending",
        inviteTokenHash: token.tokenHash,
        inviteSentAt: now,
        inviteExpiresAt,
        inviteRespondedAt: null,
      },
    });
    if (relatedRegistrationMember) {
      await tx.registrationMember.updateMany({
        where: { id: relatedRegistrationMember.id, inviteStatus: { in: ["pending", "declined"] } },
        data: {
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt: now,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      await refreshRegistrationVerificationStatus({
        tx,
        registrationId: relatedRegistrationMember.registration.id,
      });
    }
    return updated;
  });

  const captainName = [
    member.team.captainUser.firstName,
    member.team.captainUser.lastName,
  ].filter(Boolean).join(" ").trim() || member.team.captainUser.username;

  // Best effort, after the email is queued and never in its way: a DM that
  // cannot be delivered must not cost anyone their roster spot.
  void notifyInviteOnDiscord({
    userId: member.userId || null,
    emailNormalized: member.emailNormalized || null,
    recipientName: member.name,
    teamName: member.team.name,
    captainName,
    tournamentTitle: relatedRegistrationMember?.registration?.tournament?.title || null,
  }).then((result) => {
    logger.info("Discord invite notice attempted.", {
      teamId,
      memberId,
      delivered: result.delivered,
      reason: result.reason,
    });
  });

  try {
    await sendTeamInviteEmail({
      email: member.email,
      recipientName: member.name,
      teamName: member.team.name,
      captainName,
      tournamentTitle: relatedRegistrationMember?.registration?.tournament?.title || null,
      rawToken: token.rawToken,
    });
  } catch (error) {
    logger.error("Failed to resend team invite email.", {
      teamId,
      memberId,
      error,
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.savedTeamMember.updateMany({
          where: { id: member.id, inviteTokenHash: token.tokenHash },
          data: {
            userId: member.userId,
            inviteStatus: member.inviteStatus,
            inviteTokenHash: member.inviteTokenHash,
            inviteSentAt: member.inviteSentAt,
            inviteExpiresAt: member.inviteExpiresAt,
            inviteRespondedAt: member.inviteRespondedAt,
          },
        });
        if (relatedRegistrationMember) {
          await tx.registrationMember.updateMany({
            where: {
              id: relatedRegistrationMember.id,
              inviteTokenHash: token.tokenHash,
            },
            data: {
              userId: relatedRegistrationMember.userId,
              inviteStatus: relatedRegistrationMember.inviteStatus,
              inviteTokenHash: relatedRegistrationMember.inviteTokenHash,
              inviteSentAt: relatedRegistrationMember.inviteSentAt,
              inviteExpiresAt: relatedRegistrationMember.inviteExpiresAt,
              inviteRespondedAt: relatedRegistrationMember.inviteRespondedAt,
            },
          });
          await refreshRegistrationVerificationStatus({
            tx,
            registrationId: relatedRegistrationMember.registration.id,
          });
        }
      });
    } catch (rollbackError) {
      logger.error("Failed to restore a team invite after email dispatch failed.", {
        teamId,
        memberId,
        rollbackError,
      });
    }
    throw new HttpError(503, "The invitation could not be sent right now. Please try again later.");
  }

  return {
    member: mapSavedTeamMember(updatedMember),
    resendAvailableAt: new Date(
      now.getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    ),
  };
};

const refreshRegistrationVerificationStatus = async ({ tx, registrationId }) => {
  const members = await tx.registrationMember.findMany({
    where: { registrationId, role: { not: "CAPTAIN" } },
    select: { inviteStatus: true },
  });
  const verificationStatus = members.some((member) => member.inviteStatus === "declined")
    ? "flagged"
    : members.every((member) => member.inviteStatus === "accepted")
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

  if (member) {
    return mapInvitePreview(member);
  }

  const savedTeamMember = prisma.savedTeamMember?.findFirst
    ? await prisma.savedTeamMember.findFirst({
        where: {
          inviteTokenHash: hashToken(normalizedToken),
          inviteStatus: "pending",
          inviteExpiresAt: { gt: now },
        },
        select: savedTeamInviteSelect,
      })
    : null;

  if (!savedTeamMember) {
    throw new HttpError(400, "This team invite link is invalid or has expired.");
  }

  return mapSavedTeamInvitePreview(savedTeamMember);
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
    const savedTeamMember = prisma.savedTeamMember?.findFirst
      ? await prisma.savedTeamMember.findFirst({
          where: {
            inviteTokenHash: tokenHash,
            inviteStatus: "pending",
            inviteExpiresAt: { gt: now },
          },
          select: savedTeamInviteSelect,
        })
      : null;

    if (!savedTeamMember) {
      throw new HttpError(400, "This team invite link is invalid or has expired.");
    }

    if (normalizeEmail(user.email) !== savedTeamMember.emailNormalized) {
      throw new HttpError(
        403,
        `Sign in with the invited email address (${savedTeamMember.email}) to respond to this invite.`
      );
    }

    const inviteStatus = normalizedDecision === "accept" ? "accepted" : "declined";
    const inviteRespondedAt = new Date();
    const linkedUserId = inviteStatus === "accepted" ? user.id : null;
    const updatedMember = await prisma.$transaction(async (tx) => {
      const consumedInvite = await tx.savedTeamMember.updateMany({
        where: {
          id: savedTeamMember.id,
          inviteTokenHash: tokenHash,
          inviteStatus: "pending",
          inviteExpiresAt: { gt: new Date() },
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

      const linkedRegistrations = await tx.teamRegistration.findMany({
        where: { savedTeamId: savedTeamMember.team.id, paymentStatus: "unpaid" },
        select: { id: true },
      });
      await tx.registrationMember.updateMany({
        where: {
          emailNormalized: savedTeamMember.emailNormalized,
          inviteStatus: "pending",
          registration: {
            savedTeamId: savedTeamMember.team.id,
            paymentStatus: "unpaid",
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
      for (const registration of linkedRegistrations) {
        await refreshRegistrationVerificationStatus({
          tx,
          registrationId: registration.id,
        });
      }

      return tx.savedTeamMember.findUnique({
        where: { id: savedTeamMember.id },
        select: savedTeamInviteSelect,
      });
    });

    return {
      ...mapSavedTeamInvitePreview(updatedMember),
      inviteStatus,
    };
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

  // A linked saved team is authoritative for its logo, but a null logo means
  // two different things. `logoClearedAt` separates them: a team that has never
  // had a logo adopts the one a registration supplies, so a captain's upload is
  // actually displayed instead of being discarded and deleted below. A removal
  // the captain or an admin actually made stays canonical, so a stale
  // registration snapshot can never resurrect it, and an existing logo is never
  // overwritten.
  const existingLogoName = existingTeam?.logoName || null;
  const hasNeverHadLogo = Boolean(existingTeam) && !existingLogoName && !existingTeam.logoClearedAt;
  const adoptedLogoName = hasNeverHadLogo ? logoName || null : null;

  if (existingTeam) {
    await tx.savedTeam.update({
      where: { id: existingTeam.id },
      data: {
        country: country || null,
        teamTag: teamTag || null,
        organizationRequested: Boolean(organizationRequested),
        ...(adoptedLogoName ? { logoName: adoptedLogoName } : {}),
      },
    });
  }

  const effectiveLogoName = existingTeam
    ? existingLogoName || adoptedLogoName
    : logoName || null;

  const existingMembersByRosterPosition = new Map(
    (existingTeam?.members || [])
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
      const existingMember = existingMembersByRosterPosition.get(
        `${member.role}:${member.order}:${email}`
      );
      const acceptedMember =
        member.inviteStatus === "accepted"
          ? member
          : member.inviteStatus === "declined"
            ? null
            : existingMember?.inviteStatus === "accepted" && existingMember.userId
              ? existingMember
              : null;
      const activePendingMember =
        existingMember?.inviteStatus === "pending" &&
        existingMember.inviteTokenHash &&
        existingMember.inviteExpiresAt &&
        existingMember.inviteExpiresAt > inviteSentAt
          ? existingMember
          : null;

      if (member.role === "CAPTAIN" || acceptedMember) {
        const linkedUserId = member.role === "CAPTAIN" ? user.id : acceptedMember.userId || null;
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
          phone: member.phone || null,
          discord: member.discord,
          riotId: member.riotId,
          inviteStatus: "accepted",
          inviteTokenHash: null,
          inviteSentAt: acceptedMember?.inviteSentAt || null,
          inviteExpiresAt: null,
          inviteRespondedAt,
        };
      }

      if (member.inviteStatus === "declined") {
        const inviteRespondedAt = member.inviteRespondedAt || new Date();
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: null,
            inviteStatus: "declined",
            inviteTokenHash: null,
            inviteSentAt: member.inviteSentAt || null,
            inviteExpiresAt: null,
            inviteRespondedAt,
          },
        });

        return {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          phone: member.phone || null,
          discord: member.discord,
          riotId: member.riotId,
          inviteStatus: "declined",
          inviteTokenHash: null,
          inviteSentAt: member.inviteSentAt || null,
          inviteExpiresAt: null,
          inviteRespondedAt,
        };
      }

      if (activePendingMember) {
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: null,
            inviteStatus: "pending",
            inviteTokenHash: activePendingMember.inviteTokenHash,
            inviteSentAt: activePendingMember.inviteSentAt,
            inviteExpiresAt: activePendingMember.inviteExpiresAt,
            inviteRespondedAt: null,
          },
        });

        return {
          id: crypto.randomUUID(),
          teamId: team.id,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          phone: member.phone || null,
          discord: member.discord,
          riotId: member.riotId,
          inviteStatus: "pending",
          inviteTokenHash: activePendingMember.inviteTokenHash,
          inviteSentAt: activePendingMember.inviteSentAt,
          inviteExpiresAt: activePendingMember.inviteExpiresAt,
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
        phone: member.phone || null,
        discord: member.discord,
        riotId: member.riotId,
        inviteStatus: "pending",
        inviteTokenHash: token.tokenHash,
        inviteSentAt,
        inviteExpiresAt,
      };
    }),
  });

  if (existingTeam && logoName && logoName !== effectiveLogoName) {
    await scheduleTeamLogoCleanup({
      filename: logoName,
      tx,
      context: {
        operation: "syncSavedTeamFromRegistration",
        registrationId,
        teamId: team.id,
      },
    });
  }

  await tx.teamRegistration.update({
    where: { id: registrationId },
    data: { savedTeamId: team.id, teamLogoName: effectiveLogoName },
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
  if (inviteDispatches.length === 0) return;

  if (typeof sendTeamInviteEmails === "function") {
    try {
      await sendTeamInviteEmails(inviteDispatches);
    } catch (error) {
      logger.error("Failed to queue team invite emails.", {
        inviteCount: inviteDispatches.length,
        error,
      });
    }
    return;
  }

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

const syncTeamRegistrationToProfile = async ({ registrationId, requirePaid }) => {
  const registration = await runRetryableTeamSyncOperation(() =>
    prisma.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        user: true,
        tournament: { select: { title: true } },
        members: { orderBy: { memberOrder: "asc" } },
      },
    })
  );
  if (
    !registration ||
    registration.entryType !== "team" ||
    (requirePaid && registration.paymentStatus !== "paid") ||
    registration.savedTeamId ||
    !registration.user
  ) {
    return;
  }

  const members = registration.members.map((member) => ({
    role: member.role,
    order: member.memberOrder,
    name: member.name,
    email: member.email,
    phone: member.phone,
    discord: member.discord,
    riotId: member.riotId,
    userId: member.userId,
    inviteStatus: member.inviteStatus,
    inviteSentAt: member.inviteSentAt,
    inviteExpiresAt: member.inviteExpiresAt,
    inviteRespondedAt: member.inviteRespondedAt,
  }));
  const inviteDispatches = await runTeamSyncTransaction(async (tx) => {
    const current = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: { savedTeamId: true, paymentStatus: true, members: true },
    });
    if (
      !current ||
      current.savedTeamId ||
      (requirePaid && current.paymentStatus !== "paid")
    ) return [];
    return syncSavedTeamFromRegistration({
      tx,
      registrationId,
      user: registration.user,
      teamName: registration.teamName,
      country: registration.country,
      teamTag: registration.teamTag,
      organizationRequested: registration.organizationRequested,
      logoName: registration.teamLogoName,
      members: Array.isArray(current.members)
        ? current.members.map((member) => ({
            role: member.role,
            order: member.memberOrder,
            name: member.name,
            email: member.email,
            phone: member.phone,
            discord: member.discord,
            riotId: member.riotId,
            userId: member.userId,
            inviteStatus: member.inviteStatus,
            inviteSentAt: member.inviteSentAt,
            inviteExpiresAt: member.inviteExpiresAt,
            inviteRespondedAt: member.inviteRespondedAt,
          }))
        : members,
      tournamentTitle: registration.tournament.title,
    });
  });
  await sendTeamInvites(inviteDispatches);
};

const ensureTeamRegistrationSaved = async (registrationId) =>
  syncTeamRegistrationToProfile({ registrationId, requirePaid: false });

const activatePaidTeamRegistration = async (registrationId) =>
  syncTeamRegistrationToProfile({ registrationId, requirePaid: true });

module.exports = {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
  resendSavedTeamInvite,
  getTeamInvitePreview,
  respondToTeamInvite,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
  ensureTeamRegistrationSaved,
  activatePaidTeamRegistration,
  refreshRegistrationVerificationStatus,
};
