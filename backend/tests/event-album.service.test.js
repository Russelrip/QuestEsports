const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/media/event-album.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const mediaServicePath = path.join(__dirname, "../src/modules/media/media.service.js");

test("public event album listing only requests published albums and maps public photo URLs", async () => {
  let countOptions;
  let findManyOptions;
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const prisma = {
    albumPhoto: { count: async () => 25 },
    eventAlbum: {
      count: async (options) => {
        countOptions = options;
        return 1;
      },
      findMany: async (options) => {
        findManyOptions = options;
        return [{
          id: "album-1",
          slug: "quest-finals-2026",
          title: "Quest Finals 2026",
          description: null,
          location: "Colombo",
          eventDate: createdAt,
          isPublished: true,
          allowDownloads: true,
          createdAt,
          updatedAt: createdAt,
          tournament: null,
          _count: { photos: 25 },
          photos: [{
            id: "photo-1",
            caption: "Grand final stage",
            position: 0,
            createdAt,
            imageAsset: {
              id: "asset-1",
              title: "Final stage",
              description: null,
              category: "photo",
              originalName: "final.jpg",
              storedFilename: "stored.jpg",
              contentType: "image/jpeg",
              byteSize: 100,
              createdAt,
            },
          }],
        }];
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async () => null,
    },
  });
  try {
    const result = await service.listPublicEventAlbums({ page: "1", pageSize: "12" });
    assert.deepEqual(countOptions.where, { isPublished: true });
    assert.deepEqual(findManyOptions.where, { isPublished: true });
    assert.equal(findManyOptions.include.photos.take, 5);
    assert.equal(result.items[0].photoCount, 25);
    assert.equal(result.totalPhotos, 25);
    assert.equal(
      result.items[0].photos[0].imageAsset.imageUrl,
      "/api/event-albums/quest-finals-2026/photos/photo-1/image",
    );
  } finally {
    restore();
  }
});

test("album photo reordering requires every photo exactly once", async () => {
  const prisma = {
    albumPhoto: {
      findMany: async () => [{ id: "photo-1" }, { id: "photo-2" }],
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async () => null,
    },
  });
  try {
    await assert.rejects(
      service.reorderEventAlbumPhotos("album-1", ["photo-1"]),
      (error) => error.statusCode === 400 && /every album photo/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("public album photo lookup is constrained to a published album", async () => {
  let findOptions;
  const prisma = {
    albumPhoto: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          imageAssetId: "asset-1",
          imageAsset: { originalName: "photo.jpg" },
          album: { allowDownloads: false },
        };
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async () => ({ contentType: "image/jpeg", data: Buffer.from("photo") }),
    },
  });
  try {
    const photo = await service.getPublicEventAlbumPhoto({ slug: "Quest Finals", photoId: "photo-1" });
    assert.deepEqual(findOptions.where.album, { slug: "quest-finals", isPublished: true });
    assert.equal(photo.allowDownloads, false);
    assert.equal(photo.originalName, "photo.jpg");
  } finally {
    restore();
  }
});
