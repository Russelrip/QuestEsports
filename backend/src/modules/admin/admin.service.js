const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { decryptSecret } = require("../../lib/secret-box");
const {
  removeUploadsQuietly,
  removeTeamLogoIfUnreferenced,
  scheduleTeamLogoCleanup,
} = require("../../lib/upload-cleanup");
const {
  EXCEL_CONTENT_TYPE,
  MAX_EXCEL_EXPORT_RECORDS,
  assertExportRecordLimit,
  buildExcelWorkbookBuffer,
  buildExportFilename,
  formatExportBoolean,
  formatExportTimestamp,
} = require("../../lib/excel-export");
const {
  bankTransferProofDirectory,
  persistTeamLogoUpload,
  teamLogoDirectory,
} = require("../../middleware/upload");
const {
  buildPagination,
  buildPagedResponse,
} = require("../../lib/pagination");
const { importLegacyPosters } = require("../media/legacy-import.service");
const { migrateImageAssetsToFilesystem } = require("../media/media.service");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isValidEmail,
  isPasswordWithinBcryptLimit,
} = require("../../lib/validation");
const { mapUserForResponse, validateUserBasics } = require("../auth/auth.service");
const {
  allocateLowestAvailableSlot,
  countTournamentCapacityUsage,
  compactWaitlistPositions,
  getNextWaitlistPosition,
  isRegistrationActive,
} = require("../tournaments/registration-eligibility");
const { getRegistrationPublicReference } = require("../tournaments/registration-state");
const { getBankTransferAmountForSlot } = require("../payments/bank-transfer.service");
const { recordAuditInTransaction } = require("../../lib/audit");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const { buildShortCode } = require("../tournaments/bracket.service");
const { normalizeCoachSubmission } = require("../tournaments/coach.validation");
const { assertNoCoachPlayerRoleConflict } = require("../tournaments/role-conflict.service");
const {
  resolveEffectiveTeamLogoName,
  getTeamLogoUrl,
} = require("../teams/team-logo");

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

const acceptPendingRegistrationInvites = async ({ tx, registrationId, savedTeamId, members }) => {
  const pendingMembers = (members || []).filter((member) => member.inviteStatus === "pending");
  if (pendingMembers.length > 0) {
    const inviteRespondedAt = new Date();
    await tx.registrationMember.updateMany({
      where: { registrationId, inviteStatus: "pending" },
      data: {
        inviteStatus: "accepted",
        inviteRespondedAt,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });

    if (savedTeamId && typeof tx.savedTeamMember?.updateMany === "function") {
      for (const member of pendingMembers) {
        await tx.savedTeamMember.updateMany({
          where: {
            teamId: savedTeamId,
            role: member.role,
            memberOrder: member.memberOrder,
            emailNormalized: member.emailNormalized,
            inviteStatus: "pending",
          },
          data: {
            inviteStatus: "accepted",
            inviteRespondedAt,
            inviteTokenHash: null,
            inviteExpiresAt: null,
          },
        });
      }
    }
  }

  const rosterMembers = (members || [])
    .filter((member) => member.role !== "CAPTAIN")
    .map((member) => ({
      ...member,
      inviteStatus: member.inviteStatus === "pending" ? "accepted" : member.inviteStatus,
    }));
  return rosterMembers.some((member) => member.inviteStatus === "declined")
    ? "flagged"
    : rosterMembers.every((member) => member.inviteStatus === "accepted")
      ? "verified"
      : "pending";
};

const ADMIN_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  role: true,
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
  tournament: { select: TOURNAMENT_SUMMARY_SELECT },
  members: {
    where: { role: "COACH" },
    select: { name: true, riotId: true },
    take: 1,
  },
  _count: { select: { members: { where: { role: { not: "COACH" } } } } },
};

const mapContactMessage = (message) => ({
  id: message.id,
  name: message.name,
  email: message.email,
  subject: message.subject,
  message: message.message,
  isRead: message.isRead,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

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
      name: member.name,
      email: member.email,
      phone: member.phone,
      discord: member.discord,
      riotId: member.riotId,
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

const mapTeamRegistrationSummary = (registration) => ({
  id: registration.id,
  entryType: registration.entryType || "team",
  teamName: registration.teamName,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
  verificationStatus: registration.verificationStatus,
  waitlistPosition: registration.waitlistPosition || null,
  publicReference: getRegistrationPublicReference(registration),
  createdAt: registration.createdAt,
  tournament: registration.tournament,
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

const mapRecruitmentApplication = (application) => ({
  id: application.id,
  applicationType: application.applicationType,
  fullName: application.fullName,
  email: application.email,
  phone: application.phone,
  discord: application.discord,
  game: application.game,
  playerId: application.playerId,
  nic: application.applicantIdNumberCiphertext
    ? decryptNic(application.applicantIdNumberCiphertext)
    : null,
  teamName: application.teamName,
  currentRosterSize: application.currentRosterSize,
  members: Array.isArray(application.members)
    ? application.members.map((member) => ({
        name: member.name,
        email: member.email,
        discord: member.discord,
        playerId: member.playerId || null,
        ign: member.ign || null,
        phone: member.phone || null,
        role: member.role || "player",
        nic: member.idNumberCiphertext ? decryptNic(member.idNumberCiphertext) : null,
        privacyAcceptedAt: member.privacyAcceptedAt || null,
      }))
    : [],
  details:
    application.details && typeof application.details === "object"
      ? application.details
      : {},
  notes: application.notes,
  womensLeagueInterest: application.womensLeagueInterest,
  status: application.status,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
});

const buildRegistrationWhere = ({
  eventId,
  game,
  search,
  tournamentId,
  tournament,
  status,
  paymentStatus,
  verificationStatus,
}) => {
  const normalizedEventId = normalizeText(eventId);
  const normalizedGame = normalizeText(game);
  const normalizedSearch = normalizeText(search);
  const normalizedTournament = normalizeText(tournament);
  const normalizedStatus = normalizeText(status).toLowerCase();
  const normalizedPaymentStatus = normalizeText(paymentStatus).toLowerCase();
  const normalizedVerificationStatus = normalizeText(verificationStatus).toLowerCase();

  const tournamentFilters = [
    ...(normalizedEventId ? [{ seriesId: normalizedEventId }] : []),
    ...(normalizedGame ? [{ game: { equals: normalizedGame, mode: "insensitive" } }] : []),
    ...(normalizedTournament
      ? [{
          OR: [
            { id: normalizedTournament },
            { slug: normalizedTournament },
            { title: { contains: normalizedTournament, mode: "insensitive" } },
          ],
        }]
      : []),
  ];

  return {
    ...(tournamentId ? { tournamentId } : {}),
    ...(tournamentFilters.length > 0
      ? { tournament: tournamentFilters.length === 1 ? tournamentFilters[0] : { AND: tournamentFilters } }
      : {}),
    ...(REGISTRATION_STATUSES.has(normalizedStatus) ? { status: normalizedStatus } : {}),
    ...(PAYMENT_STATUSES.has(normalizedPaymentStatus)
      ? { paymentStatus: normalizedPaymentStatus }
      : {}),
    ...(VERIFICATION_STATUSES.has(normalizedVerificationStatus)
      ? { verificationStatus: normalizedVerificationStatus }
      : {}),
    ...(normalizedSearch
      ? {
          OR: [
            { teamName: { contains: normalizedSearch, mode: "insensitive" } },
            { captainName: { contains: normalizedSearch, mode: "insensitive" } },
            { captainEmail: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };
};

const buildRecruitmentWhere = ({ search, status, applicationType }) => {
  const normalizedSearch = normalizeText(search);
  const normalizedStatus = normalizeText(status).toLowerCase();
  const normalizedApplicationType = normalizeText(applicationType).toLowerCase();

  return {
    ...(RECRUITMENT_STATUSES.has(normalizedStatus) ? { status: normalizedStatus } : {}),
    ...(normalizedApplicationType ? { applicationType: normalizedApplicationType } : {}),
    ...(normalizedSearch
      ? {
          OR: [
            { fullName: { contains: normalizedSearch, mode: "insensitive" } },
            { email: { contains: normalizedSearch, mode: "insensitive" } },
            { phone: { contains: normalizedSearch, mode: "insensitive" } },
            { discord: { contains: normalizedSearch, mode: "insensitive" } },
            { game: { contains: normalizedSearch, mode: "insensitive" } },
            { teamName: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };
};

const getAdminDashboardData = async () => {
  const [
    totalTournaments,
    openTournaments,
    totalRegistrations,
    pendingRegistrations,
    pendingRecruitmentApplications,
    unreadContactMessages,
    pendingPayments,
    actionableOrders,
  ] =
    await prisma.$transaction([
      prisma.tournament.count(),
      prisma.tournament.count({ where: { status: "registration_open" } }),
      prisma.teamRegistration.count(),
      prisma.teamRegistration.count({ where: { status: "pending" } }),
      prisma.recruitmentApplication.count({ where: { status: "pending" } }),
      prisma.contactSubmission.count({ where: { isRead: false } }),
      prisma.paymentTransaction.count({ where: { status: { in: ["pending", "review_required"] } } }),
      prisma.merchandiseOrder.count({ where: { status: { in: ["paid", "processing"] } } }),
    ]);

  return {
    totalTournaments,
    openTournaments,
    totalRegistrations,
    pendingRegistrations,
    pendingRecruitmentApplications,
    unreadContactMessages,
    pendingPayments,
    actionableOrders,
  };
};

const findUserIdentityConflict = ({ email, usernameNormalized, excludeUserId }) =>
  prisma.user.findFirst({
    where: {
      OR: [{ emailNormalized: email }, { usernameNormalized }],
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: {
      emailNormalized: true,
      usernameNormalized: true,
    },
  });

const listAdminUsers = async ({ page, pageSize, search, role }) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const normalizedRole = normalizeText(role).toLowerCase();
  const where = normalizedSearch
    ? {
        OR: [
          { firstName: { contains: normalizedSearch, mode: "insensitive" } },
          { lastName: { contains: normalizedSearch, mode: "insensitive" } },
          { email: { contains: normalizedSearch, mode: "insensitive" } },
          { username: { contains: normalizedSearch, mode: "insensitive" } },
        ],
      }
    : {};

  if (USER_ROLES.has(normalizedRole)) {
    where.role = normalizedRole;
  }

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: ADMIN_USER_SELECT,
    }),
  ]);

  return buildPagedResponse({
    items: users.map(mapUserForResponse),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminUserById = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ADMIN_USER_SELECT,
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  return mapUserForResponse(user);
};

const createAdminUser = async ({ body }) => {
  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const email = normalizeEmail(body.email);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(username);
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  const phone = normalizeText(body.phone) || null;
  const discordTag = normalizeText(body.discordTag) || null;
  const role = USER_ROLES.has(normalizeText(body.role).toLowerCase())
    ? normalizeText(body.role).toLowerCase()
    : "user";

  const fieldErrors = validateUserBasics({
    firstName,
    lastName,
    email,
    username,
  });
  if (phone && phone.length > 50) fieldErrors.phone = "Phone must be 50 characters or fewer.";
  if (discordTag && discordTag.length > 100) fieldErrors.discordTag = "Discord username must be 100 characters or fewer.";

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Password is required.";
  } else if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
  } else if (!isPasswordWithinBcryptLimit(password)) {
    fieldErrors.password = "Password must be no more than 72 UTF-8 bytes.";
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = "Please confirm the password.";
  } else if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "Confirm password must match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const existingUser = await findUserIdentityConflict({
    email,
    usernameNormalized,
  });

  if (existingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors:
        existingUser.emailNormalized === email
          ? { email: "Email already exists." }
          : { username: "Username already exists." },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const passwordSetAt = new Date();

  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      firstName,
      lastName,
      email,
      emailNormalized: email,
      username,
      usernameNormalized,
      passwordHash,
      passwordSetAt,
      role,
      phone,
      discordTag,
    },
    select: ADMIN_USER_SELECT,
  });

  return mapUserForResponse(user);
};

const updateAdminUser = async ({ userId, body, currentUser }) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!existingUser) {
    throw new HttpError(404, "User not found.");
  }

  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const email = normalizeEmail(body.email);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(username);
  const phone = normalizeText(body.phone) || null;
  const discordTag = normalizeText(body.discordTag) || null;
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  const role = USER_ROLES.has(normalizeText(body.role).toLowerCase())
    ? normalizeText(body.role).toLowerCase()
    : existingUser.role;

  const fieldErrors = validateUserBasics({
    firstName,
    lastName,
    email,
    username,
  });
  if (phone && phone.length > 50) fieldErrors.phone = "Phone must be 50 characters or fewer.";
  if (discordTag && discordTag.length > 100) fieldErrors.discordTag = "Discord username must be 100 characters or fewer.";

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (password) {
    if (password.length < 8) {
      fieldErrors.password = "Password must be at least 8 characters long.";
    } else if (!isPasswordWithinBcryptLimit(password)) {
      fieldErrors.password = "Password must be no more than 72 UTF-8 bytes.";
    }

    if (password !== confirmPassword) {
      fieldErrors.confirmPassword = "Confirm password must match.";
    }
  }

  if (currentUser.id === userId && role !== "admin") {
    fieldErrors.role = "You cannot remove your own admin access.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const conflictingUser = await findUserIdentityConflict({
    email,
    usernameNormalized,
    excludeUserId: userId,
  });

  if (conflictingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors:
        conflictingUser.emailNormalized === email
          ? { email: "Email already exists." }
          : { username: "Username already exists." },
    });
  }

  let nextPasswordHash = null;
  let nextPasswordSetAt = null;
  if (password) {
    nextPasswordHash = await bcrypt.hash(password, 10);
    nextPasswordSetAt = new Date();
  }

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        email,
        emailNormalized: email,
        username,
        usernameNormalized,
        phone,
        discordTag,
        role,
        ...(nextPasswordHash
          ? { passwordHash: nextPasswordHash, passwordSetAt: nextPasswordSetAt }
          : {}),
      },
      select: ADMIN_USER_SELECT,
    });

    if (nextPasswordHash) {
      await tx.session.deleteMany({
        where: {
          userId,
        },
      });
    }

    return updatedUser;
  });

  return mapUserForResponse(user);
};

const deleteAdminUser = async ({ userId, currentUser }) => {
  if (currentUser.id === userId) {
    throw new HttpError(400, "You cannot delete your own account.");
  }

  const deleted = await prisma.user.deleteMany({
    where: { id: userId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "User not found.");
  }
};

const listContactMessages = async ({ page, pageSize, search, isRead }) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const readFilter =
    typeof isRead === "string" && isRead.length > 0 ? isRead === "true" : undefined;
  const where = {
    ...(normalizedSearch
      ? {
          OR: [
            { name: { contains: normalizedSearch, mode: "insensitive" } },
            { email: { contains: normalizedSearch, mode: "insensitive" } },
            { subject: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(typeof readFilter === "boolean" ? { isRead: readFilter } : {}),
  };

  const [total, messages] = await prisma.$transaction([
    prisma.contactSubmission.count({ where }),
    prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);

  return buildPagedResponse({
    items: messages.map(mapContactMessage),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const updateContactMessageReadStatus = async (messageId, isRead) => {
  const updated = await prisma.contactSubmission.update({
    where: { id: messageId },
    data: { isRead: Boolean(isRead) },
  });

  return mapContactMessage(updated);
};

const deleteContactMessage = async (messageId) => {
  const deleted = await prisma.contactSubmission.deleteMany({
    where: { id: messageId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Contact message not found.");
  }
};

const listTeamRegistrations = async (query = {}) => {
  const pagination = buildPagination(query);
  const where = buildRegistrationWhere(query);

  const [total, registrations, tournaments] = await prisma.$transaction([
    prisma.teamRegistration.count({ where }),
    prisma.teamRegistration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: TEAM_REGISTRATION_SUMMARY_SELECT,
    }),
    prisma.tournament.findMany({
      ...(query.eventId ? { where: { seriesId: normalizeText(query.eventId) } } : {}),
      orderBy: { startDate: { sort: "desc", nulls: "last" } },
      select: TOURNAMENT_SUMMARY_SELECT,
    }),
  ]);

  return {
    ...buildPagedResponse({
      items: registrations.map(mapTeamRegistrationSummary),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    tournaments,
  };
};

const getAdminTeamRegistrationById = async (registrationId) => {
  const registration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    include: TEAM_REGISTRATION_INCLUDE,
  });
  if (!registration) throw new HttpError(404, "Team registration not found.");
  return mapTeamRegistration(registration);
};

const updateTeamRegistrationGameIds = async (registrationId, body = {}, auditContext = {}) => {
  const captainGameId = normalizeText(body.captainGameId);
  const requestedMembers = Array.isArray(body.members) ? body.members : [];

  if (!captainGameId || captainGameId.length > 100) {
    throw new HttpError(400, "The captain needs a Game ID of 100 characters or fewer.");
  }
  if (requestedMembers.length > 20) {
    throw new HttpError(400, "A registration can include up to 20 roster members.");
  }

  const normalizedMembers = requestedMembers.map((member) => ({
    id: normalizeText(member.id),
    gameId: normalizeText(member.gameId),
  }));
  if (normalizedMembers.some((member) => !member.id || !member.gameId || member.gameId.length > 100)) {
    throw new HttpError(400, "Every roster member needs a Game ID of 100 characters or fewer.");
  }
  if (new Set(normalizedMembers.map((member) => member.id)).size !== normalizedMembers.length) {
    throw new HttpError(400, "Each roster member can only be updated once.");
  }

  await runAdminSerializable(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        additionalData: true,
        tournament: { select: { id: true, game: true, registrationFields: true } },
        members: {
          select: {
            id: true,
            role: true,
            additionalData: true,
            email: true,
            emailNormalized: true,
            riotId: true,
          },
        },
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");

    const memberById = new Map(registration.members.map((member) => [member.id, member]));
    if (normalizedMembers.length !== registration.members.length) {
      throw new HttpError(400, "Submit a Game ID for every roster member.");
    }
    if (normalizedMembers.some((member) => !memberById.has(member.id))) {
      throw new HttpError(400, "One or more roster members do not belong to this registration.");
    }

    await assertAdminRoleConflict({
      tx,
      tournamentId: registration.tournament.id,
      members: registration.members.map((member) => ({
        ...member,
        riotId: member.role === "CAPTAIN"
          ? captainGameId
          : normalizedMembers.find((requested) => requested.id === member.id)?.gameId || member.riotId,
      })),
      excludeRegistrationId: registrationId,
    });

    const entryData = syncGameIdentityData({
      additionalData: registration.additionalData,
      registrationFields: registration.tournament.registrationFields,
      scope: "entry",
      game: registration.tournament.game,
      gameId: captainGameId,
    });
    await tx.teamRegistration.update({
      where: { id: registrationId },
      data: {
        captainRiotId: captainGameId,
        ...(entryData.changed ? { additionalData: entryData.data } : {}),
      },
    });

    for (const member of normalizedMembers) {
      const existingMember = memberById.get(member.id);
      const gameId = existingMember.role === "CAPTAIN" ? captainGameId : member.gameId;
      const memberData = syncGameIdentityData({
        additionalData: existingMember.additionalData,
        registrationFields: registration.tournament.registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId,
      });
      await tx.registrationMember.update({
        where: { id: member.id },
        data: {
          riotId: gameId,
          ...(memberData.changed ? { additionalData: memberData.data } : {}),
        },
      });
    }
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
          actorUserId: auditContext.actorUserId || null,
          action: "team_registration.game_ids_updated",
          targetType: "TeamRegistration",
          targetId: registrationId,
          afterData: {
            captainUpdated: true,
            memberCount: normalizedMembers.length,
          },
          requestId: auditContext.requestId || null,
          ipAddress: auditContext.ipAddress || null,
      });
    }
  });

  return getAdminTeamRegistrationById(registrationId);
};

const ADMIN_ROSTER_ROLES = new Set(["CAPTAIN", "PLAYER", "SUBSTITUTE"]);

const hasOwnProperty = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const mapCoachDraft = (member) => member
  ? {
      name: member.name,
      email: member.email,
      phone: member.phone,
      discord: member.discord,
      riotId: member.riotId,
    }
  : null;

const normalizeAdminCoach = ({ body, tournament, currentCoach }) => {
  if (!hasOwnProperty(body, "coach")) {
    if (tournament.coachRequired && !currentCoach) {
      throw new HttpError(400, "A complete coach is required for this tournament.");
    }
    return mapCoachDraft(currentCoach);
  }

  if (body.coach === null) {
    return normalizeCoachSubmission({ tournament, body, coachInput: null });
  }

  return normalizeCoachSubmission({ tournament, body, coachInput: body.coach });
};

const normalizeAdminRosterMembers = (body = {}) => {
  const requestedMembers = Array.isArray(body.members) ? body.members : [];
  if (requestedMembers.length < 1 || requestedMembers.length > 20) {
    throw new HttpError(400, "A registration must include a captain and can include up to 20 roster members.");
  }

  const roleCounts = { CAPTAIN: 0, PLAYER: 0, SUBSTITUTE: 0 };
  const members = requestedMembers.map((member) => {
    const role = normalizeText(member?.role).toUpperCase();
    if (!ADMIN_ROSTER_ROLES.has(role)) {
      throw new HttpError(400, "Roster corrections may only include a captain, players, and substitutes.");
    }
    roleCounts[role] += 1;
    return {
      id: normalizeText(member?.id) || null,
      role,
      memberOrder: role === "CAPTAIN" ? 0 : roleCounts[role],
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
      discord: normalizeText(member?.discord),
      riotId: normalizeText(member?.gameId || member?.riotId),
    };
  });

  if (members.some((member) =>
    !member.name ||
    !isValidEmail(member.email) ||
    !member.discord ||
    !member.riotId ||
    member.name.length > 100 ||
    member.email.length > 254 ||
    member.discord.length > 100 ||
    member.riotId.length > 100
  )) {
    throw new HttpError(400, "Every roster member needs a valid name, email, Discord username, and Game ID.");
  }

  if (new Set(members.map((member) => member.email)).size !== members.length) {
    throw new HttpError(400, "Roster member emails must be unique.");
  }
  if (roleCounts.CAPTAIN !== 1) {
    throw new HttpError(400, "The corrected roster must include exactly one captain.");
  }

  return members;
};

const correctTeamRegistrationRoster = async (registrationId, body = {}, auditContext = {}) => {
  const requestedMembers = normalizeAdminRosterMembers(body);
  const syncSavedTeam = body.syncSavedTeam === true;
  const respondedAt = new Date();

  const correction = await runAdminSerializable(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            game: true,
            registrationFields: true,
            minRosterSize: true,
            maxRosterSize: true,
            maxSubstitutes: true,
            allowCoach: true,
            coachRequired: true,
          },
        },
        members: { orderBy: [{ role: "asc" }, { memberOrder: "asc" }] },
        savedTeam: {
          include: {
            members: true,
            registrations: { select: { id: true } },
          },
        },
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");
    if (registration.entryType === "solo") {
      throw new HttpError(409, "Solo registrations do not have a team roster to correct.");
    }
    if (syncSavedTeam && !registration.savedTeam) {
      throw new HttpError(409, "This registration is not linked to a saved team.");
    }

    const currentCaptain = registration.members.find((member) => member.role === "CAPTAIN");
    if (!currentCaptain) throw new HttpError(409, "This registration does not have a valid captain roster record.");
    const currentCoach = registration.members.find((member) => member.role === "COACH");
    const requestedCoach = normalizeAdminCoach({
      body,
      tournament: registration.tournament,
      currentCoach,
    });
    const requestedCaptain = requestedMembers.find((member) => member.role === "CAPTAIN");
    const currentCaptainEmail = normalizeEmail(registration.captainEmail || currentCaptain.email);
    const captainChanged = requestedCaptain.email !== currentCaptainEmail;
    if (captainChanged && registration.savedTeam && !syncSavedTeam) {
      throw new HttpError(409, "Changing the captain of a linked registration also requires saved-team synchronization.");
    }
    if (
      captainChanged &&
      syncSavedTeam &&
      registration.savedTeam.registrations.some((linkedRegistration) => linkedRegistration.id !== registrationId)
    ) {
      throw new HttpError(
        409,
        "This saved team is linked to other registrations. Use the full team captain-transfer action before correcting this tournament roster."
      );
    }

    const playerCount = requestedMembers.filter((member) => member.role === "CAPTAIN" || member.role === "PLAYER").length;
    const substituteCount = requestedMembers.filter((member) => member.role === "SUBSTITUTE").length;
    if (
      playerCount < registration.tournament.minRosterSize ||
      playerCount > registration.tournament.maxRosterSize ||
      substituteCount > registration.tournament.maxSubstitutes
    ) {
      const requiredPlayers = registration.tournament.minRosterSize === registration.tournament.maxRosterSize
        ? `exactly ${registration.tournament.minRosterSize}`
        : `${registration.tournament.minRosterSize}-${registration.tournament.maxRosterSize}`;
      throw new HttpError(
        400,
        `This event requires ${requiredPlayers} active players, including the captain, and allows up to ${registration.tournament.maxSubstitutes} substitutes. The corrected roster has ${playerCount} active players and ${substituteCount} substitutes.`
      );
    }

    const requestedEmails = requestedMembers.map((member) => member.email);
    const users = requestedEmails.length > 0
      ? await tx.user.findMany({
          where: { emailNormalized: { in: requestedEmails } },
          select: {
            id: true,
            email: true,
            emailNormalized: true,
            emailVerified: true,
            phone: true,
          },
        })
      : [];
    const usersByEmail = new Map(users.map((user) => [user.emailNormalized, user]));
    const missingAccounts = requestedEmails.filter((email) => !usersByEmail.get(email)?.emailVerified);
    if (missingAccounts.length > 0) {
      throw new HttpError(
        409,
        `Every corrected roster member must have a verified Quest account. Missing or unverified: ${missingAccounts.join(", ")}.`
      );
    }
    const captainAccount = usersByEmail.get(requestedCaptain.email);
    if (captainChanged && !normalizeText(captainAccount.phone)) {
      throw new HttpError(409, "The new captain must add a phone number to their Quest profile first.");
    }

    const tournamentConflicts = requestedEmails.length > 0
      ? await tx.registrationMember.findMany({
          where: {
            registrationId: { not: registrationId },
            role: { not: "COACH" },
            emailNormalized: { in: requestedEmails },
            registration: {
              tournamentId: registration.tournamentId,
              status: { notIn: ["rejected", "waitlisted"] },
            },
          },
          select: { emailNormalized: true, registration: { select: { teamName: true } } },
        })
      : [];
    if (tournamentConflicts.length > 0) {
      const conflict = tournamentConflicts[0];
      throw new HttpError(
        409,
        `${conflict.emailNormalized} is already registered for this tournament with ${conflict.registration.teamName}.`
      );
    }

    const existingById = new Map(registration.members.map((member) => [member.id, member]));
    const getInviteState = (existingMember) => ({
      inviteStatus: existingMember?.inviteStatus || "accepted",
      inviteTokenHash: existingMember?.inviteTokenHash ?? null,
      inviteSentAt: existingMember?.inviteSentAt ?? null,
      inviteExpiresAt: existingMember?.inviteExpiresAt ?? null,
      inviteRespondedAt: existingMember ? existingMember.inviteRespondedAt ?? null : respondedAt,
    });
    const registrationFields = Array.isArray(registration.tournament.registrationFields)
      ? registration.tournament.registrationFields
      : [];
    const nextMembers = requestedMembers.map((member) => {
      const account = usersByEmail.get(member.email);
      const existingMember = member.id ? existingById.get(member.id) : null;
      const memberData = syncGameIdentityData({
        additionalData: existingMember?.additionalData,
        registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId: member.riotId,
      });
      return {
        id: crypto.randomUUID(),
        registrationId,
        userId: account.id,
        role: member.role,
        memberOrder: member.memberOrder,
        name: member.name,
        email: account.email,
        emailNormalized: account.emailNormalized,
        discord: member.discord,
        riotId: member.riotId,
        additionalData: memberData.data,
        ...getInviteState(existingMember),
      };
    });
    if (requestedCoach) {
      const coachData = syncGameIdentityData({
        additionalData: currentCoach?.additionalData,
        registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId: requestedCoach.riotId,
      });
      nextMembers.push({
        id: crypto.randomUUID(),
        registrationId,
        userId: null,
        role: "COACH",
        memberOrder: 1,
        name: requestedCoach.name,
        email: requestedCoach.email,
        emailNormalized: requestedCoach.email,
        phone: requestedCoach.phone,
        discord: requestedCoach.discord,
        riotId: requestedCoach.riotId,
        additionalData: coachData.data,
        ...getInviteState(currentCoach),
      });
    }

    await assertAdminRoleConflict({
      tx,
      tournamentId: registration.tournament.id,
      members: nextMembers,
      excludeRegistrationId: registrationId,
    });

    const before = registration.members.map((member) => ({
      id: member.id,
      role: member.role,
      name: member.name,
      email: member.email,
      riotId: member.riotId,
    }));

    const nextCaptain = nextMembers.find((member) => member.role === "CAPTAIN");
    const entryData = syncGameIdentityData({
      additionalData: registration.additionalData,
      registrationFields,
      scope: "entry",
      game: registration.tournament.game,
      gameId: nextCaptain.riotId,
    });
    const rosterMembers = nextMembers.filter((member) => member.role !== "CAPTAIN");
    const verificationStatus = rosterMembers.some((member) => member.inviteStatus === "declined")
      ? "flagged"
      : nextMembers.length > 0 && rosterMembers.every((member) => member.inviteStatus === "accepted")
        ? "verified"
        : "pending";

    await tx.registrationMember.deleteMany({ where: { registrationId } });
    await tx.registrationMember.createMany({ data: nextMembers });
    await tx.teamRegistration.update({
      where: { id: registrationId },
      data: {
        userId: nextCaptain.userId,
        captainName: nextCaptain.name,
        captainEmail: nextCaptain.emailNormalized,
        captainPhone: captainChanged ? normalizeText(captainAccount.phone) : registration.captainPhone,
        captainDiscord: nextCaptain.discord,
        captainRiotId: nextCaptain.riotId,
        contactEmail: captainChanged ? nextCaptain.emailNormalized : registration.contactEmail,
        verificationStatus,
        ...(entryData.changed ? { additionalData: entryData.data } : {}),
      },
    });

    if (syncSavedTeam) {
      const savedCaptain = registration.savedTeam.members.find((member) => member.role === "CAPTAIN");
      if (!savedCaptain || savedCaptain.emailNormalized !== currentCaptainEmail) {
        throw new HttpError(409, "The linked saved team and registration do not have the same captain.");
      }
      if (captainChanged) {
        const ownedTeamConflict = await tx.savedTeam.findFirst({
          where: {
            id: { not: registration.savedTeam.id },
            captainUserId: nextCaptain.userId,
            name: registration.savedTeam.name,
          },
          select: { id: true },
        });
        if (ownedTeamConflict) {
          throw new HttpError(409, "The new captain already owns another saved team with this name.");
        }
      }
      const savedByEmail = new Map(
        registration.savedTeam.members.map((member) => [member.emailNormalized, member])
      );
      await tx.savedTeamMember.deleteMany({ where: { teamId: registration.savedTeam.id } });
      await tx.savedTeamMember.createMany({
        data: nextMembers.map((member) => {
          const existingMember = savedByEmail.get(member.emailNormalized);
          const inviteState = getInviteState(existingMember || member);
          return {
            id: crypto.randomUUID(),
            teamId: registration.savedTeam.id,
            userId: member.userId,
            role: member.role,
            memberOrder: member.memberOrder,
            name: member.name,
            email: member.email,
            emailNormalized: member.emailNormalized,
            phone: member.phone ?? existingMember?.phone ?? null,
            discord: member.discord,
            riotId: member.riotId,
            ...inviteState,
          };
        }),
      });
      if (captainChanged) {
        await tx.savedTeam.update({
          where: { id: registration.savedTeam.id },
          data: { captainUserId: nextCaptain.userId },
        });
      }
    }

    const audit = {
      actorUserId: auditContext.actorUserId || null,
      action: "team_registration.roster_corrected",
      targetType: "TeamRegistration",
      targetId: registrationId,
      beforeData: { members: before },
      afterData: {
        members: nextMembers.map((member) => ({
          id: member.id,
          role: member.role,
          name: member.name,
          email: member.email,
          riotId: member.riotId,
        })),
        savedTeamId: syncSavedTeam ? registration.savedTeam.id : null,
        captainChanged,
      },
      requestId: auditContext.requestId || null,
      ipAddress: auditContext.ipAddress || null,
    };
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, audit);
    }

    return {
      before,
      after: nextMembers.map((member) => ({
          id: member.id,
          role: member.role,
          name: member.name,
          email: member.email,
          riotId: member.riotId,
        })),
      savedTeamId: syncSavedTeam ? registration.savedTeam.id : null,
      captainChanged,
    };
  });

  return {
    registration: await getAdminTeamRegistrationById(registrationId),
    correction,
  };
};

const exportTeamRegistrations = async (query = {}) => {
  const where = buildRegistrationWhere(query);
  const registrations = await prisma.teamRegistration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_EXCEL_EXPORT_RECORDS + 1,
    include: TEAM_REGISTRATION_INCLUDE,
  });
  assertExportRecordLimit({
    records: registrations,
    label: "Team registration",
  });
  const mappedRegistrations = registrations.map(mapTeamRegistration);
  const registrationRows = mappedRegistrations.map((registration) => ({
    tournamentTitle: registration.tournament?.title || "",
    tournamentSlug: registration.tournament?.slug || "",
    teamName: registration.teamName,
    country: registration.country || "",
    teamTag: registration.teamTag || "",
    organizationRequested: formatExportBoolean(
      registration.organizationRequested
    ),
    approvalStatus: registration.status,
    paymentStatus: registration.paymentStatus,
    verificationStatus: registration.verificationStatus,
    captainName: registration.captain.name,
    captainEmail: registration.captain.email,
    captainPhone: registration.captain.phone,
    captainDiscord: registration.captain.discord,
    captainRiotId: registration.captain.riotId,
    coachName: registration.coach?.name || "",
    coachEmail: registration.coach?.email || "",
    coachContact: registration.coach?.phone || "",
    coachDiscord: registration.coach?.discord || "",
    coachRiotId: registration.coach?.riotId || "",
    contactEmail: registration.contactEmail,
    rosterCount: registration.members.length,
    acceptedMembers: registration.members.filter((member) => member.inviteStatus === "accepted").length,
    submittedAt: formatExportTimestamp(registration.createdAt),
    logoUrl: registration.logoUrl || "",
  }));
  const memberRows = mappedRegistrations.flatMap((registration) =>
    registration.members
      .filter((member) => member.role !== "COACH")
      .map((member) => ({
        tournamentTitle: registration.tournament?.title || "",
        tournamentSlug: registration.tournament?.slug || "",
        teamName: registration.teamName,
        registrationId: registration.id,
        role: member.role,
        order: member.order,
        name: member.name,
        email: member.email || "",
        discord: member.discord || "",
        riotId: member.riotId || "",
        inviteStatus: member.inviteStatus,
        inviteRespondedAt: formatExportTimestamp(member.inviteRespondedAt),
        accountUsername: member.account?.username || "",
        accountEmail: member.account?.email || "",
      }))
  );

  const buffer = await buildExcelWorkbookBuffer({
    sheets: [
      {
        name: "Registrations",
        columns: [
          { header: "Tournament", key: "tournamentTitle", width: 28 },
          { header: "Tournament Slug", key: "tournamentSlug", width: 24 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Country", key: "country", width: 18 },
          { header: "Team Tag", key: "teamTag", width: 14 },
          {
            header: "Organization Requested",
            key: "organizationRequested",
            width: 22,
          },
          { header: "Approval", key: "approvalStatus", width: 16 },
          { header: "Payment", key: "paymentStatus", width: 16 },
          { header: "Verification", key: "verificationStatus", width: 16 },
          { header: "Captain Name", key: "captainName", width: 24 },
          { header: "Captain Email", key: "captainEmail", width: 28 },
          { header: "Captain Phone", key: "captainPhone", width: 18 },
          { header: "Captain Discord", key: "captainDiscord", width: 22 },
          { header: "Captain Riot ID", key: "captainRiotId", width: 22 },
          { header: "Coach Name", key: "coachName", width: 24 },
          { header: "Coach Email", key: "coachEmail", width: 28 },
          { header: "Coach Contact", key: "coachContact", width: 18 },
          { header: "Coach Discord", key: "coachDiscord", width: 22 },
          { header: "Coach Riot ID", key: "coachRiotId", width: 22 },
          { header: "Contact Email", key: "contactEmail", width: 28 },
          { header: "Roster Count", key: "rosterCount", width: 14 },
          { header: "Accepted Members", key: "acceptedMembers", width: 18 },
          { header: "Submitted At", key: "submittedAt", width: 26 },
          { header: "Logo URL", key: "logoUrl", width: 32 },
        ],
        rows: registrationRows,
      },
      {
        name: "Roster Members",
        columns: [
          { header: "Tournament", key: "tournamentTitle", width: 28 },
          { header: "Tournament Slug", key: "tournamentSlug", width: 24 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Registration ID", key: "registrationId", width: 38 },
          { header: "Role", key: "role", width: 16 },
          { header: "Order", key: "order", width: 10 },
          { header: "Name", key: "name", width: 24 },
          { header: "Email", key: "email", width: 28 },
          { header: "Discord", key: "discord", width: 22 },
          { header: "Riot ID", key: "riotId", width: 22 },
          { header: "Invite Status", key: "inviteStatus", width: 16 },
          { header: "Invite Responded At", key: "inviteRespondedAt", width: 26 },
          { header: "Account Username", key: "accountUsername", width: 22 },
          { header: "Account Email", key: "accountEmail", width: 28 },
        ],
        rows: memberRows,
      },
    ],
  });

  return {
    buffer,
    contentType: EXCEL_CONTENT_TYPE,
    filename: buildExportFilename("team-registrations"),
    recordCount: mappedRegistrations.length,
  };
};

const listRecruitmentApplications = async ({ page, pageSize, search, status, applicationType }) => {
  const pagination = buildPagination({ page, pageSize });
  const where = buildRecruitmentWhere({ search, status, applicationType });

  const [total, applications] = await prisma.$transaction([
    prisma.recruitmentApplication.count({ where }),
    prisma.recruitmentApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);

  return buildPagedResponse({
    items: applications.map(mapRecruitmentApplication),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const exportRecruitmentApplications = async (query = {}) => {
  const where = buildRecruitmentWhere(query);
  const applications = await prisma.recruitmentApplication.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_EXCEL_EXPORT_RECORDS + 1,
  });
  assertExportRecordLimit({
    records: applications,
    label: "Recruitment application",
  });
  const mappedApplications = applications.map(mapRecruitmentApplication);
  const applicationRows = mappedApplications.map((application) => {
    const details = application.details || {};

    return {
      applicationId: application.id,
      applicationType: application.applicationType,
      status: application.status,
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      discord: application.discord,
      game: application.game,
      playerId: application.playerId || "",
      nic: application.nic || "",
      teamName: application.teamName || "",
      currentRosterSize: application.currentRosterSize || "",
      womensLeagueInterest: formatExportBoolean(application.womensLeagueInterest),
      ign: details.ign || "",
      birthday: details.birthday || "",
      gender: details.gender || "",
      rank: details.peakAndCurrentRank || "",
      tournamentExperience: details.tournamentExperience || "",
      previouslyInOrganization: formatExportBoolean(details.previouslyInOrganization),
      previousOrganization: details.previousOrganization || "",
      canAttendLan: formatExportBoolean(details.canAttendLan),
      teamLogoUrl: details.teamLogoUrl || "",
      additionalMembers: details.additionalMembers || "",
      declarationAccepted: formatExportBoolean(details.declarationAccepted),
      notes: application.notes || "",
      submittedAt: formatExportTimestamp(application.createdAt),
      updatedAt: formatExportTimestamp(application.updatedAt),
    };
  });
  const memberRows = mappedApplications.flatMap((application) =>
    application.members.map((member) => ({
      applicationId: application.id,
      applicationType: application.applicationType,
      applicantName: application.fullName,
      teamName: application.teamName || "",
      memberName: member.name,
      ign: member.ign || "",
      email: member.email,
      discord: member.discord,
      playerId: member.playerId || "",
      phone: member.phone || "",
      role: member.role || "",
      nic: member.nic || "",
      privacyAcceptedAt: formatExportTimestamp(member.privacyAcceptedAt),
    }))
  );

  const buffer = await buildExcelWorkbookBuffer({
    sheets: [
      {
        name: "Applications",
        columns: [
          { header: "Application ID", key: "applicationId", width: 38 },
          { header: "Application Type", key: "applicationType", width: 20 },
          { header: "Status", key: "status", width: 14 },
          { header: "Full Name", key: "fullName", width: 24 },
          { header: "Email", key: "email", width: 28 },
          { header: "Phone", key: "phone", width: 18 },
          { header: "Discord", key: "discord", width: 22 },
          { header: "Game", key: "game", width: 18 },
          { header: "Player ID", key: "playerId", width: 22 },
          { header: "NIC", key: "nic", width: 18 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Current Roster Size", key: "currentRosterSize", width: 18 },
          { header: "Women's League Interest", key: "womensLeagueInterest", width: 22 },
          { header: "IGN", key: "ign", width: 22 },
          { header: "Birthday", key: "birthday", width: 16 },
          { header: "Gender", key: "gender", width: 16 },
          { header: "Rank", key: "rank", width: 24 },
          { header: "Tournament Experience", key: "tournamentExperience", width: 36 },
          { header: "Previously In Organization", key: "previouslyInOrganization", width: 24 },
          { header: "Previous Organization", key: "previousOrganization", width: 26 },
          { header: "Can Attend LAN", key: "canAttendLan", width: 18 },
          { header: "Team Logo URL", key: "teamLogoUrl", width: 32 },
          { header: "Additional Members", key: "additionalMembers", width: 36 },
          { header: "Declaration Accepted", key: "declarationAccepted", width: 22 },
          { header: "Notes", key: "notes", width: 36 },
          { header: "Submitted At", key: "submittedAt", width: 26 },
          { header: "Updated At", key: "updatedAt", width: 26 },
        ],
        rows: applicationRows,
      },
      {
        name: "Team Members",
        columns: [
          { header: "Application ID", key: "applicationId", width: 38 },
          { header: "Application Type", key: "applicationType", width: 20 },
          { header: "Applicant Name", key: "applicantName", width: 24 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Member Name", key: "memberName", width: 24 },
          { header: "IGN", key: "ign", width: 22 },
          { header: "Email", key: "email", width: 28 },
          { header: "Discord", key: "discord", width: 22 },
          { header: "Player ID", key: "playerId", width: 22 },
          { header: "Phone", key: "phone", width: 18 },
          { header: "Role", key: "role", width: 16 },
          { header: "NIC", key: "nic", width: 18 },
          { header: "Privacy Permission At", key: "privacyAcceptedAt", width: 26 },
        ],
        rows: memberRows,
      },
    ],
  });

  return {
    buffer,
    contentType: EXCEL_CONTENT_TYPE,
    filename: buildExportFilename("recruitment-applications"),
    recordCount: mappedApplications.length,
  };
};

const updateRecruitmentApplicationStatus = async (applicationId, body) => {
  const status = normalizeText(body.status).toLowerCase();

  if (!RECRUITMENT_STATUSES.has(status)) {
    throw new HttpError(400, "Invalid recruitment application status.");
  }

  const application = await prisma.recruitmentApplication.update({
    where: { id: applicationId },
    data: { status },
  });

  return mapRecruitmentApplication(application);
};

const deleteRecruitmentApplication = async (applicationId) => {
  const deleted = await prisma.recruitmentApplication.deleteMany({
    where: { id: applicationId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Recruitment application not found.");
  }
};

const getRegistrationsByTournament = async (tournamentId, query = {}) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: TOURNAMENT_SUMMARY_SELECT,
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const result = await listTeamRegistrations({
    ...query,
    tournamentId,
  });

  return {
    tournament,
    ...result,
  };
};

const updateTeamRegistrationStatus = async (
  registrationId,
  body,
  adminUserId,
  auditContext = {}
) => {
  const nextStatus = normalizeText(body.status).toLowerCase();
  const nextPaymentStatus = normalizeText(body.paymentStatus).toLowerCase();
  const nextVerificationStatus = normalizeText(body.verificationStatus).toLowerCase();
  const adminOverridePayment = body.adminOverridePayment === true;
  const reason = normalizeText(body.reason) || null;
  const updateData = {};

  const currentRegistration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    select: {
      status: true,
      waitlistPosition: true,
      paymentStatus: true,
      tournament: { select: { registrationFeeAmount: true, waitlistEnabled: true } },
    },
  });
  if (!currentRegistration) throw new HttpError(404, "Registration not found.");

  if (adminOverridePayment) {
    if (nextStatus && nextStatus !== "approved") {
      throw new HttpError(400, "A payment override can only approve a registration.");
    }
    const registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");
      if (current.status === "rejected") {
        throw new HttpError(409, "Restore the rejected registration to pending before overriding payment.");
      }
      await assertAdminRoleConflict({
        tx,
        tournamentId: current.tournamentId,
        members: current.members || [],
        excludeRegistrationId: current.id,
      });
      const wasWaitlisted = current.status === "waitlisted";
      if (wasWaitlisted) {
        const first = await tx.teamRegistration.findFirst({
          where: { tournamentId: current.tournamentId, status: "waitlisted" },
          orderBy: { waitlistPosition: "asc" },
          select: { id: true },
        });
        if (first?.id !== current.id) {
          throw new HttpError(409, "Only the first waitlisted registration can be promoted.");
        }
      }

      let assignedSlotNumber = current.assignedSlotNumber || current.adminSlotReservation?.assignedSlotNumber;
      if (!assignedSlotNumber) {
        const used = await countTournamentCapacityUsage({
          tx,
          tournamentId: current.tournamentId,
          excludeRegistrationId: current.id,
        });
        if (used >= current.tournament.maxTeams) {
          throw new HttpError(409, "The tournament has no slot available.");
        }
        assignedSlotNumber = await allocateLowestAvailableSlot({
          tx,
          tournamentId: current.tournamentId,
          maxTeams: current.tournament.maxTeams,
          excludeRegistrationId: current.id,
        });
      }

      const quotedFeeAmount = current.adminSlotReservation?.quotedFeeAmount ??
        (current.tournament.paymentMethod === "bank_transfer"
          ? getBankTransferAmountForSlot(current.tournament, assignedSlotNumber)
          : Number(current.tournament.registrationFeeAmount || 0));
      await tx.paymentTransaction.updateMany({
        where: {
          registrationId: current.id,
          status: { in: ["created", "pending", "expired", "review_required"] },
        },
        data: {
          status: "cancelled",
          statusMessage: "Payment waived by an administrator.",
          reconciledAt: new Date(),
          reconciledById: adminUserId,
          reconciliationNote: "Registration approved without payment.",
        },
      });
      if (current.adminSlotReservation) {
        await tx.adminSlotReservation.delete({ where: { registrationId: current.id } });
      }
      const approvalVerificationStatus = await acceptPendingRegistrationInvites({
        tx,
        registrationId: current.id,
        savedTeamId: current.savedTeamId,
        members: current.members,
      });
      const updated = await tx.teamRegistration.update({
        where: { id: current.id },
        data: {
          status: "approved",
          paymentStatus: "paid",
          assignedSlotNumber,
          quotedFeeAmount,
          quotedFeeCurrency: current.adminSlotReservation?.quotedFeeCurrency || current.tournament.registrationFeeCurrency,
          reservedUntil: null,
          waitlistPosition: wasWaitlisted ? null : current.waitlistPosition,
          ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      if (wasWaitlisted) {
        await compactWaitlistPositions({
          tx,
          tournamentId: current.tournamentId,
          position: current.waitlistPosition,
        });
      }
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: "approved",
        reason,
        ...auditContext,
      });
      return updated;
    });
    await activatePaidTeamRegistration(registration.id);
    return mapTeamRegistration(registration);
  }

  if (nextStatus) {
    if (!REGISTRATION_STATUSES.has(nextStatus)) {
      throw new HttpError(400, "Invalid registration status.");
    }
    if (
      nextStatus === "approved" &&
      Number(currentRegistration.tournament.registrationFeeAmount || 0) > 0 &&
      currentRegistration.paymentStatus !== "paid"
    ) {
      throw new HttpError(409, "Paid registrations must be provider-confirmed before approval.");
    }
    if (nextStatus === "waitlisted" && !currentRegistration.tournament.waitlistEnabled) {
      throw new HttpError(409, "Waitlisting is not enabled for this tournament.");
    }
    updateData.status = nextStatus;
  }

  if (nextPaymentStatus) {
    throw new HttpError(
      400,
      "Payment status is provider-controlled and cannot be changed manually."
    );
  }

  if (nextVerificationStatus) {
    if (!VERIFICATION_STATUSES.has(nextVerificationStatus)) {
      throw new HttpError(400, "Invalid verification status.");
    }
    updateData.verificationStatus = nextVerificationStatus;
  }

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(
      400,
      "Provide at least one of status or verificationStatus."
    );
  }

  let registration;
  if (nextStatus === "waitlisted") {
    registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");
      if (!current.tournament.waitlistEnabled) {
        throw new HttpError(409, "Waitlisting is not enabled for this tournament.");
      }
      const waitlistPosition = current.status === "waitlisted" && current.waitlistPosition
        ? current.waitlistPosition
        : await getNextWaitlistPosition({ tx, tournamentId: current.tournamentId });
      if (current.adminSlotReservation) {
        await tx.adminSlotReservation.delete({ where: { registrationId: current.id } });
      }
      const updated = await tx.teamRegistration.update({
        where: { id: registrationId },
        data: {
          ...updateData,
          status: "waitlisted",
          waitlistPosition,
          assignedSlotNumber: null,
          reservedUntil: null,
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: "waitlisted",
        reason,
        ...auditContext,
      });
      return updated;
    });
  } else if (
    nextStatus &&
    ["pending", "approved", "rejected"].includes(nextStatus) &&
    currentRegistration.status === "waitlisted"
  ) {
    registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");

      let data = { ...updateData };
      if (current.status === "waitlisted") {
        if (nextStatus !== "rejected") {
          const first = await tx.teamRegistration.findFirst({
            where: { tournamentId: current.tournamentId, status: "waitlisted" },
            orderBy: { waitlistPosition: "asc" },
            select: { id: true },
          });
          if (first?.id !== current.id) {
            throw new HttpError(409, "Only the first waitlisted registration can be promoted.");
          }
          await assertAdminRoleConflict({
            tx,
            tournamentId: current.tournamentId,
            members: current.members || [],
            excludeRegistrationId: current.id,
          });
          const used = await countTournamentCapacityUsage({
            tx,
            tournamentId: current.tournamentId,
            excludeRegistrationId: current.id,
          });
          if (used >= current.tournament.maxTeams) {
            throw new HttpError(409, "The tournament has no slot available.");
          }
          data.assignedSlotNumber = await allocateLowestAvailableSlot({
            tx,
            tournamentId: current.tournamentId,
            maxTeams: current.tournament.maxTeams,
            excludeRegistrationId: current.id,
          });
          data.waitlistPosition = null;
          if (Number(current.tournament.registrationFeeAmount || 0) === 0) {
            data.paymentStatus = "paid";
          }
        } else {
          data.waitlistPosition = null;
        }
      }
      const approvalVerificationStatus = nextStatus === "approved"
        ? await acceptPendingRegistrationInvites({
            tx,
            registrationId: current.id,
            savedTeamId: current.savedTeamId,
            members: current.members,
          })
        : null;
      const updated = await tx.teamRegistration.update({
        where: { id: registrationId },
        data: {
          ...data,
          ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      if (current.status === "waitlisted") {
        await compactWaitlistPositions({
          tx,
          tournamentId: current.tournamentId,
          position: current.waitlistPosition,
        });
      }
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: nextStatus,
        reason,
        ...auditContext,
      });
      return updated;
    });
  } else {
    if (nextStatus) {
      registration = await runAdminSerializable(async (tx) => {
        const current = await tx.teamRegistration.findUnique({
          where: { id: registrationId },
          select: { id: true, tournamentId: true, status: true, savedTeamId: true, members: true },
        });
        if (!current) throw new HttpError(404, "Registration not found.");
        if (nextStatus !== "rejected") {
          await assertAdminRoleConflict({
            tx,
            tournamentId: current.tournamentId,
            members: current.members || [],
            excludeRegistrationId: current.id,
          });
        }
        const approvalVerificationStatus = nextStatus === "approved"
          ? await acceptPendingRegistrationInvites({
              tx,
              registrationId: current.id,
              savedTeamId: current.savedTeamId,
              members: current.members,
            })
          : null;
        const updated = await tx.teamRegistration.update({
          where: { id: registrationId },
          data: {
            ...updateData,
            ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
          },
          include: TEAM_REGISTRATION_INCLUDE,
        });
        await recordRegistrationStatusAudit({
          tx,
          actorUserId: adminUserId,
          registrationId,
          fromStatus: current.status,
          toStatus: nextStatus,
          reason,
          ...auditContext,
        });
        return updated;
      });
    } else {
      registration = await runAdminSerializable(async (tx) => {
        const current = await tx.teamRegistration.findUnique({
          where: { id: registrationId },
          select: { id: true, verificationStatus: true },
        });
        if (!current) throw new HttpError(404, "Registration not found.");
        const updated = await tx.teamRegistration.update({
          where: { id: registrationId },
          data: updateData,
          include: TEAM_REGISTRATION_INCLUDE,
        });
        await recordRegistrationStatusAudit({
          tx,
          actorUserId: adminUserId,
          registrationId,
          fromStatus: current.verificationStatus,
          toStatus: updateData.verificationStatus,
          reason,
          action: "team_registration.verification_status_changed",
          ...auditContext,
        });
        return updated;
      });
    }
  }

  return mapTeamRegistration(registration);
};

const deleteTeamRegistration = async (registrationId, auditContext = {}) => {
  const registrationSnapshot = {
    teamLogoName: true,
    payments: {
      select: {
        bankTransferProof: {
          select: { storedFilename: true },
        },
      },
    },
  };
  const transaction = typeof prisma.$transaction === "function"
    ? prisma.$transaction.bind(prisma)
    : async (work) => work(prisma);
  const { registration } = await transaction(async (tx) => {
    const current = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: registrationSnapshot,
    });
    if (!current) throw new HttpError(404, "Team registration not found.");
    const result = await tx.teamRegistration.deleteMany({ where: { id: registrationId } });
    if (result.count === 0) throw new HttpError(404, "Team registration not found.");
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.deleted",
        targetType: "TeamRegistration",
        targetId: registrationId,
        beforeData: {
          teamLogoName: current.teamLogoName,
          paymentProofCount: current.payments.filter((payment) => payment.bankTransferProof?.storedFilename).length,
        },
        afterData: { deleted: true },
      });
    }
    return { deleted: result, registration: current };
  });

  const uploads = registration.payments
    .map((payment) => payment.bankTransferProof?.storedFilename)
    .filter(Boolean)
    .map((filename) => ({ directory: bankTransferProofDirectory, filename }));
  await removeUploadsQuietly(
    uploads,
    {
      operation: "deleteTeamRegistration",
      registrationId,
    }
  );
  if (registration.teamLogoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: registration.teamLogoName,
      context: { operation: "deleteTeamRegistration", registrationId },
    });
  }
};

const runLegacyPosterImport = async () => importLegacyPosters();
const runPosterImageAssetMigration = async () => migrateImageAssetsToFilesystem();

const SAVED_TEAM_CAPTAIN_SELECT = {
  firstName: true,
  lastName: true,
  username: true,
};

const SAVED_TEAM_MEMBER_SELECT = {
  id: true,
  role: true,
  name: true,
  email: true,
  phone: true,
  discord: true,
  riotId: true,
  inviteStatus: true,
};

const getSavedTeamCaptainName = (team) =>
  [team.captainUser?.firstName, team.captainUser?.lastName].filter(Boolean).join(" ").trim() ||
  team.captainUser?.username ||
  "Unknown captain";

const mapAdminSavedTeamSummary = (team) => ({
  id: team.id,
  name: team.name,
  teamTag: team.teamTag,
  logoUrl: team.logoName ? `/api/uploads/team-logos/${team.logoName}` : null,
  country: team.country,
  organizationName: team.organizationName || "Independent",
  captainName: getSavedTeamCaptainName(team),
  memberCount: team._count.members,
  updatedAt: team.updatedAt,
});

const mapAdminSavedTeamDetail = (team) => ({
  ...mapAdminSavedTeamSummary(team),
  members: (team.members || []).map((member) => ({
    id: member.id,
    role: member.role,
    name: member.name,
    email: member.email,
    phone: member.phone ?? null,
    discord: member.discord,
    gameId: member.riotId,
    inviteStatus: member.inviteStatus,
  })),
});

const listAdminSavedTeams = async ({ page, pageSize, search } = {}) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const textFilter = { contains: normalizedSearch, mode: "insensitive" };
  const where = normalizedSearch
    ? {
        OR: [
          { name: textFilter },
          { teamTag: textFilter },
          { country: textFilter },
          { organizationName: textFilter },
          { captainUser: { is: { OR: [
            { firstName: textFilter },
            { lastName: textFilter },
            { username: textFilter },
            { email: textFilter },
          ] } } },
          { members: { some: { OR: [
            { name: textFilter },
            { email: textFilter },
            { discord: textFilter },
            { riotId: textFilter },
          ] } } },
        ],
      }
    : {};
  const [total, teams] = await prisma.$transaction([
    prisma.savedTeam.count({ where }),
    prisma.savedTeam.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        name: true,
        teamTag: true,
        logoName: true,
        country: true,
        organizationName: true,
        updatedAt: true,
        captainUser: { select: SAVED_TEAM_CAPTAIN_SELECT },
        _count: { select: { members: true } },
      },
    }),
  ]);
  return buildPagedResponse({
    items: teams.map(mapAdminSavedTeamSummary),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminSavedTeamById = async (teamId) => {
  const team = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      teamTag: true,
      logoName: true,
      country: true,
      organizationName: true,
      updatedAt: true,
      captainUser: { select: SAVED_TEAM_CAPTAIN_SELECT },
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
        select: SAVED_TEAM_MEMBER_SELECT,
      },
      _count: { select: { members: true } },
    },
  });
  if (!team) throw new HttpError(404, "Team not found.");
  return mapAdminSavedTeamDetail(team);
};

const parseAdminTeamMembers = (value) => {
  const validateMembers = (parsed) => {
    const coachCount = parsed.filter(
      (member) => normalizeText(member?.role).toUpperCase() === "COACH"
    ).length;
    if (coachCount > 1) {
      throw new HttpError(400, "A saved team can include at most one coach.");
    }
    return parsed;
  };
  if (Array.isArray(value)) return validateMembers(value);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return validateMembers(parsed);
    }
  } catch {
    // Use the same client-safe validation error for malformed multipart JSON.
  }
  throw new HttpError(400, "Team members must be a valid array.");
};

const syncBracketTeamName = (bracket, registrationIds, name) => {
  let changed = false;
  const shortCode = buildShortCode(name);
  const updateEntry = (entry, registrationId) => {
    if (!entry || !registrationIds.has(registrationId)) return entry;
    if (entry.name === name && entry.shortCode === shortCode) return entry;
    changed = true;
    return { ...entry, name, shortCode };
  };
  const seedData = Array.isArray(bracket.seedData)
    ? bracket.seedData.map((seed) => updateEntry(seed, seed?.id))
    : bracket.seedData;
  const bracketData = Array.isArray(bracket.bracketData?.participant)
    ? {
        ...bracket.bracketData,
        participant: bracket.bracketData.participant.map((participant) =>
          updateEntry(participant, participant?.registrationId)
        ),
      }
    : bracket.bracketData;

  return { changed, seedData, bracketData };
};

const syncScheduleTeamName = (scheduleData, previousNames, name) => {
  if (!Array.isArray(scheduleData?.rows) || previousNames.size === 0) {
    return { changed: false, scheduleData };
  }

  let changed = false;
  const rows = scheduleData.rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (typeof value === "string" && previousNames.has(value) && value !== name) {
        changed = true;
        return [key, name];
      }
      return [key, value];
    }));
  });

  return {
    changed,
    scheduleData: changed ? { ...scheduleData, rows } : scheduleData,
  };
};

const updateAdminSavedTeam = async (teamId, body, file) => {
  const name = normalizeText(body.name);
  const teamTag = normalizeText(body.teamTag) || null;
  const country = normalizeText(body.country) || null;
  const organization = normalizeText(body.organizationName);
  const organizationName = organization && organization.toLowerCase() !== "independent" ? organization : null;
  const members = parseAdminTeamMembers(body.members);
  const removeLogo = ["true", "1", "on"].includes(normalizeText(body.removeLogo).toLowerCase());

  if (!name || name.length > 120) throw new HttpError(400, "Team name is required and must be 120 characters or fewer.");
  if (teamTag && teamTag.length > 20) throw new HttpError(400, "Team tag must be 20 characters or fewer.");
  if (country && country.length > 100) throw new HttpError(400, "Country must be 100 characters or fewer.");
  if (organization.length > 120) throw new HttpError(400, "Organization name is too long.");
  if (members.length > 20) throw new HttpError(400, "A team can include up to 20 members.");

  const existing = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, logoName: true, members: { select: { id: true, role: true } } },
  });
  if (!existing) throw new HttpError(404, "Team not found.");
  const memberIds = new Set(existing.members.map((member) => member.id));
  const existingRolesById = new Map(existing.members.map((member) => [member.id, member.role]));
  const normalizedMembers = members.map((member) => ({
    id: normalizeText(member.id),
    role: normalizeText(member.role).toUpperCase() || null,
    name: normalizeText(member.name),
    email: normalizeEmail(member.email),
    phone: normalizeText(member.phone) || null,
    discord: normalizeText(member.discord) || null,
    riotId: normalizeText(member.riotId || member.gameId) || null,
  }));
  const coachCount = normalizedMembers.filter(
    (member) => (member.role || existingRolesById.get(member.id)) === "COACH"
  ).length;
  if (coachCount > 1) throw new HttpError(400, "A saved team can include at most one coach.");
  if (normalizedMembers.some((member) => !memberIds.has(member.id))) throw new HttpError(400, "One or more roster members do not belong to this team.");
  if (normalizedMembers.some((member) => !member.name || member.name.length > 120)) throw new HttpError(400, "Each roster member needs a name of 120 characters or fewer.");
  if (normalizedMembers.some((member) => !isValidEmail(member.email) || member.email.length > 254)) throw new HttpError(400, "Each roster member needs a valid email address.");
  if (normalizedMembers.some((member) => member.phone && member.phone.length > 50)) throw new HttpError(400, "Roster member phone must be 50 characters or fewer.");
  if (normalizedMembers.some((member) => member.discord && member.discord.length > 100)) throw new HttpError(400, "Roster member Discord must be 100 characters or fewer.");
  if (normalizedMembers.some((member) => member.riotId && member.riotId.length > 100)) throw new HttpError(400, "Roster member Riot ID must be 100 characters or fewer.");
  if (new Set(normalizedMembers.map((member) => member.email)).size !== normalizedMembers.length) throw new HttpError(400, "Roster member emails must be unique.");

  const persistedLogo = file ? await persistTeamLogoUpload(file) : null;
  const logoMutationRequested = Boolean(file) || removeLogo;
  const nextLogoName = file
    ? persistedLogo.filename
    : removeLogo
      ? null
      : existing.logoName;
  const savedTeamData = { name, teamTag, country, organizationName };
  if (logoMutationRequested) savedTeamData.logoName = nextLogoName;
  // Record an explicit removal so the null logo reads as deliberate and a later
  // registration upload cannot resurrect it.
  if (logoMutationRequested && nextLogoName === null) savedTeamData.logoClearedAt = new Date();
  const registrationData = { teamName: name };
  if (logoMutationRequested) registrationData.teamLogoName = nextLogoName;

  try {
    await runAdminSerializable(async (tx) => {
      const currentTeam = logoMutationRequested
        ? await tx.savedTeam.findUnique({
            where: { id: teamId },
            select: { logoName: true },
          })
        : null;
      const previousLogoName = currentTeam?.logoName ?? null;
      const linkedRegistrations = await tx.teamRegistration.findMany({
        where: { savedTeamId: teamId },
        select: { id: true, tournamentId: true, teamName: true },
      });
      await tx.savedTeam.update({
        where: { id: teamId },
        data: savedTeamData,
      });
      for (const member of normalizedMembers) {
        await tx.savedTeamMember.update({
          where: { id: member.id },
          data: { name: member.name, email: member.email, emailNormalized: member.email, phone: member.phone, discord: member.discord, riotId: member.riotId },
        });
      }

      if (linkedRegistrations.length > 0) {
        await tx.teamRegistration.updateMany({
          where: { savedTeamId: teamId },
          data: registrationData,
        });

        if (existing.name !== name) {
          const registrationIds = new Set(linkedRegistrations.map((registration) => registration.id));
          const tournamentIds = [...new Set(linkedRegistrations.map((registration) => registration.tournamentId))];
          const previousNames = new Set([
            existing.name,
            ...linkedRegistrations.map((registration) => registration.teamName),
          ].filter((previousName) => previousName && previousName !== name));
          const brackets = await tx.tournamentBracket.findMany({
            where: { tournamentId: { in: tournamentIds } },
            select: { id: true, seedData: true, bracketData: true },
          });
          for (const bracket of brackets) {
            const synced = syncBracketTeamName(bracket, registrationIds, name);
            if (synced.changed) {
              await tx.tournamentBracket.update({
                where: { id: bracket.id },
                data: { seedData: synced.seedData, bracketData: synced.bracketData },
              });
            }
          }

          const tournaments = await tx.tournament.findMany({
            where: { id: { in: tournamentIds }, scheduleData: { not: Prisma.JsonNull } },
            select: { id: true, scheduleData: true },
          });
          for (const tournament of tournaments) {
            const synced = syncScheduleTeamName(tournament.scheduleData, previousNames, name);
            if (synced.changed) {
              await tx.tournament.update({
                where: { id: tournament.id },
                data: { scheduleData: synced.scheduleData },
              });
            }
          }
        }
      }
      if (previousLogoName && previousLogoName !== nextLogoName) {
        await scheduleTeamLogoCleanup({
          filename: previousLogoName,
          tx,
          context: { operation: "updateAdminSavedTeam", teamId },
        });
      }
      return { previousLogoName };
    });
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "updateAdminSavedTeamRollback", teamId }
      );
    }
    if (error?.code === "P2002") throw new HttpError(409, "That team name, roster email, or role position is already in use.");
    throw error;
  }
  return getAdminSavedTeamById(teamId);
};

const updateAdminSavedTeamOrganization = async (teamId, body) => {
  const requested = normalizeText(body.organizationName);
  if (requested.length > 120) throw new HttpError(400, "Organization name is too long.");
  const updated = await prisma.savedTeam.updateMany({
    where: { id: teamId },
    data: { organizationName: requested && requested.toLowerCase() !== "independent" ? requested : null },
  });
  if (!updated.count) throw new HttpError(404, "Team not found.");
  return { organizationName: requested && requested.toLowerCase() !== "independent" ? requested : "Independent" };
};

const transferAdminSavedTeamCaptain = async ({ teamId, memberId }) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) throw new HttpError(400, "Choose a roster member to become captain.");

  try {
    const transfer = await prisma.$transaction(async (tx) => {
      const team = await tx.savedTeam.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          name: true,
          captainUserId: true,
          captainUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              email: true,
              emailNormalized: true,
            },
          },
          members: {
            select: {
              id: true,
              userId: true,
              role: true,
              memberOrder: true,
              name: true,
              email: true,
              emailNormalized: true,
              discord: true,
              riotId: true,
              inviteStatus: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  emailNormalized: true,
                  emailVerified: true,
                  phone: true,
                  discordTag: true,
                },
              },
            },
          },
          registrations: {
            select: {
              id: true,
              tournamentId: true,
              status: true,
              paymentStatus: true,
              reservedUntil: true,
              captainEmail: true,
              additionalData: true,
              tournament: {
                select: {
                  title: true,
                  game: true,
                  registrationFields: true,
                },
              },
              members: {
                select: {
                  id: true,
                  userId: true,
                  role: true,
                  name: true,
                  email: true,
                  emailNormalized: true,
                  discord: true,
                  riotId: true,
                  additionalData: true,
                  inviteStatus: true,
                },
              },
            },
          },
        },
      });
      if (!team) throw new HttpError(404, "Team not found.");

      const formerCaptain = team.members.find((member) => member.role === "CAPTAIN");
      const candidate = team.members.find((member) => member.id === normalizedMemberId);
      if (!formerCaptain) throw new HttpError(409, "This team does not have a valid captain roster record.");
      if (!candidate) throw new HttpError(404, "The selected roster member was not found on this team.");
      if (candidate.role === "CAPTAIN" || candidate.id === formerCaptain.id) {
        throw new HttpError(409, "That roster member is already the team captain.");
      }
      if (candidate.inviteStatus !== "accepted" || !candidate.userId || !candidate.user) {
        throw new HttpError(409, "The new captain must accept their team invitation with a linked Quest account first.");
      }
      if (!candidate.user.emailVerified) {
        throw new HttpError(409, "The new captain must verify their Quest account email first.");
      }
      if (candidate.user.id !== candidate.userId || candidate.user.emailNormalized !== candidate.emailNormalized) {
        throw new HttpError(409, "The selected roster member is not linked to the matching Quest account.");
      }

      const newCaptainEmail = candidate.user.emailNormalized;
      const newCaptainPhone = normalizeText(candidate.user.phone);
      if (team.registrations.length > 0 && !newCaptainPhone) {
        throw new HttpError(409, "The new captain must add a phone number to their Quest profile before registered teams can be transferred.");
      }

      const ownedTeamConflict = await tx.savedTeam.findFirst({
        where: {
          id: { not: team.id },
          captainUserId: candidate.user.id,
          name: team.name,
        },
        select: { id: true },
      });
      if (ownedTeamConflict) {
        throw new HttpError(409, "The new captain already owns another saved team with this name.");
      }

      if (team.registrations.length > 0) {
        const registrationConflict = await tx.teamRegistration.findFirst({
          where: {
            id: { notIn: team.registrations.map((registration) => registration.id) },
            tournamentId: { in: team.registrations.map((registration) => registration.tournamentId) },
            captainEmail: newCaptainEmail,
          },
          select: { tournament: { select: { title: true } } },
        });
        if (registrationConflict) {
          throw new HttpError(409, `The new captain already has a registration in ${registrationConflict.tournament.title}.`);
        }
      }

      const registrationTransfers = team.registrations.map((registration) => {
        const currentCaptain = registration.members.find((member) => member.role === "CAPTAIN");
        const nextCaptain = registration.members.find((member) =>
          member.id !== currentCaptain?.id &&
          (member.userId === candidate.user.id || member.emailNormalized === newCaptainEmail)
        );
        if (!currentCaptain) {
          throw new HttpError(409, `${registration.tournament.title} does not have a valid captain roster record.`);
        }
        if (!nextCaptain) {
          throw new HttpError(409, `${candidate.name} is not on the saved roster for ${registration.tournament.title}.`);
        }
        if (nextCaptain.inviteStatus !== "accepted") {
          throw new HttpError(409, `${candidate.name} must have an accepted roster place in ${registration.tournament.title}.`);
        }
        const discord = normalizeText(nextCaptain.discord || candidate.discord || candidate.user.discordTag);
        const riotId = normalizeText(nextCaptain.riotId || candidate.riotId);
        if (!discord || !riotId) {
          throw new HttpError(409, `${candidate.name} needs a Discord handle and Game ID for ${registration.tournament.title}.`);
        }
        return { registration, currentCaptain, nextCaptain, discord, riotId };
      });

      for (const item of registrationTransfers) {
        if (!isRegistrationActive(item.registration)) continue;
        const { registration, currentCaptain, nextCaptain, discord, riotId } = item;
        const proposedMembers = registration.members
          .filter((member) => member.id !== currentCaptain.id)
          .map((member) => member.id === nextCaptain.id
            ? {
                ...member,
                userId: candidate.user.id,
                role: "CAPTAIN",
                memberOrder: 0,
                name: nextCaptain.name || candidate.name,
                email: candidate.user.email,
                emailNormalized: newCaptainEmail,
                discord,
                riotId,
              }
            : member);
        await assertAdminRoleConflict({
          tx,
          tournamentId: registration.tournamentId,
          members: proposedMembers,
          excludeRegistrationId: registration.id,
        });
      }

      await tx.savedTeamMember.delete({ where: { id: formerCaptain.id } });
      await tx.savedTeamMember.update({
        where: { id: candidate.id },
        data: {
          userId: candidate.user.id,
          role: "CAPTAIN",
          memberOrder: 0,
          email: candidate.user.email,
          emailNormalized: newCaptainEmail,
          inviteStatus: "accepted",
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
      await tx.savedTeam.update({
        where: { id: team.id },
        data: { captainUserId: candidate.user.id },
      });

      for (const item of registrationTransfers) {
        const { registration, currentCaptain, nextCaptain, discord, riotId } = item;
        const entryData = syncGameIdentityData({
          additionalData: registration.additionalData,
          registrationFields: registration.tournament.registrationFields,
          scope: "entry",
          game: registration.tournament.game,
          gameId: riotId,
        });
        const memberData = syncGameIdentityData({
          additionalData: nextCaptain.additionalData,
          registrationFields: registration.tournament.registrationFields,
          scope: "member",
          game: registration.tournament.game,
          gameId: riotId,
        });

        await tx.registrationMember.delete({ where: { id: currentCaptain.id } });
        await tx.registrationMember.update({
          where: { id: nextCaptain.id },
          data: {
            userId: candidate.user.id,
            role: "CAPTAIN",
            memberOrder: 0,
            name: nextCaptain.name || candidate.name,
            email: candidate.user.email,
            emailNormalized: newCaptainEmail,
            discord,
            riotId,
            inviteStatus: "accepted",
            inviteTokenHash: null,
            inviteExpiresAt: null,
            ...(memberData.changed ? { additionalData: memberData.data } : {}),
          },
        });
        await tx.teamRegistration.update({
          where: { id: registration.id },
          data: {
            userId: candidate.user.id,
            captainName: nextCaptain.name || candidate.name,
            captainEmail: newCaptainEmail,
            captainPhone: newCaptainPhone,
            captainDiscord: discord,
            captainRiotId: riotId,
            contactEmail: newCaptainEmail,
            ...(entryData.changed ? { additionalData: entryData.data } : {}),
          },
        });
      }

      const formerCaptainName = [
        team.captainUser.firstName,
        team.captainUser.lastName,
      ].filter(Boolean).join(" ").trim() || team.captainUser.username;
      return {
        before: {
          captainUserId: team.captainUserId,
          captainName: formerCaptainName,
          captainEmail: team.captainUser.emailNormalized,
        },
        after: {
          captainUserId: candidate.user.id,
          captainName: candidate.name,
          captainEmail: newCaptainEmail,
        },
        removedMemberId: formerCaptain.id,
        registrationIds: team.registrations.map((registration) => registration.id),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      team: await getAdminSavedTeamById(teamId),
      transfer,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      throw new HttpError(409, "The captain transfer conflicts with an existing team or tournament registration.");
    }
    if (error?.code === "P2034") {
      throw new HttpError(409, "The team changed while the captain was being transferred. Reload the team and try again.");
    }
    throw error;
  }
};

const deleteAdminSavedTeam = async (teamId) => {
  const team = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: { id: true, logoName: true },
  });
  if (!team) throw new HttpError(404, "Team not found.");

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

  const deleted = await prisma.savedTeam.deleteMany({
    where: { id: team.id },
  });
  if (!deleted.count) throw new HttpError(404, "Team not found.");

  if (team.logoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: team.logoName,
      context: { operation: "deleteAdminSavedTeam", teamId },
    });
  }
};

const reserveAdminRegistrationSlot = async ({ registrationId, adminUserId, body, auditContext = {} }) => {
  const note = normalizeText(body?.note) || null;
  if (note && note.length > 300) throw new HttpError(400, "Reservation note must be 300 characters or fewer.");
  return prisma.$transaction(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: {
          select: {
            id: true,
            maxTeams: true,
            paymentMethod: true,
            registrationFeeAmount: true,
            registrationFeeCurrency: true,
            registrationFeeTiers: true,
          },
        },
        members: { select: { inviteStatus: true } },
        adminSlotReservation: true,
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");
    if (registration.paymentStatus === "paid" || registration.status === "rejected") throw new HttpError(409, "This registration does not need a reserved slot.");
    if (!registration.members.some((member) => member.inviteStatus === "pending")) throw new HttpError(409, "Only teams with pending member invitations can receive an admin hold.");
    if (registration.adminSlotReservation) throw new HttpError(409, "This team already has an admin-reserved slot.");
    const used = await countTournamentCapacityUsage({ tx, tournamentId: registration.tournamentId, excludeRegistrationId: registration.id });
    if (used >= registration.tournament.maxTeams) throw new HttpError(409, "The tournament has no slot available to reserve.");
    const assignedSlotNumber = await allocateLowestAvailableSlot({
      tx,
      tournamentId: registration.tournamentId,
      maxTeams: registration.tournament.maxTeams,
      excludeRegistrationId: registration.id,
    });
    const quotedFeeAmount = registration.tournament.paymentMethod === "bank_transfer"
      ? getBankTransferAmountForSlot(registration.tournament, assignedSlotNumber)
      : Number(registration.tournament.registrationFeeAmount);
    const reservation = await tx.adminSlotReservation.create({
      data: {
        tournamentId: registration.tournamentId,
        registrationId,
        createdById: adminUserId,
        assignedSlotNumber,
        quotedFeeAmount,
        quotedFeeCurrency: registration.tournament.registrationFeeCurrency,
        note,
      },
    });
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.slot_reserved",
        targetType: "AdminSlotReservation",
        targetId: reservation.id,
        afterData: {
          registrationId,
          assignedSlotNumber: reservation.assignedSlotNumber,
          quotedFeeAmount: reservation.quotedFeeAmount,
          quotedFeeCurrency: reservation.quotedFeeCurrency,
        },
      });
    }
    return reservation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const releaseAdminRegistrationSlot = async (registrationId, auditContext = {}) => {
  if (!auditContext.actorUserId && !auditContext.requestId && !auditContext.ipAddress) {
    const removed = await prisma.adminSlotReservation.deleteMany({ where: { registrationId } });
    if (!removed.count) throw new HttpError(404, "Admin slot reservation not found.");
    return;
  }
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.adminSlotReservation.findUnique({ where: { registrationId } });
    if (!reservation) throw new HttpError(404, "Admin slot reservation not found.");
    await tx.adminSlotReservation.delete({ where: { id: reservation.id } });
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.slot_released",
        targetType: "AdminSlotReservation",
        targetId: reservation.id,
        beforeData: {
          registrationId,
          assignedSlotNumber: reservation.assignedSlotNumber,
          quotedFeeAmount: reservation.quotedFeeAmount,
          quotedFeeCurrency: reservation.quotedFeeCurrency,
        },
      });
    }
  });
};

module.exports = {
  getAdminDashboardData,
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  listContactMessages,
  updateContactMessageReadStatus,
  deleteContactMessage,
  listTeamRegistrations,
  getAdminTeamRegistrationById,
  updateTeamRegistrationGameIds,
  correctTeamRegistrationRoster,
  exportTeamRegistrations,
  listRecruitmentApplications,
  exportRecruitmentApplications,
  updateRecruitmentApplicationStatus,
  deleteRecruitmentApplication,
  getRegistrationsByTournament,
  updateTeamRegistrationStatus,
  deleteTeamRegistration,
  runLegacyPosterImport,
  runPosterImageAssetMigration,
  listAdminSavedTeams,
  getAdminSavedTeamById,
  updateAdminSavedTeam,
  updateAdminSavedTeamOrganization,
  transferAdminSavedTeamCaptain,
  deleteAdminSavedTeam,
  reserveAdminRegistrationSlot,
  releaseAdminRegistrationSlot,
};
