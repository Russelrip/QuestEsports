const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

// The /api router used to guard every /admin route with one blanket
// `router.use("/admin", requireAdmin)`. Staff roles replaced it with a guard on
// each route, so a route added without one would now be open. This walks the
// real mounted routers and fails on any admin route that names no guard, and
// pins which staff areas open the routes that are delegable.

const indexPath = path.join(__dirname, "../src/routes/index.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const permissionPath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");

const pass = (_req, _res, next) => next();
const requireAdmin = function requireAdmin(_req, _res, next) { next(); };
const passThroughModule = (named) => new Proxy(named, { get: (target, key) => (key in target ? target[key] : pass) });

const collectRoutes = () => {
  const { module: router, restore } = loadModuleWithMocks(indexPath, {
    [authPath]: passThroughModule({ requireAdmin }),
    [permissionPath]: passThroughModule({
      requireStaffPermission: (...areas) => Object.assign((_req, _res, next) => next(), { staffAreas: areas }),
    }),
  });
  try {
    const routes = new Map();
    const walk = (stack) => {
      for (const layer of stack) {
        if (layer.route) {
          const handles = layer.route.stack.map((routeLayer) => routeLayer.handle);
          for (const method of Object.keys(layer.route.methods)) {
            routes.set(`${method.toUpperCase()} ${layer.route.path}`, {
              admin: handles.includes(requireAdmin),
              areas: handles.find((handle) => handle.staffAreas)?.staffAreas ?? null,
            });
          }
        } else if (layer.handle?.stack) {
          walk(layer.handle.stack);
        }
      }
    };
    walk(router.stack);
    return routes;
  } finally {
    restore();
  }
};

const isAdminSurface = (key) => {
  const [method, routePath] = key.split(" ");
  return routePath.startsWith("/admin")
    || routePath.startsWith("/images")
    || (routePath.startsWith("/posters") && method !== "GET");
};

test("every admin route under /api names exactly one guard", () => {
  const routes = collectRoutes();
  const adminRoutes = [...routes.entries()].filter(([key]) => isAdminSurface(key));
  assert.ok(adminRoutes.length > 90, `expected the full admin surface, found ${adminRoutes.length} routes`);
  for (const [key, guard] of adminRoutes) {
    assert.ok(guard.admin || guard.areas, `${key} has no admin or staff-area guard`);
    assert.ok(!(guard.admin && guard.areas), `${key} has both an admin and a staff-area guard`);
  }
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
});
