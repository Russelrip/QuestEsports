const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// The /api router used to guard every /admin route with one blanket
// `router.use("/admin", requireAdmin)`. Staff roles replaced it with a guard on
// each route, so a route added without one would now be open. This walks the
// real mounted routers and fails on any admin route that names no guard, and
// pins which staff areas open the routes that are delegable.
//
// BOTH routers are walked. `app.js` mounts `routes/index.js` at /api and
// `routes/v1.js` at /api/v1, and for a long time only the first was walked —
// so the whole v1 admin surface (game accounts, the VALORANT leaderboard, veto,
// audit logs, staff roles) sat outside a test whose name claimed to cover every
// admin route under /api. v1 routes are keyed with a `/v1` prefix here, exactly
// as they are mounted.
//
// Two kinds of guard count, because v1 uses both:
//   - per-route, named in the route's own handler chain;
//   - prefix, from `router.use("/admin/valorant", requireAdmin)`.
// A prefix guard only covers routes declared AFTER it in the stack, which is
// load-bearing rather than pedantic: the leaderboard routes are deliberately
// declared BEFORE that blanket so a `valorant_leaderboard` role holder reaches
// them and nothing else under /admin/valorant. Ignoring stack order would read
// those routes as admin-only and quietly bless a regression that locked staff
// out of their own area.

// The walk runs in a child process. Loading the whole /api router pulls in every
// controller, and this test only inspects wiring, so in-process it would add
// thirty-odd files it never exercises to the coverage report. The child is
// spawned without the parent's coverage directory, like write-freeze.test.js.
const WALK_SCRIPT = `
const path = require("node:path");
const { loadModuleWithMocks } = require(${JSON.stringify(path.join(__dirname, "helpers/load-module-with-mocks"))});
const backend = ${JSON.stringify(path.join(__dirname, ".."))};
const authMiddlewarePath = path.join(backend, "src/modules/auth/auth.middleware.js");
const permissionMiddlewarePath = path.join(backend, "src/modules/permissions/permission.middleware.js");

// Read the real scope catalog before the mock replaces the module: v1 builds its
// tournament guards from it at load time, so inventing values here would fail
// loudly for the wrong reason.
const { PERMISSION_SCOPES } = require(permissionMiddlewarePath);

const pass = (_req, _res, next) => next();
const requireAdmin = function requireAdmin(_req, _res, next) { next(); };
const requireSuperAdmin = function requireSuperAdmin(_req, _res, next) { next(); };
const tagged = (properties) => Object.assign((_req, _res, next) => next(), properties);
const passThroughModule = (named) => new Proxy(named, { get: (target, key) => (key in target ? target[key] : pass) });

// v1 calls these as factories while it loads, so a bare pass-through would call
// a middleware with a scope and crash before a single route is registered.
const permissionMock = passThroughModule({
  PERMISSION_SCOPES,
  requireAdmin,
  requireSuperAdmin,
  requireStaffPermission: (...areas) => tagged({ staffAreas: areas }),
  requirePermission: (scope) => tagged({ permissionScope: scope }),
  requireTournamentStaff: () => tagged({ tournamentStaff: true }),
  requireMatchStaff: () => tagged({ tournamentStaff: true }),
});
const authMock = passThroughModule({ requireAdmin });

const describeGuard = (handle) => {
  if (handle === requireAdmin) return { admin: true };
  if (handle === requireSuperAdmin) return { superAdmin: true };
  if (handle && handle.staffAreas) return { areas: handle.staffAreas };
  if (handle && handle.permissionScope) return { scope: handle.permissionScope };
  if (handle && handle.tournamentStaff) return { tournamentStaff: true };
  return null;
};

const routes = {};

const collect = (routerPath, prefix) => {
  const { module: router } = loadModuleWithMocks(routerPath, {
    [authMiddlewarePath]: authMock,
    [permissionMiddlewarePath]: permissionMock,
  });

  // Prefix guards accumulate as the stack is walked, so a route only inherits
  // the ones declared before it.
  const active = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        const handles = layer.route.stack.map((routeLayer) => routeLayer.handle);
        const own = handles.map(describeGuard).filter(Boolean);
        const routePath = prefix + layer.route.path;
        const inherited = active
          .filter((entry) => entry.matchers.some((match) => {
            try { return Boolean(match(layer.route.path)); } catch { return false; }
          }))
          .map((entry) => entry.guard);
        const all = [...own, ...inherited];
        for (const method of Object.keys(layer.route.methods)) {
          routes[method.toUpperCase() + " " + routePath] = {
            admin: all.some((guard) => guard.admin),
            superAdmin: all.some((guard) => guard.superAdmin),
            areas: all.find((guard) => guard.areas)?.areas ?? null,
            scope: all.find((guard) => guard.scope)?.scope ?? null,
            tournamentStaff: all.some((guard) => guard.tournamentStaff),
            // Where the guard came from, so a prefix-guarded route is not
            // mistaken for one that names its own.
            viaPrefix: own.length === 0 && inherited.length > 0,
          };
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      } else {
        const guard = describeGuard(layer.handle);
        // Express 5 exposes path matching as \`matchers\`; a guard mounted
        // without a path matches everything and is not a prefix guard.
        if (guard && Array.isArray(layer.matchers) && layer.path !== "/") {
          active.push({ matchers: layer.matchers, guard });
        }
      }
    }
  };
  walk(router.stack);
};

collect(path.join(backend, "src/routes/index.js"), "");
collect(path.join(backend, "src/routes/v1.js"), "/v1");

process.stdout.write("ROUTES:" + JSON.stringify(routes) + "\\n");
process.exit(0);
`;

let collected;
const collectRoutes = () => {
  if (collected) return collected;
  const environment = { ...process.env, DOTENV_CONFIG_QUIET: "true", NODE_V8_COVERAGE: "" };
  const result = spawnSync(process.execPath, ["-e", WALK_SCRIPT], { cwd: path.join(__dirname, ".."), env: environment, encoding: "utf8" });
  const line = (result.stdout || "").split("\n").find((entry) => entry.startsWith("ROUTES:"));
  assert.ok(line, `route walk failed (exit ${result.status}): ${result.stderr}`);
  collected = new Map(Object.entries(JSON.parse(line.slice("ROUTES:".length))));
  return collected;
};

const isAdminSurface = (key) => {
  const [method, routePath] = key.split(" ");
  const withoutVersion = routePath.startsWith("/v1/") ? routePath.slice(3) : routePath;
  return withoutVersion.startsWith("/admin")
    || withoutVersion.startsWith("/images")
    || (withoutVersion.startsWith("/posters") && method !== "GET");
};

const guarded = (guard) =>
  guard.admin || guard.superAdmin || guard.areas || guard.scope || guard.tournamentStaff;

test("every admin route under /api names exactly one guard", () => {
  const routes = collectRoutes();
  const adminRoutes = [...routes.entries()].filter(([key]) => isAdminSurface(key));
  assert.ok(adminRoutes.length > 180, `expected the full admin surface, found ${adminRoutes.length} routes`);
  for (const [key, guard] of adminRoutes) {
    assert.ok(guarded(guard), `${key} has no admin or staff-area guard`);
    assert.ok(!(guard.admin && guard.areas), `${key} has both an admin and a staff-area guard`);
  }
});

test("both mounted routers are walked, not just /api", () => {
  // The bug this test carried for a long time was silent: every assertion
  // passed while the entire v1 admin surface went unread.
  const routes = collectRoutes();
  const v1Admin = [...routes.keys()].filter((key) => key.includes(" /v1/admin/"));
  assert.ok(v1Admin.length > 90, `expected the v1 admin surface, found ${v1Admin.length} routes`);
  assert.ok(routes.has("GET /v1/admin/game-accounts"), "v1 game account routes are missing");
  assert.ok(routes.has("GET /admin/dashboard"), "the /api admin routes are missing");
});

test("delegable admin routes open to the intended staff areas and the rest stay admin-only", () => {
  const routes = collectRoutes();
  const expectAreas = (key, areas) => {
    assert.ok(routes.has(key), `missing route ${key}`);
    assert.deepEqual(routes.get(key).areas, areas, key);
  };
  const expectAdminOnly = (key) => {
    assert.ok(routes.has(key), `missing route ${key}`);
    assert.equal(routes.get(key).admin, true, `${key} must stay admin-only`);
  };

  for (const key of [
    "GET /admin/dashboard",
    "GET /admin/users",
    "POST /admin/users",
    "PATCH /admin/users/:userId",
    "DELETE /admin/users/:userId",
    "POST /admin/media/import-legacy-posters",
    "POST /admin/media/migrate-image-assets",
  ]) {
    expectAdminOnly(key);
  }

  expectAreas("GET /admin/tournaments", ["tournaments", "registrations", "media"]);
  expectAreas("POST /admin/tournaments", ["tournaments"]);
  expectAreas("DELETE /admin/tournaments/:tournamentId", ["tournaments"]);
  expectAreas("POST /admin/tournaments/:tournamentId/bracket/generate", ["tournaments"]);
  expectAreas("POST /admin/events", ["tournaments"]);
  expectAreas("GET /admin/events/:eventId/registrations", ["tournaments", "registrations"]);
  expectAreas("GET /admin/event-series", ["tournaments", "tickets"]);
  expectAreas("GET /admin/tournaments/:tournamentId/registrations", ["registrations"]);
  expectAreas("PATCH /admin/team-registrations/:registrationId/status", ["registrations"]);
  expectAreas("GET /admin/team-registrations/export", ["registrations"]);
  expectAreas("GET /admin/game-categories", ["games", "tournaments"]);
  expectAreas("POST /admin/game-categories", ["games"]);
  expectAreas("POST /admin/rulebooks", ["rulebooks"]);
  expectAreas("POST /images", ["media", "shop"]);
  expectAreas("DELETE /images/:imageId", ["media", "shop"]);
  expectAreas("POST /posters", ["media"]);
  expectAreas("GET /admin/media/files", ["media"]);
  expectAreas("POST /admin/event-albums/:albumId/photos", ["media"]);
  expectAreas("POST /admin/teams/:teamId/captain-transfer", ["teams"]);
  expectAreas("GET /admin/recruitment-applications/export", ["recruitment"]);
  expectAreas("DELETE /admin/contact-messages/:messageId", ["contact_messages"]);
  expectAreas("POST /admin/ticket-events/:eventId/scan", ["tickets"]);
  expectAreas("PATCH /admin/orders/:orderId", ["shop"]);
  expectAreas("PATCH /admin/payments/:transactionId/bank-transfer-review", ["payments"]);
  expectAreas("POST /admin/expenses", ["expenses"]);

  // v1, previously unwalked entirely.
  expectAreas("GET /v1/admin/game-accounts", ["game_accounts"]);
  expectAreas("POST /v1/admin/game-accounts/:accountId/unlink", ["game_accounts"]);
  expectAreas("GET /v1/admin/game-accounts/change-requests", ["game_accounts"]);
  expectAreas("GET /v1/admin/valorant/leaderboard/players", ["valorant_leaderboard"]);
  expectAreas("DELETE /v1/admin/valorant/leaderboard/players/:puuid", ["valorant_leaderboard"]);
});

test("the leaderboard area survives the blanket guard it is declared before", () => {
  // `router.use("/admin/valorant", requireAdmin)` sits between the leaderboard
  // routes and the rest of /admin/valorant. Move a leaderboard route below it
  // and a `valorant_leaderboard` role holder silently loses their own area, so
  // the order is pinned here rather than left to a comment.
  const routes = collectRoutes();
  const leaderboard = routes.get("GET /v1/admin/valorant/leaderboard/players");
  assert.deepEqual(leaderboard.areas, ["valorant_leaderboard"]);
  assert.equal(leaderboard.admin, false, "a leaderboard route must not inherit the blanket admin guard");

  // Everything else under /admin/valorant is declared after the blanket and is
  // guarded by it alone.
  const series = routes.get("GET /v1/admin/valorant/series");
  assert.equal(series.admin, true);
  assert.equal(series.viaPrefix, true, "the series routes rely on the prefix guard");
  assert.equal(series.areas, null);
});

test("super-admin-only routes are not reachable through a staff area", () => {
  const routes = collectRoutes();
  for (const key of [
    "POST /v1/admin/staff-roles",
    "PATCH /v1/admin/staff-roles/:roleId",
    "DELETE /v1/admin/staff-roles/:roleId",
  ]) {
    assert.ok(routes.has(key), `missing route ${key}`);
    assert.equal(routes.get(key).superAdmin, true, `${key} must stay super-admin-only`);
    assert.equal(routes.get(key).areas, null, `${key} must not open to a staff area`);
  }
});
