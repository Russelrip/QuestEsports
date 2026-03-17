const express = require("express");
const { imageUpload, tournamentBannerUpload } = require("../../middleware/upload");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
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

router.use(attachSession);

router.get("/tournaments", getPublicTournaments);
router.get("/tournaments/:slug", getPublicTournament);
router.get("/tournament-registration/status/:slug", getTournamentRegistrationStatus);
router.post(
  "/tournament-registration",
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
