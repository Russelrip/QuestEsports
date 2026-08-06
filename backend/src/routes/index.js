const express = require("express");
const { attachSession } = require("../modules/auth/auth.middleware");
const adminRoutes = require("../modules/admin/admin.routes");
const authRoutes = require("../modules/auth/auth.routes");
const contactRoutes = require("../modules/contact/contact.routes");
const mediaRoutes = require("../modules/media/media.routes");
const recruitmentRoutes = require("../modules/recruitment/recruitment.routes");
const rulebookRoutes = require("../modules/rulebooks/rulebook.routes");
const teamRoutes = require("../modules/teams/team.routes");
const tournamentRoutes = require("../modules/tournaments/tournament.routes");
const uploadRoutes = require("../modules/uploads/upload.routes");
const accountRoutes = require("../modules/account/account.routes");
const seriesRoutes = require("../modules/series/series.routes");
const paymentRoutes = require("../modules/payments/payment.routes");
const shopRoutes = require("../modules/shop/shop.routes");
const gameCategoryRoutes = require("../modules/games/game-category.routes");
const ticketRoutes = require("../modules/tickets/ticket.routes");

const router = express.Router();

router.use(attachSession);
router.use(authRoutes);
router.use(accountRoutes);
router.use(seriesRoutes);
router.use(gameCategoryRoutes);
router.use(paymentRoutes);
router.use(shopRoutes);
router.use(ticketRoutes);
router.use(adminRoutes);
router.use(contactRoutes);
router.use(mediaRoutes);
router.use(recruitmentRoutes);
router.use(rulebookRoutes);
router.use(teamRoutes);
router.use(tournamentRoutes);
router.use(uploadRoutes);

module.exports = router;
