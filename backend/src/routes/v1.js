const express = require("express");
const { env } = require("../config/env");
const { asyncHandler } = require("../lib/async-handler");
const { attachSession, requireAuth } = require("../modules/auth/auth.middleware");
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

module.exports = router;
