const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");

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

const MANAGEABLE_TEAM_MEMBER_ROLES = new Set(["PLAYER", "SUBSTITUTE", "COACH"]);

// Registrations still waiting on their roster. An approved one has had its
// roster snapshotted and locked, and a rejected one is not waiting on anybody.
const OPEN_REGISTRATION_STATUSES = ["pending", "waitlisted"];

module.exports = {
  TEAM_INVITE_TTL_HOURS,
  NUDGEABLE_INVITE_STATUSES,
  TEAM_INVITE_RESEND_COOLDOWN_SECONDS,
  runRetryableTeamSyncOperation,
  runTeamSyncTransaction,
  mapSavedTeamMember,
  mapSavedTeam,
  MANAGEABLE_TEAM_MEMBER_ROLES,
  OPEN_REGISTRATION_STATUSES,
};
