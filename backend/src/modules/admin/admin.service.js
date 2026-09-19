// The admin dashboard's service surface. The code lives beside it:
// - admin-shared.js: statuses, the serializable-transaction retry, registration
//   selects and mappers, and the status-change audit.
// - admin-dashboard.service.js: dashboard counts and the poster maintenance jobs.
// - admin-users.service.js: user accounts.
// - admin-contact.service.js: contact messages.
// - admin-recruitment.service.js: recruitment applications and their export.
// - admin-registrations.service.js: registration lists, exports, game ids,
//   logos, deletion and slot holds.
// - admin-registration-status.service.js: approving, rejecting and otherwise
//   moving a registration's status, with the roster snapshot on approval.
// - admin-roster.service.js: an admin's roster corrections.
// - admin-saved-teams.service.js: saved-team list, detail and deletion.
// - admin-saved-team-edit.service.js: editing a saved team and transferring
//   its captaincy.
const { updateTeamRegistrationStatus } = require("./admin-registration-status.service");
const {
  listContactMessages,
  updateContactMessageReadStatus,
  deleteContactMessage,
} = require("./admin-contact.service");
const {
  listRecruitmentApplications,
  exportRecruitmentApplications,
  updateRecruitmentApplicationStatus,
  deleteRecruitmentApplication,
} = require("./admin-recruitment.service");
const {
  listTeamRegistrations,
  getAdminTeamRegistrationById,
  updateTeamRegistrationGameIds,
  exportTeamRegistrations,
  getRegistrationsByTournament,
  deleteTeamRegistration,
  updateTeamRegistrationLogo,
  reserveAdminRegistrationSlot,
  releaseAdminRegistrationSlot,
} = require("./admin-registrations.service");
const {
  getAdminDashboardData,
  runLegacyPosterImport,
  runPosterImageAssetMigration,
} = require("./admin-dashboard.service");
const {
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
} = require("./admin-users.service");
const { correctTeamRegistrationRoster } = require("./admin-roster.service");
const {
  listAdminSavedTeams,
  getAdminSavedTeamById,
  updateAdminSavedTeamOrganization,
  deleteAdminSavedTeam,
} = require("./admin-saved-teams.service");
const {
  updateAdminSavedTeam,
  transferAdminSavedTeamCaptain,
} = require("./admin-saved-team-edit.service");

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
  updateTeamRegistrationLogo,
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
