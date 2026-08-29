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

test("event album controllers pass request data through and return their response envelopes", async () => {
  const calls = [];
  const streamedPaths = [];
  const adminPhoto = {
    contentType: "image/jpeg",
    size: 12,
    path: "private/event-photo.jpg",
    originalName: "event-photo.jpg",
  };
  const { module: controller, restore } = loadModuleWithMocks(albumControllerPath, {
    [albumServicePath]: {
      listPublicEventAlbums: async (query) => ({ items: [query], pagination: { page: 1 }, totalPhotos: 2 }),
      getPublicEventAlbumBySlug: async (slug, query) => ({ slug, query }),
      getAdminEventAlbumPhoto: async (options) => {
        calls.push(["getAdminEventAlbumPhoto", options]);
        return adminPhoto;
      },
      listAdminEventAlbums: async (query) => ({ items: [query], pagination: { page: 2 } }),
      getAdminEventAlbumById: async (albumId) => ({ id: albumId }),
      createEventAlbum: async (body) => {
        calls.push(["createEventAlbum", body]);
        return { id: "created", title: body.title };
      },
      updateEventAlbum: async (albumId, body) => {
        calls.push(["updateEventAlbum", albumId, body]);
        return { id: albumId, title: body.title };
      },
      deleteEventAlbum: async (albumId) => calls.push(["deleteEventAlbum", albumId]),
      uploadEventAlbumPhotos: async (options) => {
        calls.push(["uploadEventAlbumPhotos", options]);
        return { id: options.albumId, photoCount: options.files.length };
      },
      reorderEventAlbumPhotos: async (albumId, photoIds) => {
        calls.push(["reorderEventAlbumPhotos", albumId, photoIds]);
        return { id: albumId, photoIds };
      },
      deleteEventAlbumPhoto: async (albumId, photoId) => calls.push(["deleteEventAlbumPhoto", albumId, photoId]),
      getPublicEventAlbumPhoto: async () => ({ contentType: "image/jpeg", data: Buffer.from("public") }),
    },
    [downloadPath]: { prepareEventAlbumPhotoDownload: async (image) => image },
    [streamResponsePath]: {
      streamFileToResponse: async (filePath) => streamedPaths.push(filePath),
    },
  });

  const response = () => ({
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    send(body) { this.body = body; },
  });
  const invoke = async (name, req) => {
    const res = response();
    let nextError;
    await controller[name](req, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined, `${name} should not call next with an error`);
    return res;
  };

  try {
    assert.deepEqual((await invoke("getEventAlbums", { query: { page: "2" } })).body, {
      success: true,
      albums: [{ page: "2" }],
      pagination: { page: 1 },
      totalPhotos: 2,
    });
    assert.deepEqual((await invoke("getEventAlbum", { params: { slug: "finals" }, query: { photoPage: "2" } })).body, {
      success: true,
      album: { slug: "finals", query: { photoPage: "2" } },
    });
    assert.deepEqual((await invoke("getAdminEventAlbums", { query: { search: "finals" } })).body, {
      success: true,
      albums: [{ search: "finals" }],
      pagination: { page: 2 },
    });
    assert.deepEqual((await invoke("getAdminEventAlbum", { params: { albumId: "album-1" } })).body, {
      success: true,
      album: { id: "album-1" },
    });
    assert.equal((await invoke("createAdminEventAlbum", { body: { title: "Finals" } })).statusCode, 201);
    assert.equal((await invoke("updateAdminEventAlbum", { params: { albumId: "album-1" }, body: { title: "Updated" } })).statusCode, 200);
    assert.equal((await invoke("deleteAdminEventAlbum", { params: { albumId: "album-1" } })).body.message, "Event album deleted.");
    assert.equal((await invoke("uploadAdminEventAlbumPhotos", {
      params: { albumId: "album-1" },
      body: { title: "Stage" },
      files: [{ originalname: "stage.jpg" }],
    })).statusCode, 201);
    assert.equal((await invoke("reorderAdminEventAlbumPhotos", {
      params: { albumId: "album-1" },
      body: { photoIds: ["photo-1"] },
    })).statusCode, 200);
    assert.equal((await invoke("deleteAdminEventAlbumPhoto", {
      params: { albumId: "album-1", photoId: "photo-1" },
    })).body.message, "Album photo deleted.");

    const adminStream = await invoke("streamAdminEventAlbumPhoto", {
      params: { albumId: "album-1", photoId: "photo-1" },
    });
    assert.equal(adminStream.headers["Cache-Control"], "private, max-age=31536000, immutable");
    assert.equal(adminStream.headers["Content-Length"], 12);
    assert.deepEqual(streamedPaths, ["private/event-photo.jpg"]);
    assert.deepEqual(calls, [
      ["createEventAlbum", { title: "Finals" }],
      ["updateEventAlbum", "album-1", { title: "Updated" }],
      ["deleteEventAlbum", "album-1"],
      ["uploadEventAlbumPhotos", {
        albumId: "album-1",
        body: { title: "Stage" },
        files: [{ originalname: "stage.jpg" }],
      }],
      ["reorderEventAlbumPhotos", "album-1", ["photo-1"]],
      ["deleteEventAlbumPhoto", "album-1", "photo-1"],
      ["getAdminEventAlbumPhoto", { albumId: "album-1", photoId: "photo-1" }],
    ]);
  } finally {
    restore();
  }
});
