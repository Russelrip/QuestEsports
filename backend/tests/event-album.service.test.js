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
      "/api/event-albums/quest-finals-2026/photos/photo-1/image?v=stored.jpg",
    );
  } finally {
    restore();
  }
});

test("public event album detail can return a bounded photo page", async () => {
  let findOptions;
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const prisma = {
    eventAlbum: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          id: "album-1",
          slug: "quest-finals-2026",
          title: "Quest Finals 2026",
          isPublished: true,
          allowDownloads: true,
          createdAt,
          updatedAt: createdAt,
          tournament: null,
          _count: { photos: 297 },
          photos: [],
        };
      },
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
    const result = await service.getPublicEventAlbumBySlug("Quest Finals 2026", {
      photoPage: "3",
      photoPageSize: "30",
    });
    assert.equal(findOptions.include.photos.skip, 60);
    assert.equal(findOptions.include.photos.take, 30);
    assert.deepEqual(result.photoPagination, {
      page: 3,
      pageSize: 30,
      total: 297,
      totalPages: 10,
    });
  } finally {
    restore();
  }
});

test("public event album detail keeps legacy full photos when pagination is not requested", async () => {
  let findOptions;
  const prisma = {
    eventAlbum: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          id: "album-1",
          slug: "quest-finals-2026",
          title: "Quest Finals 2026",
          isPublished: true,
          allowDownloads: true,
          _count: { photos: 2 },
          photos: [
            { id: "photo-1", position: 0, imageAsset: { id: "asset-1", createdAt: new Date() } },
            { id: "photo-2", position: 1, imageAsset: { id: "asset-2", createdAt: new Date() } },
          ],
        };
      },
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
    const result = await service.getPublicEventAlbumBySlug("quest-finals-2026");
    assert.equal(findOptions.include.photos.take, undefined);
    assert.equal(result.photos.length, 2);
    assert.equal("photoPagination" in result, false);
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

test("admin album responses use authenticated photo URLs for draft images", async () => {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const album = {
    id: "album-draft",
    slug: "draft-album",
    title: "Draft album",
    isPublished: false,
    allowDownloads: true,
    createdAt,
    updatedAt: createdAt,
    photos: [{
      id: "photo-1",
      caption: null,
      position: 0,
      createdAt,
      imageAsset: {
        id: "asset-1",
        title: "Draft photo",
        category: "photo",
        contentType: "image/jpeg",
        createdAt,
      },
    }],
  };
  const prisma = {
    eventAlbum: { findUnique: async () => album },
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
    const result = await service.getAdminEventAlbumById("album-draft");
    assert.equal(
      result.photos[0].imageAsset.imageUrl,
      "/api/admin/event-albums/album-draft/photos/photo-1/image?v=asset-1",
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

test("public album downloads prefer the preserved original when downloads are allowed", async () => {
  let optimizedReads = 0;
  let originalReads = 0;
  const prisma = {
    albumPhoto: {
      findFirst: async () => ({
        imageAssetId: "asset-1",
        imageAsset: { originalName: "photo.jpg" },
        album: { allowDownloads: true },
      }),
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async () => {
        optimizedReads += 1;
        return { contentType: "image/webp", data: Buffer.from("preview") };
      },
      getImageAssetDownloadById: async () => {
        originalReads += 1;
        return { contentType: "image/jpeg", data: Buffer.from("original") };
      },
    },
  });
  try {
    const photo = await service.getPublicEventAlbumPhoto({
      slug: "Quest Finals",
      photoId: "photo-1",
      preferOriginal: true,
    });
    assert.equal(originalReads, 1);
    assert.equal(optimizedReads, 0);
    assert.equal(photo.contentType, "image/jpeg");
  } finally {
    restore();
  }
});

test("album photo retries skip filenames already stored in the album", async () => {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  let createCalls = 0;
  let findUniqueCalls = 0;
  const album = {
    id: "album-1",
    slug: "album-1",
    title: "Album 1",
    isPublished: false,
    allowDownloads: true,
    createdAt,
    updatedAt: createdAt,
    photos: [{
      id: "photo-1",
      caption: null,
      position: 0,
      createdAt,
      imageAsset: {
        id: "asset-1",
        title: "Photo 1",
        category: "photo",
        contentType: "image/jpeg",
        originalName: "Quest Photo 1.JPG",
        createdAt,
      },
    }],
  };
  const prisma = {
    eventAlbum: {
      findUnique: async () => {
        findUniqueCalls += 1;
        return album;
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => {
        createCalls += 1;
        return [];
      },
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async () => null,
    },
  });
  try {
    const result = await service.uploadEventAlbumPhotos({
      albumId: "album-1",
      body: { title: "Album 1" },
      files: [{ originalname: "quest photo 1.jpg" }],
    });
    assert.equal(createCalls, 0);
    assert.equal(findUniqueCalls, 2);
    assert.equal(result.photoCount, 1);
  } finally {
    restore();
  }
});
