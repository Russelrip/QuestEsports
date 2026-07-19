const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { invalidateCache } = require("../../middleware/response-cache");
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
  getTournamentRegistrations,
  downloadTeamRegistrations,
  updateRegistrationStatus,
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
  updateSavedTeam,
  updateSavedTeamOrganization,
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
router.get("/admin/tournaments/:tournamentId/registrations", getTournamentRegistrations);
router.patch("/admin/team-registrations/:registrationId/status", invalidateCache("tournaments"), updateRegistrationStatus);
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
router.patch("/admin/teams/:teamId", updateSavedTeam);
router.patch("/admin/teams/:teamId/organization", updateSavedTeamOrganization);
router.delete("/admin/teams/:teamId", removeSavedTeam);

module.exports = router;
