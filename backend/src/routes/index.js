const express = require("express");
const adminRoutes = require("../modules/admin/admin.routes");
const authRoutes = require("../modules/auth/auth.routes");
const contactRoutes = require("../modules/contact/contact.routes");
const mediaRoutes = require("../modules/media/media.routes");
const recruitmentRoutes = require("../modules/recruitment/recruitment.routes");
const rulebookRoutes = require("../modules/rulebooks/rulebook.routes");
const teamRoutes = require("../modules/teams/team.routes");
const tournamentRoutes = require("../modules/tournaments/tournament.routes");
const uploadRoutes = require("../modules/uploads/upload.routes");

const router = express.Router();

router.use(authRoutes);
router.use(adminRoutes);
router.use(contactRoutes);
router.use(mediaRoutes);
router.use(recruitmentRoutes);
router.use(rulebookRoutes);
router.use(teamRoutes);
router.use(tournamentRoutes);
router.use(uploadRoutes);

module.exports = router;
