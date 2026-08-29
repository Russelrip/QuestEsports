const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const {
  prepareEventAlbumPhotoDownload,
  safeDownloadName,
} = require("../src/modules/media/event-album-download");

const mediaServicePath = path.join(__dirname, "../src/modules/media/media.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const envPath = path.join(__dirname, "../src/config/env.js");

test("event album downloads transcode optimized WebP bytes into a real JPEG", async () => {
  const webp = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 80, g: 40, b: 160 },
    },
  }).webp().toBuffer();

  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/webp",
    data: webp,
    originalName: "DSC00589.jpg",
  });

  assert.equal(download.contentType, "image/jpeg");
  assert.equal(download.filename, "DSC00589.jpg");
  assert.deepEqual(download.data.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal((await sharp(download.data).metadata()).format, "jpeg");
});

test("event album downloads return an available original without re-encoding it", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/jpeg",
    data: jpeg,
    originalName: "camera-original.jpeg",
  });

  assert.equal(download.data, jpeg);
  assert.equal(download.filename, "camera-original.jpg");
});

test("event album downloads transcode to the requested PNG format when the original is a PNG", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 80, g: 40, b: 160 } },
  }).jpeg().toBuffer();
  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/jpeg",
    data: jpeg,
    originalName: "stage.png",
  });
  assert.equal(download.contentType, "image/png");
  assert.equal((await sharp(download.data).metadata()).format, "png");
});

test("event album downloads transcode to WebP when the original extension requests it", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 80, g: 40, b: 160 } },
  }).jpeg().toBuffer();
  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/jpeg",
    data: jpeg,
    originalName: "stage.webp",
  });
  assert.equal(download.contentType, "image/webp");
  assert.equal((await sharp(download.data).metadata()).format, "webp");
});

test("event album media flow serves the WebP preview normally and the private original on download", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "quest-event-album-media-"));
  const publicPreviewRoot = path.join(fixtureRoot, "uploads", "poster-images");
  const privateOriginalRoot = path.join(fixtureRoot, "private", "event-album-originals");
  await fs.mkdir(publicPreviewRoot, { recursive: true });
  await fs.mkdir(privateOriginalRoot, { recursive: true });

  const storedFilename = "photo-preview.webp";
  const originalFilename = "photo-preview.original.jpg";
  const originalName = "camera-original.jpg";
  const preview = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 20, g: 100, b: 220 },
    },
  }).webp().toBuffer();
  const original = await sharp({
    create: {
      width: 3,
      height: 1,
      channels: 3,
      background: { r: 220, g: 100, b: 20 },
    },
  }).jpeg().toBuffer();
  await fs.writeFile(path.join(publicPreviewRoot, storedFilename), preview);
  await fs.writeFile(path.join(privateOriginalRoot, originalFilename), original, { mode: 0o600 });

  const imageAsset = {
    id: "asset-event-photo",
    storedFilename,
    originalName,
    contentType: "image/webp",
    data: null,
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma: { imageAsset: { findUnique: async () => imageAsset } } },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: publicPreviewRoot,
      eventAlbumOriginalDirectory: privateOriginalRoot,
      buildEventAlbumOriginalFilename: () => originalFilename,
      detectImageType: (header) => {
        if (header.subarray(0, 4).toString("ascii") === "RIFF") return "webp";
        if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "jpeg";
        return null;
      },
    },
  });

  try {
    const publicImage = await mediaService.getImageAssetById(imageAsset.id);
    assert.deepEqual(await fs.readFile(publicImage.path), preview);
    assert.equal(publicImage.contentType, "image/webp");

    const originalImage = await mediaService.getImageAssetDownloadById(imageAsset.id);
    assert.deepEqual(await fs.readFile(originalImage.path), original);
    assert.equal(originalImage.contentType, "image/jpeg");

    const download = await prepareEventAlbumPhotoDownload({
      ...originalImage,
      originalName,
    });
    assert.equal(download.filename, "camera-original.jpg");
    assert.deepEqual(await fs.readFile(download.path), original);
  } finally {
    restore();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("download filenames cannot inject response headers", () => {
  assert.equal(safeDownloadName('photo\r\n"bad.jpg', "image/jpeg"), "photo---bad.jpg");
});

test("event album image assets persist photo metadata and map the preview URL", async () => {
  const created = [];
  const prisma = {
    imageAsset: {
      create: async (options) => { created.push(options); return options.data; },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const file = { originalname: "stage.jpg" };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: "uploads/poster-images",
      eventAlbumOriginalDirectory: "private/event-album-originals",
      persistEventAlbumPhotoUpload: async () => ({
        filename: "stage.webp",
        originalFilename: "stage.original.jpg",
        contentType: "image/webp",
        byteSize: 42,
      }),
      persistPosterImageUpload: async () => { throw new Error("poster path should not be selected"); },
    },
  });
  try {
    const [asset] = await mediaService.createImageAssets({
      body: { title: " Stage ", description: " Finals ", category: "photo" },
      files: [file],
    });
    assert.deepEqual(created[0].data, {
      id: created[0].data.id,
      title: "Stage",
      description: "Finals",
      category: "photo",
      originalName: "stage.jpg",
      storedFilename: "stage.webp",
      contentType: "image/webp",
      byteSize: 42,
    });
    assert.equal(asset.imageUrl, "/api/uploads/poster-images/stage.webp");
    assert.equal(asset.byteSize, 42);
  } finally {
    restore();
  }
});

test("event album download falls back to the preview when no valid original is retained", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "quest-event-album-fallback-"));
  const publicPreviewRoot = path.join(fixtureRoot, "uploads", "poster-images");
  const privateOriginalRoot = path.join(fixtureRoot, "private", "event-album-originals");
  await fs.mkdir(publicPreviewRoot, { recursive: true });
  await fs.mkdir(privateOriginalRoot, { recursive: true });
  const preview = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 100, b: 220 } },
  }).webp().toBuffer();
  await fs.writeFile(path.join(publicPreviewRoot, "stage.webp"), preview);
  const imageAsset = {
    id: "asset-event-photo",
    storedFilename: "stage.webp",
    originalName: "stage.tiff",
    contentType: "image/webp",
    data: null,
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma: { imageAsset: { findUnique: async () => imageAsset } } },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: publicPreviewRoot,
      eventAlbumOriginalDirectory: privateOriginalRoot,
      buildEventAlbumOriginalFilename: (storedFilename, originalName) =>
        originalName === "stage.tiff" ? null : `${storedFilename}.original.jpg`,
      detectImageType: (header) => header.subarray(0, 4).toString("ascii") === "RIFF" ? "webp" : null,
    },
  });
  try {
    const result = await mediaService.getImageAssetDownloadById(imageAsset.id);
    assert.deepEqual(await fs.readFile(result.path), preview);
    assert.equal(result.contentType, "image/webp");
  } finally {
    restore();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("deleting an unused event album asset removes its preview and preserved original", async () => {
  const cleanup = [];
  const prisma = {
    imageAsset: {
      findUnique: async () => ({
        id: "asset-event-photo",
        originalName: "stage.jpg",
        storedFilename: "stage.webp",
        _count: { posters: 0, productImages: 0, albumPhotos: 0 },
      }),
      delete: async (options) => options,
    },
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: "uploads/poster-images",
      eventAlbumOriginalDirectory: "private/event-album-originals",
      buildEventAlbumOriginalFilename: () => "stage.original.jpg",
    },
    [path.join(__dirname, "../src/lib/upload-cleanup.js")]: {
      removeUploadsQuietly: async (uploads, options) => cleanup.push({ uploads, options }),
    },
  });
  try {
    await mediaService.deleteUnusedImageAsset("asset-event-photo");
    assert.deepEqual(cleanup, [{
      uploads: [
        { directory: "uploads/poster-images", filename: "stage.webp" },
        { directory: "private/event-album-originals", filename: "stage.original.jpg" },
      ],
      options: { operation: "deleteUnusedImageAsset", imageId: "asset-event-photo" },
    }]);
  } finally {
    restore();
  }
});

test("event album image reads preserve database bytes when no preview file exists", async () => {
  const asset = {
    id: "asset-event-photo",
    storedFilename: null,
    contentType: "image/jpeg",
    data: Buffer.from("legacy-photo"),
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma: { imageAsset: { findUnique: async () => asset } } },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: "uploads/poster-images",
      eventAlbumOriginalDirectory: "private/event-album-originals",
      buildEventAlbumOriginalFilename: () => null,
      detectImageType: () => null,
    },
  });
  try {
    const result = await mediaService.getImageAssetById(asset.id);
    assert.equal(result.contentType, "image/jpeg");
    assert.deepEqual(result.data, asset.data);
  } finally {
    restore();
  }
});

test("event album media rejects corrupt preview and original files instead of serving them", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "quest-event-album-corrupt-"));
  const publicPreviewRoot = path.join(fixtureRoot, "uploads", "poster-images");
  const privateOriginalRoot = path.join(fixtureRoot, "private", "event-album-originals");
  await fs.mkdir(publicPreviewRoot, { recursive: true });
  await fs.mkdir(privateOriginalRoot, { recursive: true });
  await fs.writeFile(path.join(publicPreviewRoot, "stage.webp"), Buffer.from("not-an-image"));
  await fs.writeFile(path.join(privateOriginalRoot, "stage.original.jpg"), Buffer.from("not-an-image"));
  const assets = {
    preview: { id: "preview", storedFilename: "stage.webp", originalName: "stage.jpg", contentType: "image/webp" },
    original: { id: "original", storedFilename: "stage.webp", originalName: "stage.jpg", contentType: "image/webp" },
    missing: { id: "missing", storedFilename: null, originalName: null, contentType: "image/jpeg", data: null },
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma: { imageAsset: { findUnique: async ({ where }) => assets[where.id] } } },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: publicPreviewRoot,
      eventAlbumOriginalDirectory: privateOriginalRoot,
      buildEventAlbumOriginalFilename: () => "stage.original.jpg",
      detectImageType: () => null,
    },
  });
  try {
    await assert.rejects(() => mediaService.getImageAssetById("preview"), (error) => error.statusCode === 404);
    await assert.rejects(() => mediaService.getImageAssetDownloadById("original"), (error) => error.statusCode === 404);
    await assert.rejects(() => mediaService.getImageAssetById("missing"), (error) => error.statusCode === 404);
  } finally {
    restore();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("event album asset persistence rolls back retained files when database creation fails", async () => {
  const cleanup = [];
  const prisma = {
    imageAsset: { create: async () => { throw new Error("asset insert failed"); } },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: "uploads/poster-images",
      eventAlbumOriginalDirectory: "private/event-album-originals",
      persistEventAlbumPhotoUpload: async () => ({
        filename: "stage.webp",
        originalFilename: "stage.original.jpg",
        contentType: "image/webp",
        byteSize: 42,
      }),
    },
    [path.join(__dirname, "../src/lib/upload-cleanup.js")]: {
      removeUploadsQuietly: async (uploads, options) => cleanup.push({ uploads, options }),
    },
  });
  try {
    await assert.rejects(
      mediaService.createImageAssets({
        body: { title: "Stage", category: "photo" },
        files: [{ originalname: "stage.jpg" }],
      }),
      /asset insert failed/,
    );
    assert.deepEqual(cleanup, [{
      uploads: [
        { directory: "uploads/poster-images", filename: "stage.webp" },
        { directory: "private/event-album-originals", filename: "stage.original.jpg" },
      ],
      options: { operation: "createImageAssets" },
    }]);
  } finally {
    restore();
  }
});

test("event album asset deletion refuses an image still referenced by album photos", async () => {
  const prisma = {
    imageAsset: {
      findUnique: async () => ({
        id: "asset-event-photo",
        storedFilename: "stage.webp",
        originalName: "stage.jpg",
        _count: { posters: 0, productImages: 0, albumPhotos: 1 },
      }),
    },
  };
  const { module: mediaService, restore } = loadModuleWithMocks(mediaServicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: { DATABASE_URL: "postgresql://fixture", DIRECT_URL: "postgresql://fixture" } },
    [uploadPath]: {
      posterImageDirectory: "uploads/poster-images",
      eventAlbumOriginalDirectory: "private/event-album-originals",
      buildEventAlbumOriginalFilename: () => "stage.original.jpg",
    },
  });
  try {
    await assert.rejects(
      mediaService.deleteUnusedImageAsset("asset-event-photo"),
      (error) => error.statusCode === 409 && /still in use/.test(error.message),
    );
  } finally {
    restore();
  }
});
