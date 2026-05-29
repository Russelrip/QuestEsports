const express = require("express");
const { imageUpload, adminTournamentAssetsUpload } = require("../../middleware/upload");
const {
  attachSession,
  requireAuth,
  requireAdmin,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
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
  getTournamentBracket,
  generateBracket,
  updateBracketMatch,
  publishBracket,
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
  requireVerifiedEmail,
  tournamentRegistrationRateLimiter,
  imageUpload.single("teamLogo"),
  submitTournamentRegistration
);

router.get("/admin/tournaments", requireAdmin, getAdminTournaments);
router.get("/admin/tournaments/:tournamentId", requireAdmin, getAdminTournament);
router.get("/admin/tournaments/:tournamentId/bracket", requireAdmin, getTournamentBracket);
router.post("/admin/tournaments/:tournamentId/bracket/generate", requireAdmin, generateBracket);
router.patch(
  "/admin/tournaments/:tournamentId/bracket/matches/:matchId",
  requireAdmin,
  express.json(),
  updateBracketMatch
);
router.patch(
  "/admin/tournaments/:tournamentId/bracket/publish",
  requireAdmin,
  express.json(),
  publishBracket
);
router.post(
  "/admin/tournaments",
  requireAdmin,
  adminTournamentAssetsUpload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "scheduleFile", maxCount: 1 },
    { name: "completedPosterImage", maxCount: 1 },
    { name: "firstPlaceImage", maxCount: 1 },
    { name: "secondPlaceImage", maxCount: 1 },
    { name: "thirdPlaceImage", maxCount: 1 },
  ]),
  createTournament
);
router.patch(
  "/admin/tournaments/:tournamentId",
  requireAdmin,
  adminTournamentAssetsUpload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "scheduleFile", maxCount: 1 },
    { name: "completedPosterImage", maxCount: 1 },
    { name: "firstPlaceImage", maxCount: 1 },
    { name: "secondPlaceImage", maxCount: 1 },
    { name: "thirdPlaceImage", maxCount: 1 },
  ]),
  updateTournament
);
router.delete("/admin/tournaments/:tournamentId", requireAdmin, deleteTournament);

module.exports = router;
