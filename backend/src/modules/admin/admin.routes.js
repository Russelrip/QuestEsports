const express = require("express");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
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
  updateRegistrationStatus,
} = require("./admin.controller");

const router = express.Router();

router.use(attachSession);
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
router.get("/admin/tournaments/:tournamentId/registrations", getTournamentRegistrations);
router.patch("/admin/team-registrations/:registrationId/status", updateRegistrationStatus);

module.exports = router;
