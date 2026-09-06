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
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const gameAccountControllerPath = path.join(__dirname, "../src/modules/game-accounts/game-account.controller.js");

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
      requireVetoRoomCode: passMiddleware,
      requireVetoRoomCredential: passMiddleware,
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
      requireVetoRoomCode: passMiddleware,
      requireVetoRoomCredential: passMiddleware,
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


// VALORANT leaderboard registration is a Quest-account flow. The three
// stateful routes require a Quest session before they can reach the upstream.
test("v1 authenticates and rate limits every VALORANT leaderboard registration route", () => {
  const limiters = new Map();
  const configs = [];
  const requireAuth = function requireAuthMarker(_req, _res, next) { next(); };
  const { module: router, restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: { attachSession: passMiddleware, requireAuth, requireAdmin: requireAdminMock },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => passMiddleware },
    [responseCachePath]: { cacheJson: () => passMiddleware, invalidateCache: () => passMiddleware },
    [rateLimitPath]: {
      createRateLimiter: (config) => {
        configs.push(config);
        const limiter = function rateLimiter(_req, _res, next) { next(); };
        limiters.set(config.name, limiter);
        return limiter;
      },
      getClientIp: () => "127.0.0.1",
    },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: controllerHandler },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => passMiddleware,
      requirePermission: requirePermissionMock,
      requireVetoRoomCode: passMiddleware,
      requireVetoRoomCredential: passMiddleware,
      PERMISSION_SCOPES: permissionScopesMock,
    },
    [valorantControllerPath]: controllerMock,
    [valorantLeaderboardControllerPath]: controllerMock,
  });

  try {
    const lookupLimiter = limiters.get("valorant-leaderboard-register-lookup");
    const submitLimiter = limiters.get("valorant-leaderboard-register-submit");
    assert.ok(lookupLimiter, "a lookup limiter must be created");
    assert.ok(submitLimiter, "a submit limiter must be created");

    const routeFor = (path) =>
      router.stack.find((layer) => layer.route && layer.route.path === path);

    assert.equal(routeFor("/valorant/leaderboard/register/discord/login"), undefined);
    assert.equal(routeFor("/valorant/leaderboard/register/discord/callback"), undefined);

    const guarded = [
      ["/valorant/leaderboard/register/check-puuid", lookupLimiter],
      ["/valorant/leaderboard/register/preview", lookupLimiter],
      ["/valorant/leaderboard/register/submit", submitLimiter],
    ];

    for (const [routePath, limiter] of guarded) {
      const layer = routeFor(routePath);
      assert.ok(layer, `missing route ${routePath}`);
      assert.equal(
        layer.route.stack.some((entry) => entry.handle === limiter),
        true,
        `${routePath} must be rate limited`,
      );
      // The limiter has to run before the controller, or the upstream call
      // happens regardless of the limit.
      assert.equal(
        layer.route.stack.some((entry) => entry.handle === requireAuth),
        true,
        `${routePath} must require authentication`,
      );
      assert.equal(
        layer.route.stack.findIndex((entry) => entry.handle === limiter) >
          layer.route.stack.findIndex((entry) => entry.handle === requireAuth),
        true,
        `${routePath} must authenticate before applying the upstream limiter`,
      );
    }

    // Submitting writes upstream, so it must be the stricter of the two.
    const lookupConfig = configs.find((config) => config.name === "valorant-leaderboard-register-lookup");
    const submitConfig = configs.find((config) => config.name === "valorant-leaderboard-register-submit");
    assert.ok(submitConfig.maxRequests < lookupConfig.maxRequests);
    for (const config of [lookupConfig, submitConfig]) {
      assert.ok(config.windowMs > 0 && config.maxRequests > 0);
      assert.equal(typeof config.message, "string");
      assert.ok(config.message.length > 0);
    }
  } finally {
    restore();
  }
});


// Section 3 (2026-08-23 identity plan): Riot resolution reaches the shared
// upstream Henrik budget, so it must sit behind a session AND a limiter. The
// route is a lookup — it stores nothing — but an unbounded authenticated caller
// could still exhaust the provider or probe which PUUIDs are claimed.
test("v1 puts Riot ID resolution behind a session and a limiter", () => {
  const limiters = new Map();
  const requireAuthMock = (_req, _res, next) => next();
  const { module: router, restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: { attachSession: passMiddleware, requireAuth: requireAuthMock, requireAdmin: requireAdminMock },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => passMiddleware },
    [responseCachePath]: { cacheJson: () => passMiddleware, invalidateCache: () => passMiddleware },
    [rateLimitPath]: {
      createRateLimiter: (config) => {
        const limiter = function rateLimiter(_req, _res, next) { next(); };
        limiters.set(config.name, limiter);
        return limiter;
      },
      getClientIp: () => "127.0.0.1",
    },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: controllerHandler },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => passMiddleware,
      requirePermission: requirePermissionMock,
      requireVetoRoomCode: passMiddleware,
      requireVetoRoomCredential: passMiddleware,
      PERMISSION_SCOPES: permissionScopesMock,
    },
    [valorantControllerPath]: controllerMock,
    [valorantLeaderboardControllerPath]: controllerMock,
    [gameAccountControllerPath]: controllerMock,
  });

  try {
    const layer = router.stack.find(
      (entry) => entry.route && entry.route.path === "/game-accounts/valorant/resolve",
    );
    assert.ok(layer, "the resolve route must be declared");
    assert.ok(layer.route.methods.post, "resolve must be a POST");

    const handles = layer.route.stack.map((entry) => entry.handle);
    assert.ok(handles.includes(requireAuthMock), "resolve must require a session");
    const limiter = limiters.get("game-account-resolve");
    assert.ok(limiter, "resolve must have its own limiter");
    assert.ok(handles.includes(limiter), "resolve must be rate limited");
    // Both guards must precede the handler, or the upstream call happens anyway.
    assert.ok(handles.indexOf(requireAuthMock) < handles.length - 1);
    assert.ok(handles.indexOf(limiter) < handles.length - 1);
  } finally {
    restore();
  }
});
