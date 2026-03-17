const express = require("express");
const { imageUpload, tournamentBannerUpload } = require("../../middleware/upload");
const { attachSession, requireAuth, requireAdmin } = require("../auth/auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
  getPublicTournaments,
  getPublicTournament,
  getAdminTournaments,
  getAdminTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  getTournamentRegistrationStatus,
  submitTournamentRegistration,
} = require("./tournament.controller");

const router = express.Router();
const tournamentRegistrationRateLimiter = createRateLimiter({
  name: "tournament-registration-submit",
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: "Too many tournament registrations. Please try again later.",
});

router.use(attachSession);

router.get("/tournaments", getPublicTournaments);
router.get("/tournaments/:slug", getPublicTournament);
router.get(
  "/tournament-registration/status/:slug",
  requireAuth,
  getTournamentRegistrationStatus
);
router.post(
  "/tournament-registration",
  requireAuth,
  tournamentRegistrationRateLimiter,
  imageUpload.single("teamLogo"),
  submitTournamentRegistration
);

router.get("/admin/tournaments", requireAdmin, getAdminTournaments);
router.get("/admin/tournaments/:tournamentId", requireAdmin, getAdminTournament);
router.post(
  "/admin/tournaments",
  requireAdmin,
  tournamentBannerUpload.single("bannerImage"),
  createTournament
);
router.patch(
  "/admin/tournaments/:tournamentId",
  requireAdmin,
  tournamentBannerUpload.single("bannerImage"),
  updateTournament
);
router.delete("/admin/tournaments/:tournamentId", requireAdmin, deleteTournament);

module.exports = router;
