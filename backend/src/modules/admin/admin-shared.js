const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { decryptSecret } = require("../../lib/secret-box");
const { normalizeText } = require("../../lib/validation");
const { getRegistrationPublicReference } = require("../tournaments/registration-state");
const { recordAuditInTransaction } = require("../../lib/audit");
const { assertNoCoachPlayerRoleConflict } = require("../tournaments/role-conflict.service");
const { resolveEffectiveTeamLogoName, getTeamLogoUrl } = require("../teams/team-logo");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGISTRATION_STATUSES = new Set(["pending", "approved", "rejected", "waitlisted"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid"]);
const VERIFICATION_STATUSES = new Set(["pending", "verified", "flagged"]);
const RECRUITMENT_STATUSES = new Set(["pending", "reviewed", "accepted", "rejected"]);
const USER_ROLES = new Set(["user", "admin"]);
const ADMIN_TRANSACTION_MAX_RETRIES = 3;
const ADMIN_RETRYABLE_TRANSACTION_ERRORS = new Set(["P2002", "P2024", "P2028", "P2034", "P2037"]);

const runAdminSerializable = async (work) => {
  for (let attempt = 1; attempt <= ADMIN_TRANSACTION_MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !ADMIN_RETRYABLE_TRANSACTION_ERRORS.has(error?.code) ||
        attempt === ADMIN_TRANSACTION_MAX_RETRIES
      ) {
        throw error;
      }
    }
  }
  throw new Error("Admin registration transaction retry limit was exhausted.");
};

const assertAdminRoleConflict = async (args) => {
  if (typeof args.tx?.teamRegistration?.findMany !== "function") return;
  return assertNoCoachPlayerRoleConflict(args);
};

const recordRegistrationStatusAudit = async ({
  tx,
  actorUserId,
  registrationId,
  fromStatus,
  toStatus,
  reason,
  requestId,
  ipAddress,
  action = "team_registration.status_changed",
}) => recordAuditInTransaction(tx, {
    actorUserId: actorUserId || null,
    action,
    targetType: "TeamRegistration",
    targetId: registrationId,
    beforeData: { status: fromStatus },
    afterData: { status: toStatus, reason: reason || null },
    requestId: requestId || null,
    ipAddress: ipAddress || null,
});

const ADMIN_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  role: true,
  isSuperAdmin: true,
  phone: true,
  discordTag: true,
  emailVerified: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
};

const TOURNAMENT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  game: true,
  status: true,
  isPublished: true,
  // A free tournament has no payment to report, so the dashboard needs the
  // method to tell "nothing to pay" apart from "paid".
  paymentMethod: true,
  waitlistEnabled: true,
  minRosterSize: true,
  maxRosterSize: true,
  maxSubstitutes: true,
  allowCoach: true,
  coachRequired: true,
};

const TEAM_REGISTRATION_INCLUDE = {
  members: {
    orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    },
  },
  tournament: {
    select: TOURNAMENT_SUMMARY_SELECT,
  },
  adminSlotReservation: {
    select: {
      id: true,
      assignedSlotNumber: true,
      quotedFeeAmount: true,
      quotedFeeCurrency: true,
      note: true,
      createdAt: true,
    },
  },
  savedTeam: { select: { logoName: true } },
};

const TEAM_REGISTRATION_SUMMARY_SELECT = {
  id: true,
  entryType: true,
  teamName: true,
  status: true,
  paymentStatus: true,
  verificationStatus: true,
  waitlistPosition: true,
  publicReference: true,
  createdAt: true,
  captainName: true,
  captainEmail: true,
  tournament: {
    select: {
      ...TOURNAMENT_SUMMARY_SELECT,
      // The list spans every event, so each row has to say which one it
      // belongs to. Only the event dashboard knew that before, from its route.
      series: { select: { id: true, title: true } },
    },
  },
  members: {
    where: { role: "COACH" },
    select: { name: true, riotId: true },
    take: 1,
  },
  _count: { select: { members: { where: { role: { not: "COACH" } } } } },
};

const mapRegistrationMember = (member) => ({
  id: member.id,
  role: member.role,
  order: member.memberOrder,
  name: member.name,
  email: member.email,
  discord: member.discord,
  riotId: member.riotId,
  additionalData: member.additionalData || {},
  inviteStatus: member.inviteStatus,
  inviteRespondedAt: member.inviteRespondedAt,
  account: member.user
    ? {
        id: member.user.id,
        username: member.user.username,
        email: member.user.email,
      }
    : null,
});

const mapRegistrationCoach = (member) => member
  ? {
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      discord: member.discord,
      riotId: member.riotId,
      // A coach confirms their spot through an invitation, exactly as a player
      // does, and an unanswered one holds verification back. Admins need to see
      // it to know why a registration has not verified.
      inviteStatus: member.inviteStatus,
      inviteRespondedAt: member.inviteRespondedAt,
    }
  : null;

const mapTeamRegistration = (registration) => ({
  id: registration.id,
  entryType: registration.entryType || "team",
  teamName: registration.teamName,
  additionalData: registration.additionalData || {},
  reservedUntil: registration.reservedUntil,
  country: registration.country,
  teamTag: registration.teamTag,
  organizationRequested: registration.organizationRequested,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
  verificationStatus: registration.verificationStatus,
  waitlistPosition: registration.waitlistPosition || null,
  assignedSlotNumber: registration.assignedSlotNumber || null,
  publicReference: getRegistrationPublicReference(registration),
  adminSlotReservation: registration.adminSlotReservation
    ? {
        ...registration.adminSlotReservation,
        quotedFeeAmount: Number(registration.adminSlotReservation.quotedFeeAmount),
      }
    : null,
  createdAt: registration.createdAt,
  contactEmail: registration.contactEmail,
  logoUrl: getTeamLogoUrl(resolveEffectiveTeamLogoName(registration)),
  tournament: registration.tournament,
  savedTeamLinked: Boolean(registration.savedTeamId),
  captain: {
    name: registration.captainName,
    email: registration.captainEmail,
    phone: registration.captainPhone,
    discord: registration.captainDiscord,
    riotId: registration.captainRiotId,
  },
  coach: mapRegistrationCoach(registration.members.find((member) => member.role === "COACH")),
  members: registration.members
    .slice()
    .filter((member) => member.role !== "COACH")
    .sort((left, right) => left.memberOrder - right.memberOrder)
    .map(mapRegistrationMember),
});

const mapTeamRegistrationSummary = ({ tournament: { series, ...tournament }, ...registration }) => ({
  id: registration.id,
  entryType: registration.entryType || "team",
  teamName: registration.teamName,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
  verificationStatus: registration.verificationStatus,
  waitlistPosition: registration.waitlistPosition || null,
  publicReference: getRegistrationPublicReference(registration),
  createdAt: registration.createdAt,
  tournament,
  event: series ? { id: series.id, title: series.title } : null,
  captain: {
    name: registration.captainName,
    email: registration.captainEmail,
  },
  coachName: registration.members?.[0]?.name || null,
  coachRiotId: registration.members?.[0]?.riotId || null,
  memberCount: registration._count.members,
});

const isGameIdentityField = (field, game) => {
  const fieldText = `${field?.key || ""} ${field?.label || ""}`.toLowerCase();
  const gameWords = normalizeText(game)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  return /(?:riot|ign|in[ -]?game|player[ -]?id|game[ -]?id|uid)/i.test(fieldText) ||
    (/\bid\b/i.test(fieldText.replace(/[_-]/g, " ")) && gameWords.some((word) => fieldText.includes(word)));
};

const syncGameIdentityData = ({ additionalData, registrationFields, scope, game, gameId }) => {
  const data = additionalData && typeof additionalData === "object" && !Array.isArray(additionalData)
    ? { ...additionalData }
    : {};
  let changed = false;
  for (const field of Array.isArray(registrationFields) ? registrationFields : []) {
    if (field?.scope !== scope || !isGameIdentityField(field, game)) continue;
    if (data[field.key] !== gameId) {
      data[field.key] = gameId;
      changed = true;
    }
  }
  return { data, changed };
};

const decryptNic = (ciphertext) => {
  try {
    return decryptSecret(ciphertext);
  } catch {
    return "Unable to decrypt";
  }
};

module.exports = {
  UUID_PATTERN,
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  VERIFICATION_STATUSES,
  RECRUITMENT_STATUSES,
  USER_ROLES,
  runAdminSerializable,
  assertAdminRoleConflict,
  recordRegistrationStatusAudit,
  ADMIN_USER_SELECT,
  TOURNAMENT_SUMMARY_SELECT,
  TEAM_REGISTRATION_INCLUDE,
  TEAM_REGISTRATION_SUMMARY_SELECT,
  mapTeamRegistration,
  mapTeamRegistrationSummary,
  syncGameIdentityData,
  decryptNic,
};
