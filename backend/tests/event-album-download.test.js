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
