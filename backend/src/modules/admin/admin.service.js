const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { decryptSecret } = require("../../lib/secret-box");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
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
} = require("../../lib/validation");
const { mapUserForResponse, validateUserBasics } = require("../auth/auth.service");

const REGISTRATION_STATUSES = new Set(["pending", "approved", "rejected"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid"]);
const VERIFICATION_STATUSES = new Set(["pending", "verified", "flagged"]);
const RECRUITMENT_STATUSES = new Set(["pending", "reviewed", "accepted", "rejected"]);
const USER_ROLES = new Set(["user", "admin"]);

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
  status: true,
  isPublished: true,
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
  createdAt: registration.createdAt,
  contactEmail: registration.contactEmail,
  logoUrl: registration.teamLogoName
    ? `/api/uploads/team-logos/${registration.teamLogoName}`
    : null,
  tournament: registration.tournament,
  captain: {
    name: registration.captainName,
    email: registration.captainEmail,
    phone: registration.captainPhone,
    discord: registration.captainDiscord,
    riotId: registration.captainRiotId,
  },
  members: registration.members
    .slice()
    .sort((left, right) => left.memberOrder - right.memberOrder)
    .map(mapRegistrationMember),
});

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
  search,
  tournamentId,
  tournament,
  status,
  paymentStatus,
  verificationStatus,
}) => {
  const normalizedSearch = normalizeText(search);
  const normalizedTournament = normalizeText(tournament);
  const normalizedStatus = normalizeText(status).toLowerCase();
  const normalizedPaymentStatus = normalizeText(paymentStatus).toLowerCase();
  const normalizedVerificationStatus = normalizeText(verificationStatus).toLowerCase();

  return {
    ...(tournamentId ? { tournamentId } : {}),
    ...(normalizedTournament
      ? {
          tournament: {
            OR: [
              { id: normalizedTournament },
              { slug: normalizedTournament },
              { title: { contains: normalizedTournament, mode: "insensitive" } },
            ],
          },
        }
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
  const [totalTournaments, openTournaments, totalRegistrations, pendingRecruitmentApplications, unreadContactMessages] =
    await prisma.$transaction([
      prisma.tournament.count(),
      prisma.tournament.count({ where: { status: "registration_open" } }),
      prisma.teamRegistration.count(),
      prisma.recruitmentApplication.count({ where: { status: "pending" } }),
      prisma.contactSubmission.count({ where: { isRead: false } }),
    ]);

  return {
    totalTournaments,
    openTournaments,
    totalRegistrations,
    pendingRecruitmentApplications,
    unreadContactMessages,
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

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Password is required.";
  } else if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
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

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (password) {
    if (password.length < 8) {
      fieldErrors.password = "Password must be at least 8 characters long.";
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
  if (password) {
    nextPasswordHash = await bcrypt.hash(password, 10);
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
        ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
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
      include: TEAM_REGISTRATION_INCLUDE,
    }),
    prisma.tournament.findMany({
      orderBy: { startDate: { sort: "desc", nulls: "last" } },
      select: TOURNAMENT_SUMMARY_SELECT,
    }),
  ]);

  return {
    ...buildPagedResponse({
      items: registrations.map(mapTeamRegistration),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    tournaments,
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
    contactEmail: registration.contactEmail,
    rosterCount: registration.members.length,
    acceptedMembers: registration.members.filter((member) => member.inviteStatus === "accepted").length,
    submittedAt: formatExportTimestamp(registration.createdAt),
    logoUrl: registration.logoUrl || "",
  }));
  const memberRows = mappedRegistrations.flatMap((registration) =>
    registration.members.map((member) => ({
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
        ],
        rows: memberRows,
      },
    ],
  });

  return {
    buffer,
    contentType: EXCEL_CONTENT_TYPE,
    filename: buildExportFilename("recruitment-applications"),
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

const updateTeamRegistrationStatus = async (registrationId, body) => {
  const nextStatus = normalizeText(body.status).toLowerCase();
  const nextPaymentStatus = normalizeText(body.paymentStatus).toLowerCase();
  const nextVerificationStatus = normalizeText(body.verificationStatus).toLowerCase();
  const updateData = {};

  const currentRegistration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    select: {
      paymentStatus: true,
      tournament: { select: { registrationFeeAmount: true } },
    },
  });
  if (!currentRegistration) throw new HttpError(404, "Registration not found.");

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

  const registration = await prisma.teamRegistration.update({
    where: { id: registrationId },
    data: updateData,
    include: TEAM_REGISTRATION_INCLUDE,
  });

  return mapTeamRegistration(registration);
};

const deleteTeamRegistration = async (registrationId) => {
  const registration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    select: {
      teamLogoName: true,
    },
  });

  if (!registration) {
    throw new HttpError(404, "Team registration not found.");
  }

  const deleted = await prisma.teamRegistration.deleteMany({
    where: { id: registrationId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Team registration not found.");
  }

  await removeUploadsQuietly(
    registration.teamLogoName
      ? [
          {
            directory: teamLogoDirectory,
            filename: registration.teamLogoName,
          },
        ]
      : [],
    {
      operation: "deleteTeamRegistration",
      registrationId,
    }
  );
};

const runLegacyPosterImport = async () => importLegacyPosters();
const runPosterImageAssetMigration = async () => migrateImageAssetsToFilesystem();

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
};
