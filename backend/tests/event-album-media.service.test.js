const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/media/media.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const cleanupPath = path.join(__dirname, "../src/lib/upload-cleanup.js");

const asset = {
  id: "asset-1",
  title: "Finals photo",
  description: "Stage",
  category: "photo",
  originalName: "finals.jpg",
  storedFilename: null,
  contentType: "image/jpeg",
  byteSize: 12,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  data: Buffer.from("photo-bytes"),
  _count: { posters: 0, productImages: 0, albumPhotos: 0 },
};

const poster = {
  id: "poster-1",
  title: "Finals poster",
  description: "Poster",
  category: "poster",
  headline: "Quest Finals",
  subheadline: "2026",
  accentColor: "#7c3aed",
  textColor: "#ffffff",
  overlayAlign: "bottom-left",
  createdAt: asset.createdAt,
  updatedAt: asset.createdAt,
  tournament: null,
  imageAsset: asset,
};

const loadMediaService = (prisma, upload = {}, cleanup = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [uploadPath]: {
    posterImageDirectory: "uploads/poster-images",
    eventAlbumOriginalDirectory: "private/event-album-originals",
    persistEventAlbumPhotoUpload: async () => null,
    persistPosterImageUpload: async () => null,
    buildEventAlbumOriginalFilename: () => null,
    detectImageType: () => null,
    ...upload,
  },
  [cleanupPath]: { removeUploadsQuietly: async () => true, ...cleanup },
});

test("media service exposes event-photo metadata and legacy poster bytes safely", async () => {
  const prisma = {
    imageAsset: { findUnique: async () => asset },
    poster: {
      findUnique: async () => ({ imageAsset: asset }),
    },
  };
  const { module: service, restore } = loadMediaService(prisma);
  try {
    const metadata = await service.getImageAssetMetadata("asset-1");
    assert.equal(metadata.imageUrl, "/api/images/asset-1/binary");
    assert.deepEqual(metadata.usage, { posters: 0, products: 0, albumPhotos: 0 });
    assert.equal(metadata.canDelete, true);

    const posterImage = await service.getPosterImageAssetByPosterId("poster-1");
    assert.equal(posterImage.contentType, "image/jpeg");
    assert.deepEqual(posterImage.data, asset.data);
  } finally {
    restore();
  }
});

test("media service preserves poster ordering and validates poster lifecycle writes", async () => {
  const calls = [];
  const prisma = {
    imageAsset: { findUnique: async () => ({ id: asset.id }) },
    tournament: { findUnique: async () => ({ id: "tournament-1" }) },
    poster: {
      count: async () => 1,
      findUnique: async () => poster,
      findMany: async () => [poster],
      create: async (options) => { calls.push(["create", options]); return poster; },
      update: async (options) => { calls.push(["update", options]); return poster; },
      deleteMany: async () => ({ count: 1 }),
    },
    $queryRaw: async () => [{ id: "poster-1" }],
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadMediaService(prisma);
  try {
    const created = await service.createPoster({
      body: {
        imageAssetId: "asset-1",
        tournamentId: "tournament-1",
        title: "Finals poster",
        headline: "Quest Finals",
        overlayAlign: "top-right",
      },
    });
    assert.equal(created.id, "poster-1");
    assert.equal(calls[0][1].data.overlayAlign, "top-right");

    const listed = await service.listPosters({ category: "poster", search: "finals" });
    assert.deepEqual(listed.items.map(({ id }) => id), ["poster-1"]);
    assert.equal((await service.getPosterById("poster-1")).title, "Finals poster");

    await service.updatePosterById("poster-1", { title: "Updated poster", tournamentId: null });
    assert.deepEqual(calls[1][1].data, {
      tournamentId: null,
      title: "Updated poster",
      headline: "Updated poster",
    });
    await service.deletePosterById("poster-1");
  } finally {
    restore();
  }
});

test("media service migrates retained database photo bytes to the preview filesystem", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "quest-event-album-migration-"));
  const migrated = [];
  const assets = [
    { id: "stored", storedFilename: "already.webp", contentType: "image/webp", data: null },
    { id: "legacy", storedFilename: null, contentType: "image/jpeg", data: Buffer.from("legacy-photo") },
  ];
  const prisma = {
    imageAsset: {
      findMany: async () => assets,
      update: async (options) => { migrated.push(options); return options; },
      count: async () => 0,
    },
  };
  const { module: service, restore } = loadMediaService(prisma, { posterImageDirectory: fixtureRoot });
  try {
    const result = await service.migrateImageAssetsToFilesystem();
    assert.deepEqual(result, { migratedCount: 1, skippedCount: 1, remainingDbImages: 0 });
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].where.id, "legacy");
    assert.equal(migrated[0].data.byteSize, assets[1].data.length);
    assert.equal(migrated[0].data.data, null);
    assert.deepEqual(await fs.readFile(path.join(fixtureRoot, migrated[0].data.storedFilename)), assets[1].data);
  } finally {
    restore();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
