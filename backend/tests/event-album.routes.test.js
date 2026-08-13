const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const routesPath = path.join(__dirname, "../src/modules/media/media.routes.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const mediaControllerPath = path.join(__dirname, "../src/modules/media/media.controller.js");
const albumControllerPath = path.join(__dirname, "../src/modules/media/event-album.controller.js");

const controllerHandler = (_req, _res, next) => next?.();
const controllerMock = new Proxy({}, { get: () => controllerHandler });

test("event album routes cache public reads and invalidate every successful mutation", () => {
  const cacheConfigurations = [];
  const invalidations = [];
  const eventAlbumCacheMiddleware = (_req, _res, next) => next();
  const eventAlbumInvalidationMiddleware = (_req, _res, next) => next();
  const uploadMiddleware = (_req, _res, next) => next();

  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: { requireAdmin: controllerHandler },
    [uploadPath]: {
      createUploadRequestSizeGuard: () => uploadMiddleware,
      dbImageUpload: { array: () => uploadMiddleware },
    },
    [responseCachePath]: {
      cacheJson: (configuration) => {
        cacheConfigurations.push(configuration);
        return eventAlbumCacheMiddleware;
      },
      invalidateCache: (...tags) => {
        invalidations.push(tags);
        return eventAlbumInvalidationMiddleware;
      },
    },
    [envPath]: { env: { CACHE_TTL_SECONDS: 123 } },
    [mediaControllerPath]: controllerMock,
    [albumControllerPath]: controllerMock,
  });

  try {
    assert.deepEqual(cacheConfigurations, [{
      ttlSeconds: 123,
      tags: ["event-albums", "tournaments"],
      allowCookies: true,
    }]);
    assert.equal(invalidations.length, 6);
    assert.ok(invalidations.every((tags) => tags.length === 1 && tags[0] === "event-albums"));

    const routeMiddleware = new Map(
      router.stack
        .filter((layer) => layer.route)
        .map((layer) => [
          `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`,
          layer.route.stack.map((routeLayer) => routeLayer.handle.name),
        ]),
    );
    assert.ok(routeMiddleware.get("GET /event-albums").includes("eventAlbumCacheMiddleware"));
    assert.ok(routeMiddleware.get("GET /event-albums/:slug").includes("eventAlbumCacheMiddleware"));
    for (const route of [
      "POST /admin/event-albums",
      "PATCH /admin/event-albums/:albumId",
      "DELETE /admin/event-albums/:albumId",
      "POST /admin/event-albums/:albumId/photos",
      "PATCH /admin/event-albums/:albumId/photos/reorder",
      "DELETE /admin/event-albums/:albumId/photos/:photoId",
    ]) {
      assert.ok(
        routeMiddleware.get(route).includes("eventAlbumInvalidationMiddleware"),
        `${route} should invalidate event album cache entries`,
      );
    }
  } finally {
    restore();
  }
});
