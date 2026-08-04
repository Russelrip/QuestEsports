const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { invalidateCache } = require("../../middleware/response-cache");
const { imageUpload } = require("../../middleware/upload");
const {
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
} = require("./admin.controller");

const router = express.Router();

router.use("/admin", requireAdmin);

router.get("/admin/dashboard", getDashboard);
router.get("/admin/users", getUsers);
router.post("/admin/users", createUser);
router.get("/admin/users/:userId", getUser);
router.patch("/admin/users/:userId", updateUser);
router.delete("/admin/users/:userId", removeUser);
router.get("/admin/contact-messages", getContactMessages);
router.patch("/admin/contact-messages/:messageId", updateContactMessageStatus);
router.delete("/admin/contact-messages/:messageId", removeContactMessage);
router.get("/admin/team-registrations", getTeamRegistrations);
router.get("/admin/team-registrations/export", downloadTeamRegistrations);
router.get("/admin/team-registrations/:registrationId", getTeamRegistration);
router.get("/admin/tournaments/:tournamentId/registrations", getTournamentRegistrations);
router.patch("/admin/team-registrations/:registrationId/status", invalidateCache("tournaments"), updateRegistrationStatus);
router.patch("/admin/team-registrations/:registrationId/game-ids", updateRegistrationGameIds);
router.patch("/admin/team-registrations/:registrationId/roster", invalidateCache("tournaments"), correctRegistrationRoster);
router.delete("/admin/team-registrations/:registrationId", invalidateCache("tournaments"), removeRegistration);
router.post("/admin/team-registrations/:registrationId/slot-reservation", invalidateCache("tournaments"), reserveRegistrationSlot);
router.delete("/admin/team-registrations/:registrationId/slot-reservation", invalidateCache("tournaments"), releaseRegistrationSlot);
router.get("/admin/recruitment-applications", getRecruitmentApplications);
router.get("/admin/recruitment-applications/export", downloadRecruitmentApplications);
router.patch("/admin/recruitment-applications/:applicationId/status", updateRecruitmentStatus);
router.delete("/admin/recruitment-applications/:applicationId", removeRecruitmentApplication);
router.post("/admin/media/import-legacy-posters", importLegacyPosterMedia);
router.post("/admin/media/migrate-image-assets", migratePosterMediaToFilesystem);
router.get("/admin/teams", getSavedTeams);
router.get("/admin/teams/:teamId", getSavedTeam);
router.patch(
  "/admin/teams/:teamId",
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments"),
  updateSavedTeam
);
router.patch("/admin/teams/:teamId/organization", updateSavedTeamOrganization);
router.post(
  "/admin/teams/:teamId/captain-transfer",
  invalidateCache("tournaments"),
  transferSavedTeamCaptain
);
router.delete("/admin/teams/:teamId", removeSavedTeam);

module.exports = router;
