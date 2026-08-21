const express = require("express");
const {
  imageUpload,
  adminTournamentAssetsUpload,
  createUploadRequestSizeGuard,
} = require("../../middleware/upload");
const sponsorController = require("./sponsor.controller");
const {
  requireAuth,
  requireAdmin,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { env } = require("../../config/env");
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
  cancelTournamentRegistration,
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
const publicTournamentCache = cachePublicData();

router.get(
  "/tournaments",
  publicTournamentCache,
  cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["tournaments"] }),
  getPublicTournaments
);
router.get(
  "/tournaments/:slug",
  publicTournamentCache,
  cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["tournaments"] }),
  getPublicTournament
);
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
  invalidateCache("tournaments", "foundation"),
  imageUpload.single("teamLogo"),
  submitConfiguredTournamentRegistration
);
router.delete(
  "/tournaments/:slug/registrations",
  requireAuth,
  requireVerifiedEmail,
  tournamentRegistrationRateLimiter,
  invalidateCache("tournaments", "foundation"),
  cancelTournamentRegistration
);

router.get("/admin/tournaments", requireAdmin, getAdminTournaments);
router.get("/admin/tournaments/:tournamentId", requireAdmin, getAdminTournament);
router.get("/admin/tournaments/:tournamentId/sponsors", requireAdmin, sponsorController.listSponsors);
router.post("/admin/tournaments/:tournamentId/sponsors", requireAdmin, invalidateCache("tournaments", "foundation"), imageUpload.single("logo"), sponsorController.createSponsor);
router.patch("/admin/tournaments/:tournamentId/sponsors/:sponsorId", requireAdmin, invalidateCache("tournaments", "foundation"), imageUpload.single("logo"), sponsorController.updateSponsor);
router.delete("/admin/tournaments/:tournamentId/sponsors/:sponsorId", requireAdmin, invalidateCache("tournaments", "foundation"), sponsorController.deleteSponsor);
router.get("/admin/tournaments/:tournamentId/bracket", requireAdmin, getTournamentBracket);
router.post("/admin/tournaments/:tournamentId/bracket/generate", requireAdmin, invalidateCache("tournaments", "foundation"), generateBracket);
router.patch(
  "/admin/tournaments/:tournamentId/bracket/matches/:matchId",
  requireAdmin,
  invalidateCache("tournaments", "foundation"),
  express.json(),
  updateBracketMatch
);
router.patch(
  "/admin/tournaments/:tournamentId/bracket/publish",
  requireAdmin,
  invalidateCache("tournaments", "foundation"),
  express.json(),
  publishBracket
);
router.post(
  "/admin/tournaments",
  requireAdmin,
  invalidateCache("tournaments", "foundation"),
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
  invalidateCache("tournaments", "foundation"),
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
router.delete("/admin/tournaments/:tournamentId", requireAdmin, invalidateCache("tournaments", "foundation"), deleteTournament);

module.exports = router;
