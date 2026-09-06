const express = require("express");
const { env } = require("../config/env");
const { asyncHandler } = require("../lib/async-handler");
const { attachSession, requireAuth, requireAdmin } = require("../modules/auth/auth.middleware");
const valorantController = require("../modules/valorant/valorant.controller");
const valorantPublicController = require("../modules/valorant/valorant-public.controller");
const valorantAnchorsController = require("../modules/valorant/valorant-anchors.controller");
const valorantLeaderboardController = require("../modules/valorant-leaderboard/controller");
const gameAccountController = require("../modules/game-accounts/game-account.controller");
const { cachePublicData } = require("../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../middleware/response-cache");
const { createRateLimiter } = require("../middleware/rate-limit");
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
  requirePermission,
  requireVetoRoomCode,
  requireVetoRoomCredential,
  PERMISSION_SCOPES,
} = require("../modules/permissions/permission.middleware");

const scopes = PERMISSION_SCOPES;

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
// The leaderboard registration proxy reaches the Henrik-backed upstream
// (`valorant-platform-backend`). Registration is a Quest-account flow: the
// session and linked Discord account are authoritative, while per-IP limits
// bound the shared upstream budget.
const leaderboardRegisterLookupLimiter = createRateLimiter({
  name: "valorant-leaderboard-register-lookup",
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  message: "Too many VALORANT lookups. Please try again in a few minutes.",
});
const leaderboardRegisterSubmitLimiter = createRateLimiter({
  name: "valorant-leaderboard-register-submit",
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: "Too many registration attempts. Please try again later.",
});
// Riot ID resolution is debounced in the UI and cached for five minutes, but it
// still reaches the shared upstream Henrik budget, so a signed-in caller gets a
// bounded number of distinct lookups.
const gameAccountResolveLimiter = createRateLimiter({
  name: "game-account-resolve",
  windowMs: 15 * 60 * 1000,
  maxRequests: 40,
  message: "Too many account lookups. Please try again in a few minutes.",
});
const tournamentResource = {
  parameter: "id",
  matchParameter: null,
  matchBodyField: null,
  matchQueryField: null,
  roomParameter: null,
  roomBodyField: null,
  roomQueryField: null,
};
const tournamentAdmin = requirePermission(scopes.TOURNAMENT_ADMINISTRATION, tournamentResource);
const tournamentRead = requirePermission(scopes.TOURNAMENT_READ, tournamentResource);
const tournamentStaff = requirePermission(scopes.MATCH_OPERATIONS, tournamentResource);
const staffRosterManagement = requirePermission(scopes.STAFF_ROSTER_MANAGEMENT, tournamentResource);
const unscopedTournamentRead = requirePermission(scopes.TOURNAMENT_READ, { queryField: "tournamentId", allowUnscoped: true });
const roomTournamentRead = requirePermission(scopes.TOURNAMENT_READ);
const unscopedMatchRoomRead = requirePermission(scopes.TOURNAMENT_READ, { allowUnscoped: true, allowDirectMatchAssignment: true });

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
// Public VALORANT results. A "match" here is the SERIES, as it is on VLR — the
// scoreboard belongs to a bo1/bo3, not to a Quest bracket row, and the bracket
// link on match_maps is still unpopulated.
router.get("/tournaments/:slug/results", publicCache, shortCache, valorantPublicController.getTournamentResults);
router.get("/valorant/series/:seriesId", publicCache, shortCache, valorantPublicController.getPublicSeries);
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
// Code routes stay service-authorized: resolveAccess remains the authority and
// preserves captain, public, account, and x-veto-token flows without granting
// admin scope. The route guards are defence in depth only — they reject
// impossible codes and credential-free mutations with the status codes the
// service already returns, before the room is loaded.
router.get("/veto-rooms/:code", requireVetoRoomCode, vetoController.getRoom);
router.post("/veto-rooms/:code/ready", requireVetoRoomCode, requireVetoRoomCredential, vetoController.readyRoom);
router.post("/veto-rooms/:code/toss", requireVetoRoomCode, requireVetoRoomCredential, vetoController.tossRoom);
router.post("/veto-rooms/:code/team-a", requireVetoRoomCode, requireVetoRoomCredential, vetoController.chooseTeamA);
router.post("/veto-rooms/:code/actions", requireVetoRoomCode, requireVetoRoomCredential, vetoController.submitAction);

router.get("/admin/veto/catalog", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG, { queryField: "tournamentId", allowUnscoped: true }), vetoController.catalog);
router.post("/admin/veto/maps", requireAuth, requireAdmin, vetoController.createMap);
router.patch("/admin/veto/maps/:id", requireAuth, requireAdmin, vetoController.updateMap);
router.post("/admin/veto/pools", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG), vetoController.createPool);
router.post("/admin/veto/presets", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG), vetoController.createPreset);
router.post("/admin/veto/templates", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG), vetoController.createTemplate);
router.get("/admin/tournaments/:id/veto-config", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG, { parameter: "id" }), vetoController.tournamentConfig);
router.put("/admin/tournaments/:id/veto-config", requireAuth, requirePermission(scopes.VETO_CATALOG_CONFIG, { parameter: "id" }), vetoController.saveTournamentConfig);
router.get("/admin/veto-rooms", requireAuth, unscopedTournamentRead, vetoController.listRooms);
router.post("/admin/veto-rooms", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.createRoom);
router.get("/admin/veto-rooms/:roomId", requireAuth, roomTournamentRead, vetoController.getAdminRoom);
router.post("/admin/veto-rooms/:roomId/open", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.openRoom);
router.post("/admin/veto-rooms/:roomId/start", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.startRoom);
router.post("/admin/veto-rooms/:roomId/assign-team-a", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.assignTeamA);
router.post("/admin/veto-rooms/:roomId/manual-toss", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.recordManualToss);
router.post("/admin/veto-rooms/:roomId/rewind", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.rewindRoom);
router.post("/admin/veto-rooms/:roomId/reset", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.resetRoom);
router.post("/admin/veto-rooms/:roomId/cancel", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.cancelRoom);
router.post("/admin/veto-rooms/:roomId/rotate-link", requireAuth, requirePermission(scopes.VETO_OPERATIONS), vetoController.rotateGrant);

router.get("/valorant/leaderboard", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.getLeaderboard);
router.get("/valorant/leaderboard/search", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.searchLeaderboard);

// Quest-hosted leaderboard registration proxy (HMAC service-token upstream).
// No cache middleware — these are stateful/live calls and all require the
// authenticated Quest user's linked Discord identity.
router.post("/valorant/leaderboard/register/check-puuid", requireAuth, leaderboardRegisterLookupLimiter, valorantLeaderboardController.checkPuuid);
router.post("/valorant/leaderboard/register/preview", requireAuth, leaderboardRegisterLookupLimiter, valorantLeaderboardController.previewRegistration);
router.post("/valorant/leaderboard/register/submit", requireAuth, leaderboardRegisterSubmitLimiter, valorantLeaderboardController.submitRegistration);

// Quest player identity. Resolution proves a Riot account EXISTS; it never
// proves the signed-in user owns it, so it is a lookup behind the session and
// is stored by nothing here.
router.post("/game-accounts/valorant/resolve", requireAuth, gameAccountResolveLimiter, gameAccountController.resolveValorant);
router.post("/game-accounts/valorant/link", requireAuth, gameAccountResolveLimiter, gameAccountController.linkValorant);
router.get("/users/me/game-accounts", requireAuth, gameAccountController.listMyGameAccounts);
router.get("/teams/:teamId/registration-readiness", requireAuth, gameAccountController.getTeamRegistrationReadiness);
router.post("/game-accounts/valorant/change-request", requireAuth, gameAccountResolveLimiter, gameAccountController.requestValorantChange);

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

router.get("/admin/tournaments/:id/matches", requireAuth, tournamentRead, matchController.listAdminTournamentMatches);
router.post("/admin/tournaments/:id/matches", requireAuth, tournamentStaff, invalidateCache("foundation"), matchController.createAdminMatch);
router.patch("/admin/matches/:matchId", requireAuth, requirePermission(scopes.MATCH_OPERATIONS), invalidateCache("foundation"), matchController.updateAdminMatch);
router.post("/admin/matches/:matchId/room", requireAuth, requirePermission(scopes.MATCH_OPERATIONS), matchRoomController.sync);
router.get("/admin/match-rooms", requireAuth, unscopedMatchRoomRead, matchRoomController.staffRooms);

router.get("/admin/tournaments/:id/staff", requireAuth, requireSuperAdmin, staffRosterManagement, staffController.listStaff);
router.post("/admin/tournaments/:id/staff", requireAuth, requireSuperAdmin, staffRosterManagement, staffController.assignStaff);
router.delete(
  "/admin/tournaments/:id/staff/:assignmentId",
  requireAuth,
  requireSuperAdmin,
  staffRosterManagement,
  staffController.removeStaff
);

// Identity administration sits behind the same admin guard as the rest of the
// VALORANT operations surface.
router.get("/admin/game-accounts/change-requests", requireAuth, requireAdmin, gameAccountController.listAdminChangeRequests);
router.post("/admin/game-accounts/change-requests/:requestId/review", requireAuth, requireAdmin, gameAccountController.reviewAdminChangeRequest);

router.use("/admin/valorant", requireAdmin);
router.get("/admin/valorant/teams", valorantController.listTeams);
// These admin writes change what /api/v1/tournaments/:slug/results and the
// public match page render, so they drop the cached public payload rather than
// leaving a stale result up for the cache TTL.
router.post("/admin/valorant/teams/bind", valorantController.bindTeam);
router.delete("/admin/valorant/teams/:bindingId/detach", valorantController.detachBinding);
router.post("/admin/valorant/discover", valorantController.discover);
// Roster-derived discovery: the anchors come from what each team registered
// with, so an admin confirms a fixture instead of typing two Riot IDs from
// memory. These propose only -- nothing is imported, attached or finalized.
router.get("/admin/valorant/tournaments/:tournamentId/anchors", valorantAnchorsController.getTournamentAnchors);
router.get("/admin/valorant/tournaments/:tournamentId/fixtures", valorantAnchorsController.getTournamentFixtures);
router.post("/admin/valorant/tournaments/:tournamentId/fixtures/:matchId/discover", valorantAnchorsController.discoverFixture);
router.post("/admin/valorant/matches/import", invalidateCache("foundation"), valorantController.importMatch);
router.get("/admin/valorant/matches/by-henrik-id/:henrikMatchId", valorantController.getMatchByHenrikId);
router.get("/admin/valorant/matches", valorantController.listMatches);
router.post("/admin/valorant/series", valorantController.createSeries);
router.post("/admin/valorant/series/manual", valorantController.createManualSeries);
router.get("/admin/valorant/series", valorantController.listSeries);
router.get("/admin/valorant/series/:id", valorantController.getSeries);
router.delete("/admin/valorant/series/:id", invalidateCache("foundation"), valorantController.deleteSeries);
router.patch("/admin/valorant/series/:seriesId", invalidateCache("foundation"), valorantController.updateSeriesPlayedAt);
router.get("/admin/valorant/series/:seriesId/matches", valorantController.listSeriesMatches);
router.post("/admin/valorant/series/:id/games", invalidateCache("foundation"), valorantController.attachGame);
router.put("/admin/valorant/series/:id/games/order", valorantController.setGameOrder);
router.delete("/admin/valorant/series/:id/games/:gameId", invalidateCache("foundation"), valorantController.removeGame);
router.get("/admin/valorant/series/:id/preview", valorantController.previewSeries);
router.post("/admin/valorant/series/:id/finalize", invalidateCache("foundation"), valorantController.finalizeSeries);
router.get("/admin/valorant/rankings", valorantController.getRankings);
router.get("/admin/valorant/teams/:teamId/rating-history", valorantController.getRatingHistory);
router.get("/admin/valorant/teams/:teamId/series", valorantController.getTeamSeries);
router.get("/admin/valorant/reconciliation", valorantController.getReconciliation);

module.exports = router;
