const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const teamRoutesPath = path.join(__dirname, "../src/modules/teams/team.routes.js");
const adminRoutesPath = path.join(__dirname, "../src/modules/admin/admin.routes.js");
const authMiddlewarePath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const teamControllerPath = path.join(__dirname, "../src/modules/teams/team.controller.js");
const adminControllerPath = path.join(__dirname, "../src/modules/admin/admin.controller.js");
const cachePath = path.join(__dirname, "../src/lib/cache.js");

const controllerHandler = (_req, _res, next) => next?.();
const controllerMock = new Proxy({}, { get: () => controllerHandler });
const passThrough = (_req, _res, next) => next();

const routeMiddleware = (router) => new Map(
  router.stack
    .filter((layer) => layer.route)
    .map((layer) => [
      `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`,
      layer.route.stack.map((routeLayer) => routeLayer.handle),
    ]),
);

test("team and admin team mutations invalidate both local projection tags", () => {
  const teamInvalidations = [];
  const adminInvalidations = [];
  const teamInvalidationMiddleware = (_req, _res, next) => next();
  const adminInvalidationMiddleware = (_req, _res, next) => next();
  const rateLimiter = () => passThrough;
  const uploadMiddleware = { single: () => passThrough };

  const teamLoaded = loadModuleWithMocks(teamRoutesPath, {
    [authMiddlewarePath]: {
      requireAuth: passThrough,
      requireVerifiedEmail: passThrough,
    },
    [rateLimitPath]: { createRateLimiter: rateLimiter },
    [uploadPath]: { imageUpload: uploadMiddleware },
    [responseCachePath]: {
      invalidateCache: (...tags) => {
        teamInvalidations.push(tags);
        return teamInvalidationMiddleware;
      },
    },
    [teamControllerPath]: controllerMock,
  });

  const adminLoaded = loadModuleWithMocks(adminRoutesPath, {
    [authMiddlewarePath]: { requireAdmin: passThrough },
    [uploadPath]: { imageUpload: uploadMiddleware },
    [responseCachePath]: {
      invalidateCache: (...tags) => {
        adminInvalidations.push(tags);
        return adminInvalidationMiddleware;
      },
    },
    [adminControllerPath]: controllerMock,
  });

  try {
    const teamRoutes = routeMiddleware(teamLoaded.module);
    const adminRoutes = routeMiddleware(adminLoaded.module);
    const captainPatch = teamRoutes.get("PATCH /teams/:teamId");
    const adminPatch = adminRoutes.get("PATCH /admin/teams/:teamId");

    assert.deepEqual(teamInvalidations, [
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
    ]);
    assert.deepEqual(adminInvalidations, Array.from({ length: 11 }, () => ["tournaments", "foundation"]));
    assert.ok(captainPatch.includes(teamInvalidationMiddleware));
    assert.ok(adminPatch.includes(adminInvalidationMiddleware));
    for (const route of [
      "PATCH /admin/team-registrations/:registrationId/status",
      "PATCH /admin/team-registrations/:registrationId/game-ids",
      "PATCH /admin/team-registrations/:registrationId/logo",
      "PATCH /admin/team-registrations/:registrationId/roster",
      "DELETE /admin/team-registrations/:registrationId",
      "POST /admin/team-registrations/:registrationId/slot-reservation",
      "DELETE /admin/team-registrations/:registrationId/slot-reservation",
      "PATCH /admin/teams/:teamId",
      "PATCH /admin/teams/:teamId/organization",
      "POST /admin/teams/:teamId/captain-transfer",
      "DELETE /admin/teams/:teamId",
    ]) {
      assert.ok(adminRoutes.get(route)?.includes(adminInvalidationMiddleware), `${route} should invalidate foundation`);
    }
    assert.equal(
      captainPatch.indexOf(teamInvalidationMiddleware),
      captainPatch.indexOf(controllerHandler) - 1,
    );
    assert.equal(
      adminPatch.indexOf(adminInvalidationMiddleware),
      adminPatch.indexOf(controllerHandler) - 1,
    );
  } finally {
    adminLoaded.restore();
    teamLoaded.restore();
  }
});

test("team mutation routes all carry foundation invalidation middleware", () => {
  const invalidationMiddleware = (_req, _res, next) => next();
  const invalidations = [];
  const rateLimiter = () => passThrough;
  const uploadMiddleware = { single: () => passThrough };
  const { module: router, restore } = loadModuleWithMocks(teamRoutesPath, {
    [authMiddlewarePath]: { requireAuth: passThrough, requireVerifiedEmail: passThrough },
    [rateLimitPath]: { createRateLimiter: rateLimiter },
    [uploadPath]: { imageUpload: uploadMiddleware },
    [responseCachePath]: {
      invalidateCache: (...tags) => {
        invalidations.push(tags);
        return invalidationMiddleware;
      },
    },
    [teamControllerPath]: controllerMock,
  });

  try {
    const routes = routeMiddleware(router);
    for (const route of [
      "POST /teams",
      "PATCH /teams/:teamId",
      "DELETE /teams/:teamId",
      // Answering an invitation changes a roster, and a roster is projected
      // into the foundation and tournament caches like any other team edit.
      "POST /me/invitations/:invitationId/respond",
    ]) {
      assert.ok(routes.get(route)?.includes(invalidationMiddleware), `${route} should invalidate foundation`);
    }
    assert.deepEqual(invalidations, [
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
    ]);
  } finally {
    restore();
  }
});

const createResponse = (statusCode) => {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  return response;
};

test("invalidateCache invalidates both tags only for successful responses", () => {
  const invalidatedTags = [];
  const { module: responseCache, restore } = loadModuleWithMocks(responseCachePath, {
    [cachePath]: {
      invalidateTags: (tags) => invalidatedTags.push(tags),
    },
  });

  try {
    const middleware = responseCache.invalidateCache("tournaments", "foundation");
    const successResponse = createResponse(204);
    const failureResponse = createResponse(400);

    middleware({}, successResponse, () => undefined);
    middleware({}, failureResponse, () => undefined);
    successResponse.emit("finish");
    failureResponse.emit("finish");

    assert.deepEqual(invalidatedTags, [["tournaments", "foundation"]]);
  } finally {
    restore();
  }
});
