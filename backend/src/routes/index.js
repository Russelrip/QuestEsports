const express = require("express");
const authRoutes = require("../modules/auth/auth.routes");
const contactRoutes = require("../modules/contact/contact.routes");
const tournamentRoutes = require("../modules/tournaments/tournament.routes");

const router = express.Router();

router.use(authRoutes);
router.use(contactRoutes);
router.use(tournamentRoutes);

module.exports = router;
