const express = require("express");
const { env } = require("../config/env");
const { asyncHandler } = require("../lib/async-handler");
const { attachSession, requireAuth, requireAdmin } = require("../modules/auth/auth.middleware");
const valorantController = require("../modules/valorant/valorant.controller");
const valorantLeaderboardController = require("../modules/valorant-leaderboard/controller");
const { cachePublicData } = require("../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../middleware/response-cache");
const { getPublicTournamentBySlug } = require("../modules/tournaments/tournament.service");
const matchController = require("../modules/matches/match.controller");
const challongeController = require("../modules/challonge/challonge.controller");
const staffController = require("../modules/permissions/staff.controller");
const { getRealtimeEvents } = require("../modules/realtime/realtime.controller");
const {
  requireSuperAdmin,
  requireTournamentStaff,
  requireMatchStaff,
} = require("../modules/permissions/permission.middleware");

const router = express.Router();
const publicCache = cachePublicData();
const shortCache = cacheJson({ ttlSeconds: Math.min(env.CACHE_TTL_SECONDS, 15), tags: ["foundation"] });
const bracketPublicCache = cachePublicData({ browserSeconds: 0, sharedSeconds: env.CHALLONGE_BRACKET_CACHE_SECONDS });
const bracketResponseCache = cacheJson({
  ttlSeconds: env.CHALLONGE_BRACKET_CACHE_SECONDS,
  tags: ["foundation"],
  allowCookies: true,
});
const leaderboardPublicCache = cachePublicData({ browserSeconds: 0, sharedSeconds: 60 });
const leaderboardCache = cacheJson({ ttlSeconds: 60, tags: ["foundation"] });
const tournamentAdmin = requireTournamentStaff({ roles: ["tournament_admin"], parameter: "id" });
const tournamentStaff = requireTournamentStaff({ roles: ["tournament_admin", "referee"], parameter: "id" });

router.use(attachSession);

router.get("/home", publicCache, shortCache, matchController.homeFeed);
router.get(
  "/tournaments/:slug",
  publicCache,
  shortCache,
  asyncHandler(async (req, res) => {
    const tournament = await getPublicTournamentBySlug(req.params.slug);
    const data = { ...tournament };
    delete data.bracketData;
    res.status(200).json({
      success: true,
      data: {
        ...data,
        bracketSource: tournament.bracketSource || (tournament.bracketData ? "native" : "none"),
      },
      meta: { serverNow: new Date().toISOString() },
    });
  })
);
router.get("/tournaments/:slug/bracket", bracketPublicCache, bracketResponseCache, challongeController.publicBracket);
router.get("/tournaments/:slug/matches", publicCache, shortCache, matchController.listTournamentMatches);
router.get("/matches", publicCache, shortCache, matchController.listMatches);
router.get("/matches/next", matchController.nextMatch);
router.get("/events", getRealtimeEvents);

router.get("/valorant/leaderboard", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.getLeaderboard);
router.get("/valorant/leaderboard/search", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.searchLeaderboard);

// Quest-hosted leaderboard registration/auth proxy (HMAC service-token
// upstream). No cache middleware — these are stateful/live calls.
router.get("/valorant/leaderboard/register/discord/login", valorantLeaderboardController.getDiscordLogin);
router.get("/valorant/leaderboard/register/discord/callback", valorantLeaderboardController.getDiscordCallback);
router.post("/valorant/leaderboard/register/check-puuid", valorantLeaderboardController.checkPuuid);
router.post("/valorant/leaderboard/register/preview", valorantLeaderboardController.previewRegistration);
router.post("/valorant/leaderboard/register/submit", valorantLeaderboardController.submitRegistration);

router.get("/admin/tournaments/:id/challonge", requireAuth, tournamentAdmin, challongeController.getIntegration);
router.patch("/admin/tournaments/:id/challonge", requireAuth, tournamentAdmin, invalidateCache("foundation"), challongeController.saveIntegration);
router.post("/admin/tournaments/:id/challonge/sync", requireAuth, tournamentAdmin, invalidateCache("foundation"), challongeController.syncIntegration);
router.get("/admin/tournaments/:id/challonge/logs", requireAuth, tournamentAdmin, challongeController.getLogs);
router.post(
  "/admin/tournaments/:id/challonge/participants",
  requireAuth,
  tournamentAdmin,
  challongeController.createParticipant
);
router.put(
  "/admin/tournaments/:id/challonge/participants/:participantId",
  requireAuth,
  tournamentAdmin,
  challongeController.updateParticipant
);
router.delete(
  "/admin/tournaments/:id/challonge/participants/:participantId",
  requireAuth,
  tournamentAdmin,
  challongeController.deleteParticipant
);
router.patch(
  "/admin/tournaments/:id/challonge/participant-mappings/:participantId",
  requireAuth,
  tournamentAdmin,
  invalidateCache("foundation"),
  challongeController.mapParticipant
);
router.put(
  "/admin/tournaments/:id/challonge/state",
  requireAuth,
  tournamentAdmin,
  invalidateCache("foundation", "tournaments"),
  challongeController.changeTournamentState
);
router.put(
  "/admin/tournaments/:id/challonge/matches/:matchId",
  requireAuth,
  tournamentAdmin,
  challongeController.updateMatchResult
);

router.get("/admin/tournaments/:id/matches", requireAuth, tournamentStaff, matchController.listAdminTournamentMatches);
router.post("/admin/tournaments/:id/matches", requireAuth, tournamentStaff, invalidateCache("foundation"), matchController.createAdminMatch);
router.patch("/admin/matches/:matchId", requireAuth, requireMatchStaff(), invalidateCache("foundation"), matchController.updateAdminMatch);

router.get("/admin/tournaments/:id/staff", requireAuth, requireSuperAdmin, staffController.listStaff);
router.post("/admin/tournaments/:id/staff", requireAuth, requireSuperAdmin, staffController.assignStaff);
router.delete(
  "/admin/tournaments/:id/staff/:assignmentId",
  requireAuth,
  requireSuperAdmin,
  staffController.removeStaff
);

router.use("/admin/valorant", requireAdmin);
router.get("/admin/valorant/teams", valorantController.listTeams);
router.post("/admin/valorant/teams/bind", valorantController.bindTeam);
router.delete("/admin/valorant/teams/:bindingId/detach", valorantController.detachBinding);
router.post("/admin/valorant/discover", valorantController.discover);
router.post("/admin/valorant/matches/import", valorantController.importMatch);
router.get("/admin/valorant/matches/by-henrik-id/:henrikMatchId", valorantController.getMatchByHenrikId);
router.get("/admin/valorant/matches", valorantController.listMatches);
router.post("/admin/valorant/series", valorantController.createSeries);
router.post("/admin/valorant/series/manual", valorantController.createManualSeries);
router.get("/admin/valorant/series", valorantController.listSeries);
router.get("/admin/valorant/series/:id", valorantController.getSeries);
router.delete("/admin/valorant/series/:id", valorantController.deleteSeries);
router.patch("/admin/valorant/series/:seriesId", valorantController.updateSeriesPlayedAt);
router.get("/admin/valorant/series/:seriesId/matches", valorantController.listSeriesMatches);
router.post("/admin/valorant/series/:id/games", valorantController.attachGame);
router.put("/admin/valorant/series/:id/games/order", valorantController.setGameOrder);
router.delete("/admin/valorant/series/:id/games/:gameId", valorantController.removeGame);
router.get("/admin/valorant/series/:id/preview", valorantController.previewSeries);
router.post("/admin/valorant/series/:id/finalize", valorantController.finalizeSeries);
router.get("/admin/valorant/rankings", valorantController.getRankings);
router.get("/admin/valorant/teams/:teamId/rating-history", valorantController.getRatingHistory);
router.get("/admin/valorant/teams/:teamId/series", valorantController.getTeamSeries);
router.get("/admin/valorant/reconciliation", valorantController.getReconciliation);

module.exports = router;
