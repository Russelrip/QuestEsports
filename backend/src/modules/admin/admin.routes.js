const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { requireStaffPermission } = require("../permissions/permission.middleware");
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
  updateRegistrationLogo,
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
  resendSavedTeamInvite,
  resendRegistrationInvite,
  removeSavedTeam,
} = require("./admin.controller");

const router = express.Router();
const contactMessagesStaff = requireStaffPermission("contact_messages");
const registrationsStaff = requireStaffPermission("registrations");
const recruitmentStaff = requireStaffPermission("recruitment");
const teamsStaff = requireStaffPermission("teams");

// Each route names its own guard: the overview, users and legacy media
// migrations are admin-only, everything else is a staff area (see
// staff-permission.service). There is deliberately no blanket /admin guard here,
// because this router is mounted ahead of other routers whose /admin routes
// carry their own staff-area guards.

router.get("/admin/dashboard", requireAdmin, getDashboard);
router.get("/admin/users", requireAdmin, getUsers);
router.post("/admin/users", requireAdmin, createUser);
router.get("/admin/users/:userId", requireAdmin, getUser);
router.patch("/admin/users/:userId", requireAdmin, updateUser);
router.delete("/admin/users/:userId", requireAdmin, removeUser);
router.get("/admin/contact-messages", contactMessagesStaff, getContactMessages);
router.patch("/admin/contact-messages/:messageId", contactMessagesStaff, updateContactMessageStatus);
router.delete("/admin/contact-messages/:messageId", contactMessagesStaff, removeContactMessage);
router.get("/admin/team-registrations", registrationsStaff, getTeamRegistrations);
router.get("/admin/team-registrations/export", registrationsStaff, downloadTeamRegistrations);
router.get("/admin/team-registrations/:registrationId", registrationsStaff, getTeamRegistration);
router.get("/admin/tournaments/:tournamentId/registrations", registrationsStaff, getTournamentRegistrations);
router.patch("/admin/team-registrations/:registrationId/status", registrationsStaff, invalidateCache("tournaments", "foundation"), updateRegistrationStatus);
router.patch("/admin/team-registrations/:registrationId/game-ids", registrationsStaff, invalidateCache("tournaments", "foundation"), updateRegistrationGameIds);
router.patch(
  "/admin/team-registrations/:registrationId/logo",
  registrationsStaff,
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments", "foundation"),
  updateRegistrationLogo
);
router.patch("/admin/team-registrations/:registrationId/roster", registrationsStaff, invalidateCache("tournaments", "foundation"), correctRegistrationRoster);
router.post(
  "/admin/team-registrations/:registrationId/members/:memberId/resend-invite",
  registrationsStaff,
  invalidateCache("tournaments", "foundation"),
  resendRegistrationInvite
);
router.delete("/admin/team-registrations/:registrationId", registrationsStaff, invalidateCache("tournaments", "foundation"), removeRegistration);
router.post("/admin/team-registrations/:registrationId/slot-reservation", registrationsStaff, invalidateCache("tournaments", "foundation"), reserveRegistrationSlot);
router.delete("/admin/team-registrations/:registrationId/slot-reservation", registrationsStaff, invalidateCache("tournaments", "foundation"), releaseRegistrationSlot);
router.get("/admin/recruitment-applications", recruitmentStaff, getRecruitmentApplications);
router.get("/admin/recruitment-applications/export", recruitmentStaff, downloadRecruitmentApplications);
router.patch("/admin/recruitment-applications/:applicationId/status", recruitmentStaff, updateRecruitmentStatus);
router.delete("/admin/recruitment-applications/:applicationId", recruitmentStaff, removeRecruitmentApplication);
router.post("/admin/media/import-legacy-posters", requireAdmin, importLegacyPosterMedia);
router.post("/admin/media/migrate-image-assets", requireAdmin, migratePosterMediaToFilesystem);
router.get("/admin/teams", teamsStaff, getSavedTeams);
router.get("/admin/teams/:teamId", teamsStaff, getSavedTeam);
router.patch(
  "/admin/teams/:teamId",
  teamsStaff,
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments", "foundation"),
  updateSavedTeam
);
router.patch("/admin/teams/:teamId/organization", teamsStaff, invalidateCache("tournaments", "foundation"), updateSavedTeamOrganization);
router.post(
  "/admin/teams/:teamId/captain-transfer",
  teamsStaff,
  invalidateCache("tournaments", "foundation"),
  transferSavedTeamCaptain
);
router.post(
  "/admin/teams/:teamId/members/:memberId/resend-invite",
  teamsStaff,
  invalidateCache("tournaments", "foundation"),
  resendSavedTeamInvite
);
router.delete("/admin/teams/:teamId", teamsStaff, invalidateCache("tournaments", "foundation"), removeSavedTeam);

module.exports = router;
