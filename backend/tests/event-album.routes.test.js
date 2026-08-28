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
const albumServicePath = path.join(__dirname, "../src/modules/media/event-album.service.js");
const downloadPath = path.join(__dirname, "../src/modules/media/event-album-download.js");
const streamResponsePath = path.join(__dirname, "../src/lib/stream-response.js");

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
    assert.ok(routeMiddleware.has("GET /event-albums/:slug/photos/:photoId/image"));
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

test("event photo route uses the preview normally and the original for an allowed download", async () => {
  const preview = Buffer.from("webp-preview");
  const original = Buffer.from("jpeg-original");
  const calls = [];
  const responses = [];
  const { module: controller, restore } = loadModuleWithMocks(albumControllerPath, {
    [albumServicePath]: {
      getPublicEventAlbumPhoto: async (options) => {
        calls.push(options);
        return options.preferOriginal
          ? { contentType: "image/jpeg", data: original, size: original.length, originalName: "camera-original.jpg", allowDownloads: true }
          : { contentType: "image/webp", data: preview, size: preview.length, originalName: "camera-original.jpg", allowDownloads: true };
      },
    },
    [downloadPath]: {
      prepareEventAlbumPhotoDownload: async (image) => ({ ...image, filename: "camera-original.jpg" }),
    },
    [streamResponsePath]: { streamFileToResponse: async () => undefined },
  });

  const invoke = async (query) => {
    const response = {
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; },
    };
    let nextError;
    await controller.streamEventAlbumPhoto(
      { params: { slug: "quest-finals", photoId: "photo-1" }, query },
      response,
      (error) => { nextError = error; },
    );
    assert.equal(nextError, undefined);
    responses.push(response);
  };

  try {
    await invoke({});
    await invoke({ download: "original" });
    assert.deepEqual(calls.map(({ preferOriginal }) => preferOriginal), [false, true]);
    assert.equal(responses[0].body, preview);
    assert.equal(responses[0].headers["Content-Type"], "image/webp");
    assert.equal(responses[1].body, original);
    assert.equal(responses[1].headers["Content-Type"], "image/jpeg");
    assert.equal(responses[1].headers["Content-Disposition"], 'attachment; filename="camera-original.jpg"');
  } finally {
    restore();
  }
});
