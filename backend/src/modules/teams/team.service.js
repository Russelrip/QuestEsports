const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { notifyInvite, notifyInvites } = require("./invite-notice.service");
const {
  refreshRegistrationVerificationStatus,
} = require("./registration-verification");
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

const ROLE_SORT_ORDER = {
  CAPTAIN: 0,
  PLAYER: 1,
  SUBSTITUTE: 2,
  COACH: 3,
};
const TEAM_INVITE_TTL_HOURS = 72;
// What a captain may send again. Accepted is deliberately absent: that spot is
// taken, and reopening it would unseat someone who already said yes.
const NUDGEABLE_INVITE_STATUSES = ["pending", "declined", "expired"];
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

// `phone`, `discord` and `riotId` are read, never written. They are whatever a
// captain typed into an older version of this form, kept so an existing team
// does not appear to lose data — but `attachRosterReadiness` overwrites
// `discord` with the accepting account's own handle wherever there is one,
// because a guess about somebody else's Discord and their actual connected
// account are not interchangeable and only one of them can be relied on.
const mapSavedTeamMember = (member) => ({
  id: member.id,
  role: member.role,
  memberOrder: member.memberOrder,
  userId: member.userId || null,
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

// Why a roster is not confirming yet, resolved for every member at once.
//
// A captain whose registration will not go through can otherwise only see that
// somebody has not accepted — not that the person has no Quest account, or has
// one but has never connected Discord and so cannot accept even if they wanted
// to. Those are different problems with different fixes, and only the captain
// is in a position to go and chase either of them.
//
// Resolved by the account the row is linked to, or by a verified address — the
// same two identities the invitation itself is answered by. An unverified
// address proves nothing about who controls it, and the link is checked first
// because someone who accepted and later changed their account email is still
// the person on this roster.
//
// It is also where the roster's Discord handle comes from. A captain used to
// type it, which meant it could say anything at all; the accepting user's own
// connected account is the only version of it that is true by construction, so
// it replaces whatever an older team stored.
const attachRosterReadiness = async (teams) => {
  const allMembers = teams.flatMap((team) => team.members || []);
  const emails = [
    ...new Set(allMembers.map((member) => normalizeEmail(member.email)).filter(Boolean)),
  ];
  const linkedUserIds = [...new Set(allMembers.map((member) => member.userId).filter(Boolean))];

  // Narrow client projections cannot read accounts back. Readiness is an
  // addition to the roster, never a precondition for returning it, so a scope
  // that cannot look one up reports nothing rather than failing the caller —
  // the same pattern the registration-member lookups here already use.
  if (
    (emails.length === 0 && linkedUserIds.length === 0) ||
    typeof prisma.user?.findMany !== "function"
  ) return teams;

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { emailNormalized: { in: emails }, emailVerified: true },
        { id: { in: linkedUserIds } },
      ],
    },
    select: { id: true, emailNormalized: true, emailVerified: true, discordTag: true },
  });
  const discordLinked = users.length > 0 && typeof prisma.oAuthAccount?.findMany === "function"
    ? await prisma.oAuthAccount.findMany({
      where: { userId: { in: users.map((account) => account.id) }, provider: "discord" },
      select: { userId: true },
    })
    : [];
  const discordUserIds = new Set(discordLinked.map((account) => account.userId));
  // A handle only replaces the stored one when there is a handle to replace it
  // with. An account that has never connected Discord would otherwise blank out
  // whatever an older team was carrying, which loses data to say nothing.
  const presentAccount = (account) => ({
    hasQuestAccount: true,
    hasDiscord: discordUserIds.has(account.id),
    ...(account.discordTag ? { discord: account.discordTag } : {}),
  });
  const accountsById = new Map(users.map((account) => [account.id, account]));
  const verifiedAccountsByEmail = new Map(
    users
      .filter((account) => account.emailVerified && account.emailNormalized)
      .map((account) => [account.emailNormalized, account])
  );

  return teams.map((team) => ({
    ...team,
    members: (team.members || []).map((member) => {
      const account =
        (member.userId ? accountsById.get(member.userId) : null) ||
        verifiedAccountsByEmail.get(normalizeEmail(member.email)) ||
        null;
      // The join key, not something the roster needs to publish: a captain is
      // told whether a teammate has an account, not what its id is.
      const presented = { ...member };
      delete presented.userId;

      return {
        ...presented,
        ...(account
          ? presentAccount(account)
          : { hasQuestAccount: false, hasDiscord: false }),
      };
    }),
  }));
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
      _count: {
        select: { registrations: true },
      },
    },
  });

  return attachRosterReadiness(teams.map((team) => mapSavedTeam(team, user.id)));
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

    // Role, name and email, and nothing else. Anything a captain typed about
    // somebody's Discord or game identity is that captain's guess about another
    // person's account; the accepting user's own linked account is the only
    // honest source for it. See parseManagedMembers for what happens to values
    // an older team already carries.
    return {
      role,
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
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

  // Every team Quest holds should be able to appear on a bracket, an overlay or
  // a match card, and that needs a logo. Requiring it at creation is the only
  // point where no captain is stranded: there is nothing saved yet to lose.
  // Teams created before this rule keep working, and are caught at the door by
  // `assertTeamLogoAvailable` when they register for a tournament.
  if (!file) {
    throw new HttpError(400, "A team logo is required. Upload a square image, ideally 300x300.");
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
          // The row id is the invitation. Generated here rather than by the
          // database so the notice can name the thing it is pointing at.
          const memberId = crypto.randomUUID();
          inviteDispatches.push({
            invitationId: memberId,
            emailNormalized: member.email,
            recipientName: member.name,
            teamName: name,
            captainName,
            tournamentTitle: null,
            sentAt: inviteSentAt,
          });

          return {
            id: memberId,
            teamId: createdTeam.id,
            role: member.role,
            memberOrder: memberOrders[member.role],
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
            inviteStatus: "pending",
            inviteTokenHash: null,
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
    const [readyTeam] = await attachRosterReadiness([mapSavedTeam(team, user.id)]);
    return readyTeam;
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
        member.email.length > 254
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

  // A logo can be swapped, but not dropped: clearing it would walk a team back
  // out of the rule creation enforces. Replacing counts as keeping one, so a
  // removal paired with an upload is still fine.
  if (removeLogo && !file) {
    throw new HttpError(400, "A team logo is required. Upload a replacement instead of removing it.");
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
        // Carried, not re-collected. These rows are deleted and recreated on
        // every save, so dropping the columns here would erase what an older
        // team already holds — but nothing new is ever written into them, and
        // the form no longer offers them.
        phone: existingMember.phone,
        discord: existingMember.discord,
        riotId: existingMember.riotId,
        emailNormalized: member.email,
        inviteStatus: existingMember.inviteStatus,
        // Dropped rather than carried over. Any hash still on an old row
        // authorizes nothing now, and a secret that has stopped meaning
        // anything is not worth keeping a copy of.
        inviteTokenHash: null,
        inviteSentAt: existingMember.inviteSentAt,
        inviteExpiresAt: existingMember.inviteExpiresAt,
        inviteRespondedAt: existingMember.inviteRespondedAt,
      };
    }

    const memberId = crypto.randomUUID();
    inviteDispatches.push({
      invitationId: memberId,
      emailNormalized: member.email,
      recipientName: member.name,
      teamName: name,
      captainName,
      tournamentTitle: null,
      sentAt: inviteSentAt,
    });
    return {
      id: memberId,
      teamId,
      ...member,
      emailNormalized: member.email,
      inviteStatus: "pending",
      inviteTokenHash: null,
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
    const [readyTeam] = await attachRosterReadiness([mapSavedTeam(team, user.id)]);
    return readyTeam;
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

// A captain nudging someone who has not answered yet.
//
// This used to mint a fresh token and send an email, which made it the only way
// to repair an invitation that had gone astray — and made every repair cost a
// delivery. There is nothing to repair now: the invitation is a row the invitee
// can already find. So this reopens the window and says so again over the free
// channels, and reports what it actually reached rather than claiming it sent
// something.
//
// A captain who cannot be reached any of those ways is told to send the link
// themselves. They are teammates; they already have a way to talk.
const nudgeTeamInvite = async ({ teamId, memberId, user, now = new Date() }) => {
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
  if (member.role === "CAPTAIN" || !NUDGEABLE_INVITE_STATUSES.includes(member.inviteStatus)) {
    throw new HttpError(409, "Only an unanswered invitation can be sent again.");
  }

  const nextAllowedAt = member.inviteSentAt
    ? new Date(member.inviteSentAt).getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    : 0;
  if (nextAllowedAt > now.getTime()) {
    const retryAfterSeconds = Math.max(Math.ceil((nextAllowedAt - now.getTime()) / 1000), 1);
    throw new HttpError(429, `Wait ${retryAfterSeconds} seconds before sending this invitation again.`, {
      retryAfterSeconds,
    });
  }

  const inviteExpiresAt = new Date(
    now.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const relatedRegistrationMember = prisma.registrationMember?.findFirst
    ? await prisma.registrationMember.findFirst({
        where: {
          emailNormalized: member.emailNormalized,
          inviteStatus: { in: NUDGEABLE_INVITE_STATUSES },
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
        inviteTokenHash: null,
        inviteSentAt: now,
        inviteExpiresAt,
        inviteRespondedAt: null,
      },
    });
    if (relatedRegistrationMember) {
      await tx.registrationMember.updateMany({
        where: { id: relatedRegistrationMember.id, inviteStatus: { in: NUDGEABLE_INVITE_STATUSES } },
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

  // Awaited, unlike the old fire-and-forget DM, because what it reached is the
  // answer the captain is waiting for. It still cannot fail the nudge: the
  // window has already been reopened and the invitation is already findable.
  const delivery = await notifyInvite({
    invitationId: member.id,
    userId: member.userId || null,
    emailNormalized: member.emailNormalized || null,
    recipientName: member.name,
    teamName: member.team.name,
    captainName,
    tournamentTitle: relatedRegistrationMember?.registration?.tournament?.title || null,
    sentAt: now,
  });

  logger.info("Team invite nudge sent.", {
    teamId,
    memberId,
    inApp: delivery.inApp,
    discord: delivery.discord,
    hasQuestAccount: delivery.hasQuestAccount,
  });

  return {
    member: mapSavedTeamMember(updatedMember),
    delivery,
    resendAvailableAt: new Date(
      now.getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    ),
  };
};

// Mirrors a tournament roster into the saved team that outlives it.
//
// What crosses over is the roster itself — who is on it, in what role, and
// where their invitation stands. The game identifier does not. It was collected
// because that tournament's rules asked for it, it is already recorded on the
// registration member and in the registration's own snapshot, and copying it
// here would make it a property of the team: reused, unasked, the next time the
// same roster enters something for a different game entirely.
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
      // These rows are deleted and recreated on every sync. Carrying the id
      // over keeps an outstanding invitation the same invitation, rather than
      // one that changes identity underneath the notices pointing at it.
      const memberId = existingMember?.id || crypto.randomUUID();
      const acceptedMember =
        member.inviteStatus === "accepted"
          ? member
          : member.inviteStatus === "declined"
            ? null
            : existingMember?.inviteStatus === "accepted" && existingMember.userId
              ? existingMember
              : null;
      // Still outstanding because nobody answered it and it has not run out
      // — not because a token still exists for it. Reissuing an invitation that
      // is already live would only re-notify someone already told.
      const activePendingMember =
        existingMember?.inviteStatus === "pending" &&
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
          id: memberId,
          teamId: team.id,
          userId: linkedUserId,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
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
          id: memberId,
          teamId: team.id,
          userId: null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
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
            inviteTokenHash: null,
            inviteSentAt: activePendingMember.inviteSentAt,
            inviteExpiresAt: activePendingMember.inviteExpiresAt,
            inviteRespondedAt: null,
          },
        });

        return {
          id: memberId,
          teamId: team.id,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt: activePendingMember.inviteSentAt,
          inviteExpiresAt: activePendingMember.inviteExpiresAt,
        };
      }

      registrationMemberUpdates.push({
        role: member.role,
        memberOrder: member.order,
        data: {
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      inviteDispatches.push({
        invitationId: memberId,
        emailNormalized: email,
        recipientName: member.name,
        teamName: normalizedTeamName,
        captainName,
        tournamentTitle,
        sentAt: inviteSentAt,
      });

      return {
        id: memberId,
        teamId: team.id,
        role: member.role,
        memberOrder: member.order,
        name: member.name,
        email,
        emailNormalized: email,
        // Carried, not re-collected. These rows are deleted and recreated on
        // every sync, so dropping the columns here erases whatever an older
        // team already holds. The value carried is the saved team's own, never
        // the registration's — a tournament's game identifier stays with the
        // tournament that asked for it.
        phone: existingMember?.phone ?? null,
        discord: existingMember?.discord ?? null,
        riotId: existingMember?.riotId ?? null,
        inviteStatus: "pending",
        inviteTokenHash: null,
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

// Tell each invitee their invitation is waiting. The invitation itself is
// already written down by the time this runs, so every channel here is best
// effort and none of them is the invitation: a notice that reaches nobody costs
// a nudge, not a roster spot.
const sendTeamInvites = async (inviteDispatches) => {
  if (!Array.isArray(inviteDispatches) || inviteDispatches.length === 0) return [];

  try {
    return await notifyInvites(inviteDispatches);
  } catch (error) {
    logger.error("Failed to send team invite notices.", {
      inviteCount: inviteDispatches.length,
      error,
    });
    return [];
  }
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
  nudgeTeamInvite,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
  ensureTeamRegistrationSaved,
  activatePaidTeamRegistration,
  refreshRegistrationVerificationStatus,
};
