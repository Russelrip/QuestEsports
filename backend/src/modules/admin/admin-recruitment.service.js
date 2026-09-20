const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  EXCEL_CONTENT_TYPE,
  MAX_EXCEL_EXPORT_RECORDS,
  assertExportRecordLimit,
  buildExcelWorkbookBuffer,
  buildExportFilename,
  formatExportBoolean,
  formatExportTimestamp,
} = require("../../lib/excel-export");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const { normalizeText } = require("../../lib/validation");
const { RECRUITMENT_STATUSES, decryptNic } = require("./admin-shared");

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

module.exports = {
  listRecruitmentApplications,
  exportRecruitmentApplications,
  updateRecruitmentApplicationStatus,
  deleteRecruitmentApplication,
};
