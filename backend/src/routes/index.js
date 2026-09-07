const express = require("express");
const {
  attachSession,
  requireDiscordLinked,
} = require("../modules/auth/auth.middleware");
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
const gameRoutes = require("../modules/games/game.routes");
const playerRoutes = require("../modules/players/player.routes");
const ticketRoutes = require("../modules/tickets/ticket.routes");
const expenseRoutes = require("../modules/expenses/expense.routes");

const router = express.Router();

router.use(attachSession);
// Mounted ahead of the gate so a user without a linked Discord can still sign
// in, read their session, complete the OAuth link, and sign out. Gating these
// would make the requirement unsatisfiable: the only way to connect Discord
// runs through the routes that would be blocked.
router.use(authRoutes);
router.use(accountRoutes);
router.use(requireDiscordLinked);
router.use(seriesRoutes);
router.use(gameCategoryRoutes);
router.use(gameRoutes);
router.use(playerRoutes);
router.use(paymentRoutes);
router.use(shopRoutes);
router.use(ticketRoutes);
router.use(expenseRoutes);
router.use(adminRoutes);
router.use(contactRoutes);
router.use(mediaRoutes);
router.use(recruitmentRoutes);
router.use(rulebookRoutes);
router.use(teamRoutes);
router.use(tournamentRoutes);
router.use(uploadRoutes);

module.exports = router;
