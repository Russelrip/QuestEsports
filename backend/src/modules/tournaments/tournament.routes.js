const express = require("express");
const {
  imageUpload,
  adminTournamentAssetsUpload,
  createUploadRequestSizeGuard,
} = require("../../middleware/upload");
const sponsorController = require("./sponsor.controller");
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
  submitConfiguredTournamentRegistration,
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
const tournamentAssetsSizeGuard = createUploadRequestSizeGuard(45 * 1024 * 1024);

router.use(attachSession);

router.get("/tournaments", getPublicTournaments);
router.get("/tournaments/:slug", getPublicTournament);
router.get(
  "/tournaments/:slug/registration-status",
  requireAuth,
  getTournamentRegistrationStatus
);
router.post(
  "/tournaments/:slug/registrations",
  requireAuth,
  requireVerifiedEmail,
  tournamentRegistrationRateLimiter,
  imageUpload.single("teamLogo"),
  submitConfiguredTournamentRegistration
);

router.get("/admin/tournaments", requireAdmin, getAdminTournaments);
router.get("/admin/tournaments/:tournamentId", requireAdmin, getAdminTournament);
router.get("/admin/tournaments/:tournamentId/sponsors", requireAdmin, sponsorController.listSponsors);
router.post("/admin/tournaments/:tournamentId/sponsors", requireAdmin, imageUpload.single("logo"), sponsorController.createSponsor);
router.patch("/admin/tournaments/:tournamentId/sponsors/:sponsorId", requireAdmin, imageUpload.single("logo"), sponsorController.updateSponsor);
router.delete("/admin/tournaments/:tournamentId/sponsors/:sponsorId", requireAdmin, sponsorController.deleteSponsor);
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
  tournamentAssetsSizeGuard,
  adminTournamentAssetsUpload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "heroImage", maxCount: 1 },
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
  tournamentAssetsSizeGuard,
  adminTournamentAssetsUpload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "heroImage", maxCount: 1 },
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
