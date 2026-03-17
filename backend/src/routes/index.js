const express = require("express");
const adminRoutes = require("../modules/admin/admin.routes");
const authRoutes = require("../modules/auth/auth.routes");
const contactRoutes = require("../modules/contact/contact.routes");
const mediaRoutes = require("../modules/media/media.routes");
const tournamentRoutes = require("../modules/tournaments/tournament.routes");

const router = express.Router();

router.use(authRoutes);
router.use(adminRoutes);
router.use(contactRoutes);
router.use(mediaRoutes);
router.use(tournamentRoutes);

module.exports = router;
