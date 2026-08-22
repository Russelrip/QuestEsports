const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const routesPath = path.join(__dirname, "../src/modules/media/media.routes.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const mediaControllerPath = path.join(__dirname, "../src/modules/media/media.controller.js");
const albumControllerPath = path.join(__dirname, "../src/modules/media/event-album.controller.js");

const controllerHandler = (_req, _res, next) => next?.();
const controllerMock = new Proxy({}, { get: () => controllerHandler });

test("event album routes cache public reads and invalidate every successful mutation", () => {
  const cacheConfigurations = [];
  const publicCacheConfigurations = [];
  const invalidations = [];
  const eventAlbumCacheMiddleware = (_req, _res, next) => next();
  const eventAlbumPublicCacheMiddleware = (_req, _res, next) => next();
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
    [cacheControlPath]: {
      cachePublicData: (configuration) => {
        publicCacheConfigurations.push(configuration);
        return eventAlbumPublicCacheMiddleware;
      },
    },
    [envPath]: { env: { CACHE_TTL_SECONDS: 123 } },
    [mediaControllerPath]: controllerMock,
    [albumControllerPath]: controllerMock,
  });

  try {
    assert.deepEqual(cacheConfigurations, [{
      ttlSeconds: 123,
      tags: ["event-albums", "tournaments", "foundation"],
      allowCookies: true,
    }]);
    assert.deepEqual(publicCacheConfigurations, [{ browserSeconds: 60, sharedSeconds: 300 }]);
    assert.equal(invalidations.length, 9);
    assert.deepEqual(invalidations.slice(0, 3), [
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
      ["tournaments", "foundation"],
    ]);
    assert.ok(invalidations.slice(3).every((tags) => tags.length === 3 && tags.join(",") === "event-albums,tournaments,foundation"));

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
    assert.ok(
      routeMiddleware.get("GET /event-albums").indexOf("eventAlbumPublicCacheMiddleware") <
        routeMiddleware.get("GET /event-albums").indexOf("eventAlbumCacheMiddleware"),
    );
    assert.ok(
      routeMiddleware.get("GET /event-albums/:slug").indexOf("eventAlbumPublicCacheMiddleware") <
        routeMiddleware.get("GET /event-albums/:slug").indexOf("eventAlbumCacheMiddleware"),
    );
    for (const route of [
      "POST /posters",
      "PATCH /posters/:posterId",
      "DELETE /posters/:posterId",
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
