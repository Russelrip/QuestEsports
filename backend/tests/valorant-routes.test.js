const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const v1Path = path.join(__dirname, "../src/routes/v1.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const tournamentServicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const matchControllerPath = path.join(__dirname, "../src/modules/matches/match.controller.js");
const challongeControllerPath = path.join(__dirname, "../src/modules/challonge/challonge.controller.js");
const staffControllerPath = path.join(__dirname, "../src/modules/permissions/staff.controller.js");
const realtimeControllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const permissionMiddlewarePath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");
const valorantControllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");
const valorantLeaderboardControllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");

const controllerHandler = (_req, _res, next) => next?.();
const controllerMock = new Proxy({}, { get: () => controllerHandler });
const passMiddleware = (_req, _res, next) => next();
// Deviation (documented): Express 5 Layer.path is undefined until a request
// is matched, so the plan's `layer.path === "/admin/valorant"` assertion can
// never pass on a freshly-built router. Asserting on the mounted guard handler
// preserves the intent ("a router.use('/admin/valorant', requireAdmin) guard
// must exist") on Express 5.2.
const requireAdminMock = (_req, _res, next) => next();
const permissionScopesMock = {
  TOURNAMENT_READ: "tournament.read",
  TOURNAMENT_ADMINISTRATION: "tournament.administration",
  STAFF_ROSTER_MANAGEMENT: "staff.roster.management",
  MATCH_OPERATIONS: "match.operations",
  VETO_OPERATIONS: "veto.operations",
  VETO_CATALOG_CONFIG: "veto.catalog.config",
};
const requirePermissionMock = () => passMiddleware;

test("v1 router guards /admin/valorant with requireAdmin and declares every proxy route", () => {
  const { module: router, restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: { attachSession: passMiddleware, requireAuth: passMiddleware, requireAdmin: requireAdminMock },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => passMiddleware },
    [responseCachePath]: { cacheJson: () => passMiddleware, invalidateCache: () => passMiddleware },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: controllerHandler },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => passMiddleware,
      requirePermission: requirePermissionMock,
      PERMISSION_SCOPES: permissionScopesMock,
    },
    [valorantControllerPath]: controllerMock,
    [valorantLeaderboardControllerPath]: controllerMock,
  });

  try {
    const useLayers = router.stack.filter((layer) => layer.route === undefined);
    const guard = useLayers.find((layer) => layer.handle === requireAdminMock);
    // Stronger guard assertion (fix round 1): Express 5 Layer matchers are
    // compiled in the constructor, so `guard.match(path)` verifies the guard is
    // actually mounted at the /admin/valorant prefix — a handle-identity check
    // alone would pass a guard mounted at the wrong path.
    assert.ok(
      guard && guard.match("/admin/valorant/teams"),
      "a router.use('/admin/valorant', requireAdmin) guard must exist",
    );
    // Ordering guarantee: the guard must sit BEFORE the first /admin/valorant
    // route layer, otherwise the routes would be reachable unguarded.
    const firstValorantRouteLayer = router.stack.find(
      (layer) => layer.route && layer.route.path.startsWith("/admin/valorant"),
    );
    assert.ok(
      firstValorantRouteLayer &&
        router.stack.indexOf(guard) < router.stack.indexOf(firstValorantRouteLayer),
      "the /admin/valorant guard must be mounted before the first /admin/valorant route",
    );

    const routes = new Set(
      router.stack
        .filter((layer) => layer.route)
        .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`),
    );
    for (const expected of [
      "GET /admin/valorant/teams",
      "POST /admin/valorant/teams/bind",
      "DELETE /admin/valorant/teams/:bindingId/detach",
      "POST /admin/valorant/discover",
      "POST /admin/valorant/matches/import",
      "GET /admin/valorant/matches/by-henrik-id/:henrikMatchId",
      "GET /admin/valorant/matches",
      "POST /admin/valorant/series",
      "POST /admin/valorant/series/manual",
      "GET /admin/valorant/series",
      "GET /admin/valorant/series/:id",
      "DELETE /admin/valorant/series/:id",
      "GET /admin/valorant/series/:seriesId/matches",
      "POST /admin/valorant/series/:id/games",
      "PUT /admin/valorant/series/:id/games/order",
      "DELETE /admin/valorant/series/:id/games/:gameId",
      "GET /admin/valorant/series/:id/preview",
      "POST /admin/valorant/series/:id/finalize",
      "GET /admin/valorant/rankings",
      "GET /admin/valorant/teams/:teamId/rating-history",
      "GET /admin/valorant/teams/:teamId/series",
      "GET /admin/valorant/reconciliation",
      "GET /valorant/leaderboard",
      "GET /valorant/leaderboard/search",
    ]) {
      assert.ok(routes.has(expected), `missing route ${expected}`);
    }
  } finally {
    restore();
  }
});

test("v1 tournament detail mutations invalidate both foundation and tournament caches", () => {
  const invalidations = [];
  const { restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: { attachSession: passMiddleware, requireAuth: passMiddleware, requireAdmin: requireAdminMock },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => passMiddleware },
    [responseCachePath]: {
      cacheJson: () => passMiddleware,
      invalidateCache: (...tags) => {
        invalidations.push(tags);
        return passMiddleware;
      },
    },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: controllerHandler },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => passMiddleware,
      requirePermission: requirePermissionMock,
      PERMISSION_SCOPES: permissionScopesMock,
    },
    [valorantControllerPath]: controllerMock,
    [valorantLeaderboardControllerPath]: controllerMock,
  });
  try {
    assert.deepEqual(invalidations.slice(0, 8), [
      ["foundation"],
      ["foundation"],
      ["foundation", "tournaments"],
      ["foundation", "tournaments"],
      ["foundation", "tournaments"],
      ["foundation", "tournaments"],
      ["foundation", "tournaments"],
      ["foundation", "tournaments"],
    ]);
  } finally {
    restore();
  }
});
