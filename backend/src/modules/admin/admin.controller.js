const { asyncHandler } = require("../../lib/async-handler");
const {
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
  listAdminSavedTeams,
  updateAdminSavedTeamOrganization,
} = require("./admin.service");

const sendExcelExport = (res, exportFile) => {
  res.setHeader("Content-Type", exportFile.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${exportFile.filename}"`
  );
  res.status(200).send(exportFile.buffer);
};

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await getAdminDashboardData();

  res.status(200).json({
    success: true,
    stats,
  });
});

const getUsers = asyncHandler(async (req, res) => {
  const result = await listAdminUsers(req.query);

  res.status(200).json({
    success: true,
    users: result.items,
    pagination: result.pagination,
  });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await getAdminUserById(req.params.userId);

  res.status(200).json({
    success: true,
    user,
  });
});

const createUser = asyncHandler(async (req, res) => {
  const user = await createAdminUser({ body: req.body });

  res.status(201).json({
    success: true,
    message: "User created successfully.",
    user,
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await updateAdminUser({
    userId: req.params.userId,
    body: req.body,
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    message: "User updated successfully.",
    user,
  });
});

const removeUser = asyncHandler(async (req, res) => {
  await deleteAdminUser({
    userId: req.params.userId,
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    message: "User deleted successfully.",
  });
});

const getContactMessages = asyncHandler(async (req, res) => {
  const result = await listContactMessages(req.query);

  res.status(200).json({
    success: true,
    messages: result.items,
    pagination: result.pagination,
  });
});

const updateContactMessageStatus = asyncHandler(async (req, res) => {
  const contactMessage = await updateContactMessageReadStatus(
    req.params.messageId,
    req.body.isRead
  );

  res.status(200).json({
    success: true,
    message: "Contact message updated successfully.",
    contactMessage,
  });
});

const removeContactMessage = asyncHandler(async (req, res) => {
  await deleteContactMessage(req.params.messageId);

  res.status(200).json({
    success: true,
    message: "Contact message deleted successfully.",
  });
});

const getTeamRegistrations = asyncHandler(async (req, res) => {
  const result = await listTeamRegistrations(req.query);

  res.status(200).json({
    success: true,
    registrations: result.items,
    tournaments: result.tournaments,
    pagination: result.pagination,
  });
});

const getTournamentRegistrations = asyncHandler(async (req, res) => {
  const result = await getRegistrationsByTournament(
    req.params.tournamentId,
    req.query
  );

  res.status(200).json({
    success: true,
    tournament: result.tournament,
    registrations: result.items,
    tournaments: result.tournaments,
    pagination: result.pagination,
  });
});

const downloadTeamRegistrations = asyncHandler(async (req, res) => {
  const exportFile = await exportTeamRegistrations(req.query);
  sendExcelExport(res, exportFile);
});

const updateRegistrationStatus = asyncHandler(async (req, res) => {
  const registration = await updateTeamRegistrationStatus(
    req.params.registrationId,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Registration updated successfully.",
    registration,
  });
});

const removeRegistration = asyncHandler(async (req, res) => {
  await deleteTeamRegistration(req.params.registrationId);

  res.status(200).json({
    success: true,
    message: "Team registration deleted successfully.",
  });
});

const getRecruitmentApplications = asyncHandler(async (req, res) => {
  const result = await listRecruitmentApplications(req.query);

  res.status(200).json({
    success: true,
    applications: result.items,
    pagination: result.pagination,
  });
});

const downloadRecruitmentApplications = asyncHandler(async (req, res) => {
  const exportFile = await exportRecruitmentApplications(req.query);
  sendExcelExport(res, exportFile);
});

const updateRecruitmentStatus = asyncHandler(async (req, res) => {
  const application = await updateRecruitmentApplicationStatus(
    req.params.applicationId,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Recruitment application updated successfully.",
    application,
  });
});

const removeRecruitmentApplication = asyncHandler(async (req, res) => {
  await deleteRecruitmentApplication(req.params.applicationId);

  res.status(200).json({
    success: true,
    message: "Recruitment application deleted successfully.",
  });
});

const importLegacyPosterMedia = asyncHandler(async (req, res) => {
  const summary = await runLegacyPosterImport();

  res.status(200).json({
    success: true,
    message: "Legacy poster import finished.",
    summary,
  });
});

const migratePosterMediaToFilesystem = asyncHandler(async (req, res) => {
  const summary = await runPosterImageAssetMigration();

  res.status(200).json({
    success: true,
    message: "Poster image asset migration finished.",
    summary,
  });
});

const getSavedTeams = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, teams: await listAdminSavedTeams(req.query) });
});

const updateSavedTeamOrganization = asyncHandler(async (req, res) => {
  const team = await updateAdminSavedTeamOrganization(req.params.teamId, req.body);
  res.status(200).json({ success: true, message: "Team organization updated.", team });
});

module.exports = {
  getDashboard,
  getUsers,
  getUser,
  createUser,
  updateUser,
  removeUser,
  getContactMessages,
  updateContactMessageStatus,
  removeContactMessage,
  getTeamRegistrations,
  getTournamentRegistrations,
  downloadTeamRegistrations,
  updateRegistrationStatus,
  removeRegistration,
  getRecruitmentApplications,
  downloadRecruitmentApplications,
  updateRecruitmentStatus,
  removeRecruitmentApplication,
  importLegacyPosterMedia,
  migratePosterMediaToFilesystem,
  getSavedTeams,
  updateSavedTeamOrganization,
};
