const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
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

const getTeamRegistration = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    registration: await getAdminTeamRegistrationById(req.params.registrationId),
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
  await recordAudit({
    ...requestAuditContext(req),
    action: "team_registration.exported",
    targetType: "TeamRegistration",
    afterData: { filters: req.query, recordCount: exportFile.recordCount },
  });
  sendExcelExport(res, exportFile);
});

const updateRegistrationStatus = asyncHandler(async (req, res) => {
  const registration = await updateTeamRegistrationStatus(
    req.params.registrationId,
    req.body,
    req.user.id,
    requestAuditContext(req)
  );
  if (!req.body.status && req.body.verificationStatus) {
    await recordAudit({
      ...requestAuditContext(req),
      action: "team_registration.verification_status_changed",
      targetType: "TeamRegistration",
      targetId: req.params.registrationId,
      afterData: { verificationStatus: registration.verificationStatus },
    });
  }

  res.status(200).json({
    success: true,
    message: "Registration updated successfully.",
    registration,
  });
});

const updateRegistrationGameIds = asyncHandler(async (req, res) => {
  const registration = await updateTeamRegistrationGameIds(
    req.params.registrationId,
    req.body,
    requestAuditContext(req)
  );

  res.status(200).json({
    success: true,
    message: "Registration Game IDs updated successfully.",
    registration,
  });
});

const correctRegistrationRoster = asyncHandler(async (req, res) => {
  const result = await correctTeamRegistrationRoster(
    req.params.registrationId,
    req.body,
    requestAuditContext(req)
  );

  res.status(200).json({
    success: true,
    message: "Registration roster corrected successfully.",
    registration: result.registration,
  });
});

const removeRegistration = asyncHandler(async (req, res) => {
  await deleteTeamRegistration(req.params.registrationId);
  await recordAudit({
    ...requestAuditContext(req),
    action: "team_registration.deleted",
    targetType: "TeamRegistration",
    targetId: req.params.registrationId,
  });

  res.status(200).json({
    success: true,
    message: "Team registration deleted successfully.",
  });
});

const reserveRegistrationSlot = asyncHandler(async (req, res) => {
  const reservation = await reserveAdminRegistrationSlot({ registrationId: req.params.registrationId, adminUserId: req.user.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "team_registration.slot_reserved",
    targetType: "AdminSlotReservation",
    targetId: reservation.id || req.params.registrationId,
    afterData: { registrationId: req.params.registrationId, expiresAt: reservation.expiresAt || null },
  });
  res.status(201).json({ success: true, message: "Slot reserved privately for this team.", reservation });
});

const releaseRegistrationSlot = asyncHandler(async (req, res) => {
  await releaseAdminRegistrationSlot(req.params.registrationId);
  await recordAudit({
    ...requestAuditContext(req),
    action: "team_registration.slot_released",
    targetType: "AdminSlotReservation",
    targetId: req.params.registrationId,
  });
  res.status(200).json({ success: true, message: "Private slot reservation released." });
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
  await recordAudit({
    ...requestAuditContext(req),
    action: "recruitment_application.exported",
    targetType: "RecruitmentApplication",
    afterData: { filters: req.query, recordCount: exportFile.recordCount },
  });
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
  const result = await listAdminSavedTeams(req.query);
  res.status(200).json({ success: true, teams: result.items, pagination: result.pagination });
});

const getSavedTeam = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, team: await getAdminSavedTeamById(req.params.teamId) });
});

const updateSavedTeamOrganization = asyncHandler(async (req, res) => {
  const team = await updateAdminSavedTeamOrganization(req.params.teamId, req.body);
  await recordAudit({
    ...requestAuditContext(req),
    action: "saved_team.organization_updated",
    targetType: "SavedTeam",
    targetId: req.params.teamId,
    afterData: { organization: team.organization || null },
  });
  res.status(200).json({ success: true, message: "Team organization updated.", team });
});

const updateSavedTeam = asyncHandler(async (req, res) => {
  const team = await updateAdminSavedTeam(req.params.teamId, req.body, req.file);
  await recordAudit({
    ...requestAuditContext(req),
    action: "saved_team.updated",
    targetType: "SavedTeam",
    targetId: req.params.teamId,
    afterData: { memberCount: team.members?.length || 0, hasLogo: Boolean(team.logoUrl) },
  });
  res.status(200).json({ success: true, message: "Team updated successfully.", team });
});

const transferSavedTeamCaptain = asyncHandler(async (req, res) => {
  const result = await transferAdminSavedTeamCaptain({
    teamId: req.params.teamId,
    memberId: req.body?.memberId,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "saved_team.captain_transferred",
    targetType: "SavedTeam",
    targetId: req.params.teamId,
    beforeData: result.transfer.before,
    afterData: {
      ...result.transfer.after,
      removedMemberId: result.transfer.removedMemberId,
      registrationIds: result.transfer.registrationIds,
    },
  });
  res.status(200).json({
    success: true,
    message: "Captain transferred and former captain removed successfully.",
    team: result.team,
  });
});

const removeSavedTeam = asyncHandler(async (req, res) => {
  await deleteAdminSavedTeam(req.params.teamId);
  await recordAudit({
    ...requestAuditContext(req),
    action: "saved_team.deleted",
    targetType: "SavedTeam",
    targetId: req.params.teamId,
  });
  res.status(200).json({ success: true, message: "Team deleted successfully." });
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
  getTeamRegistration,
  getTournamentRegistrations,
  downloadTeamRegistrations,
  updateRegistrationStatus,
  updateRegistrationGameIds,
  correctRegistrationRoster,
  removeRegistration,
  reserveRegistrationSlot,
  releaseRegistrationSlot,
  getRecruitmentApplications,
  downloadRecruitmentApplications,
  updateRecruitmentStatus,
  removeRecruitmentApplication,
  importLegacyPosterMedia,
  migratePosterMediaToFilesystem,
  getSavedTeams,
  getSavedTeam,
  updateSavedTeam,
  updateSavedTeamOrganization,
  transferSavedTeamCaptain,
  removeSavedTeam,
};
