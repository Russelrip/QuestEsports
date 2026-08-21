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
const vetoController = require("../modules/veto/veto.controller");
const matchRoomController = require("../modules/match-rooms/match-room.controller");
const notificationController = require("../modules/notifications/notification.controller");
const supportRoutes = require("../modules/support/support.routes");
const authRoutes = require("../modules/auth/auth.routes");
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
router.use(supportRoutes);
router.use(authRoutes.oauthLinkRoutes);

router.get("/home", publicCache, shortCache, matchController.homeFeed);
router.get(
  "/tournaments/:slug",
  publicCache,
  shortCache,
  asyncHandler(async (req, res) => {
    const tournament = await getPublicTournamentBySlug(req.params.slug, req.query);
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
router.get("/match-rooms/mine", requireAuth, matchRoomController.mine);
router.get("/match-rooms/:code", requireAuth, matchRoomController.getRoom);
router.get("/match-rooms/:code/messages", requireAuth, matchRoomController.messages);
router.post("/match-rooms/:code/messages", requireAuth, matchRoomController.sendMessage);
router.patch("/match-rooms/:code/read", requireAuth, matchRoomController.read);
router.get("/match-rooms/:code/support", requireAuth, matchRoomController.support);
router.post("/match-rooms/:code/support", requireAuth, matchRoomController.openSupport);
router.post("/match-rooms/:code/support/:requestId/messages", requireAuth, matchRoomController.replySupport);
router.post("/match-rooms/:code/support/:requestId/resolve", requireAuth, matchRoomController.resolveSupport);
router.post("/match-rooms/:code/messages/:messageId/hide", requireAuth, matchRoomController.hide);
router.patch("/match-rooms/:code/members/:memberId/mute", requireAuth, matchRoomController.mute);
router.patch("/match-rooms/:code/chat-lock", requireAuth, matchRoomController.lock);
router.get("/notifications", requireAuth, notificationController.list);
router.patch("/notifications/read-all", requireAuth, notificationController.readAll);
router.patch("/notifications/:id/read", requireAuth, notificationController.read);
router.post("/notifications/push-subscriptions", requireAuth, notificationController.subscribe);
router.delete("/notifications/push-subscriptions", requireAuth, notificationController.unsubscribe);
router.patch("/notifications/preferences", requireAuth, notificationController.preference);
router.get("/veto-rooms/mine", requireAuth, vetoController.myRooms);
router.get("/veto-rooms/:code", vetoController.getRoom);
router.post("/veto-rooms/:code/ready", vetoController.readyRoom);
router.post("/veto-rooms/:code/toss", vetoController.tossRoom);
router.post("/veto-rooms/:code/team-a", vetoController.chooseTeamA);
router.post("/veto-rooms/:code/actions", vetoController.submitAction);

router.get("/admin/veto/catalog", requireAuth, vetoController.catalog);
router.post("/admin/veto/maps", requireAuth, vetoController.createMap);
router.patch("/admin/veto/maps/:id", requireAuth, vetoController.updateMap);
router.post("/admin/veto/pools", requireAuth, vetoController.createPool);
router.post("/admin/veto/presets", requireAuth, vetoController.createPreset);
router.post("/admin/veto/templates", requireAuth, vetoController.createTemplate);
router.get("/admin/tournaments/:id/veto-config", requireAuth, vetoController.tournamentConfig);
router.put("/admin/tournaments/:id/veto-config", requireAuth, vetoController.saveTournamentConfig);
router.get("/admin/veto-rooms", requireAuth, vetoController.listRooms);
router.post("/admin/veto-rooms", requireAuth, vetoController.createRoom);
router.get("/admin/veto-rooms/:roomId", requireAuth, vetoController.getAdminRoom);
router.post("/admin/veto-rooms/:roomId/open", requireAuth, vetoController.openRoom);
router.post("/admin/veto-rooms/:roomId/start", requireAuth, vetoController.startRoom);
router.post("/admin/veto-rooms/:roomId/assign-team-a", requireAuth, vetoController.assignTeamA);
router.post("/admin/veto-rooms/:roomId/manual-toss", requireAuth, vetoController.recordManualToss);
router.post("/admin/veto-rooms/:roomId/rewind", requireAuth, vetoController.rewindRoom);
router.post("/admin/veto-rooms/:roomId/reset", requireAuth, vetoController.resetRoom);
router.post("/admin/veto-rooms/:roomId/cancel", requireAuth, vetoController.cancelRoom);
router.post("/admin/veto-rooms/:roomId/rotate-link", requireAuth, vetoController.rotateGrant);

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
  invalidateCache("foundation", "tournaments"),
  challongeController.createParticipant
);
router.put(
  "/admin/tournaments/:id/challonge/participants/:participantId",
  requireAuth,
  tournamentAdmin,
  invalidateCache("foundation", "tournaments"),
  challongeController.updateParticipant
);
router.delete(
  "/admin/tournaments/:id/challonge/participants/:participantId",
  requireAuth,
  tournamentAdmin,
  invalidateCache("foundation", "tournaments"),
  challongeController.deleteParticipant
);
router.patch(
  "/admin/tournaments/:id/challonge/participant-mappings/:participantId",
  requireAuth,
  tournamentAdmin,
  invalidateCache("foundation", "tournaments"),
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
  invalidateCache("foundation", "tournaments"),
  challongeController.updateMatchResult
);

router.get("/admin/tournaments/:id/matches", requireAuth, tournamentStaff, matchController.listAdminTournamentMatches);
router.post("/admin/tournaments/:id/matches", requireAuth, tournamentStaff, invalidateCache("foundation"), matchController.createAdminMatch);
router.patch("/admin/matches/:matchId", requireAuth, requireMatchStaff(), invalidateCache("foundation"), matchController.updateAdminMatch);
router.post("/admin/matches/:matchId/room", requireAuth, requireMatchStaff(), matchRoomController.sync);
router.get("/admin/match-rooms", requireAuth, matchRoomController.staffRooms);

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
