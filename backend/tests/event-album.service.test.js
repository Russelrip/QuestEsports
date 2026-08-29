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

test("public event album detail bounds the default photo projection", async () => {
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
    assert.equal(findOptions.include.photos.skip, 0);
    assert.equal(findOptions.include.photos.take, 30);
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

test("admin album listing applies search filters and authenticated photo URLs", async () => {
  let countOptions;
  let findManyOptions;
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const album = {
    id: "album-1",
    slug: "quest-finals-2026",
    title: "Quest Finals 2026",
    description: "The finals",
    location: "Colombo",
    eventDate: createdAt,
    isPublished: false,
    allowDownloads: true,
    createdAt,
    updatedAt: createdAt,
    tournament: null,
    _count: { photos: 1 },
    photos: [{
      id: "photo-1",
      caption: "Stage",
      position: 0,
      createdAt,
      imageAsset: { id: "asset-1", storedFilename: null, createdAt },
    }],
  };
  const prisma = {
    eventAlbum: {
      count: async (options) => { countOptions = options; return 1; },
      findMany: async (options) => { findManyOptions = options; return [album]; },
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
    const result = await service.listAdminEventAlbums({ search: " finals ", page: "2", pageSize: "6" });
    assert.deepEqual(countOptions.where, {
      OR: [
        { title: { contains: "finals", mode: "insensitive" } },
        { location: { contains: "finals", mode: "insensitive" } },
        { description: { contains: "finals", mode: "insensitive" } },
      ],
    });
    assert.deepEqual(findManyOptions.where, countOptions.where);
    assert.equal(findManyOptions.skip, 6);
    assert.equal(result.items[0].photos[0].imageAsset.imageUrl, "/api/admin/event-albums/album-1/photos/photo-1/image?v=asset-1");
  } finally {
    restore();
  }
});

test("creating and updating an album normalizes fields and validates its tournament and slug", async () => {
  const calls = [];
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const album = {
    id: "album-1",
    slug: "quest-finals",
    title: "Quest Finals",
    description: "The finals",
    location: "Colombo",
    eventDate: new Date("2026-08-20T00:00:00.000Z"),
    isPublished: true,
    allowDownloads: false,
    createdAt,
    updatedAt: createdAt,
    tournament: null,
    _count: { photos: 0 },
    photos: [],
  };
  const prisma = {
    tournament: { findUnique: async (options) => { calls.push(["tournament", options]); return { id: "tournament-1" }; } },
    eventAlbum: {
      findFirst: async (options) => { calls.push(["findFirst", options]); return null; },
      findUnique: async () => ({ id: "album-1", isPublished: false, allowDownloads: true }),
      create: async (options) => { calls.push(["create", options]); return album; },
      update: async (options) => { calls.push(["update", options]); return album; },
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
    await service.createEventAlbum({
      title: " Quest Finals ",
      description: " The finals ",
      location: " Colombo ",
      eventDate: "2026-08-20",
      tournamentId: " tournament-1 ",
      isPublished: "true",
      allowDownloads: "false",
    });
    const createData = calls.find(([name]) => name === "create")[1].data;
    assert.equal(createData.title, "Quest Finals");
    assert.equal(createData.slug, "quest-finals");
    assert.equal(createData.eventDate.toISOString(), "2026-08-20T00:00:00.000Z");
    assert.equal(createData.isPublished, true);
    assert.equal(createData.allowDownloads, false);

    await service.updateEventAlbum("album-1", { title: " Updated Finals ", allowDownloads: "true" });
    const updateData = calls.find(([name]) => name === "update")[1].data;
    assert.equal(updateData.title, "Updated Finals");
    assert.equal(updateData.slug, "updated-finals");
    assert.equal(updateData.allowDownloads, true);
    assert.ok(calls.filter(([name]) => name === "findFirst").length >= 2);
  } finally {
    restore();
  }
});

test("album photo upload creates new positions for new filenames", async () => {
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const album = {
    id: "album-1",
    slug: "album-1",
    title: "Album 1",
    isPublished: false,
    allowDownloads: true,
    createdAt,
    updatedAt: createdAt,
    photos: [],
    _count: { photos: 2 },
  };
  const createdRows = [];
  const cleanup = [];
  const prisma = {
    eventAlbum: {
      findUnique: async (options) => options.select ? { id: "album-1", photos: [] } : album,
    },
    albumPhoto: {
      aggregate: async () => ({ _max: { position: 4 } }),
      create: (options) => { createdRows.push(options); return Promise.resolve(options); },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [{ id: "asset-1" }, { id: "asset-2" }],
      deleteUnusedImageAsset: async (assetId) => cleanup.push(assetId),
      getImageAssetById: async () => null,
    },
  });
  try {
    await assert.rejects(
      service.uploadEventAlbumPhotos({ albumId: "album-1", body: {}, files: [] }),
      (error) => error.statusCode === 400 && /at least one image/.test(error.message),
    );
    const result = await service.uploadEventAlbumPhotos({
      albumId: "album-1",
      body: { title: " Stage ", description: " Finals " },
      files: [{ originalname: "stage.jpg" }, { originalname: "crowd.jpg" }],
    });
    assert.deepEqual(createdRows.map(({ data }) => data.position), [5, 6]);
    assert.deepEqual(createdRows.map(({ data }) => data.imageAssetId), ["asset-1", "asset-2"]);
    assert.equal(result.id, "album-1");
    assert.deepEqual(cleanup, []);
  } finally {
    restore();
  }
});

test("album photo upload cleans newly created assets when album rows cannot be persisted", async () => {
  const cleaned = [];
  const prisma = {
    eventAlbum: {
      findUnique: async (options) => options.select ? { id: "album-1", photos: [] } : null,
    },
    albumPhoto: {
      aggregate: async () => ({ _max: { position: null } }),
      create: () => Promise.resolve({}),
    },
    $transaction: async () => { throw new Error("album row insert failed"); },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [{ id: "asset-1" }],
      deleteUnusedImageAsset: async (assetId) => cleaned.push(assetId),
      getImageAssetById: async () => null,
    },
  });
  try {
    await assert.rejects(
      service.uploadEventAlbumPhotos({
        albumId: "album-1",
        body: { title: "Stage" },
        files: [{ originalname: "stage.jpg" }],
      }),
      /album row insert failed/,
    );
    assert.deepEqual(cleaned, ["asset-1"]);
  } finally {
    restore();
  }
});

test("deleting an album photo removes its asset and reordering persists every position", async () => {
  const updates = [];
  const deleted = [];
  const cleanup = [];
  const album = { id: "album-1", slug: "album-1", title: "Album 1", photos: [], _count: { photos: 2 } };
  const prisma = {
    eventAlbum: { findUnique: async () => album },
    albumPhoto: {
      findMany: async () => [{ id: "photo-1" }, { id: "photo-2" }],
      findFirst: async () => ({ id: "photo-1", imageAssetId: "asset-1" }),
      update: async (options) => { updates.push(options); return options; },
      delete: async (options) => { deleted.push(options); },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async (assetId) => cleanup.push(assetId),
      getImageAssetById: async () => null,
    },
  });
  try {
    await assert.rejects(
      service.reorderEventAlbumPhotos("album-1", []),
      (error) => error.statusCode === 400 && /complete photo order/.test(error.message),
    );
    const result = await service.reorderEventAlbumPhotos("album-1", ["photo-1", "photo-2"]);
    assert.equal(result.id, "album-1");
    assert.deepEqual(updates.map(({ where, data }) => [where.id, data.position]), [
      ["photo-1", 0],
      ["photo-2", 1],
    ]);
    await service.deleteEventAlbumPhoto("album-1", "photo-1");
    assert.deepEqual(deleted, [{ where: { id: "photo-1" } }]);
    assert.deepEqual(cleanup, ["asset-1"]);
  } finally {
    restore();
  }
});

test("deleting an album removes its photos and tolerates already-cleaned assets", async () => {
  const deleted = [];
  const cleaned = [];
  const prisma = {
    eventAlbum: {
      findUnique: async () => ({ photos: [{ imageAssetId: "asset-1" }, { imageAssetId: "asset-2" }] }),
      delete: async (options) => deleted.push(options),
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async (assetId) => {
        cleaned.push(assetId);
        const error = new Error("already gone");
        error.statusCode = assetId === "asset-1" ? 404 : 409;
        throw error;
      },
      getImageAssetById: async () => null,
    },
  });
  try {
    await service.deleteEventAlbum("album-1");
    assert.deepEqual(deleted, [{ where: { id: "album-1" } }]);
    assert.deepEqual(cleaned, ["asset-1", "asset-2"]);
  } finally {
    restore();
  }
});

test("admin album photo lookup returns the private image asset", async () => {
  const prisma = {
    albumPhoto: {
      findFirst: async (options) => {
        assert.deepEqual(options.where, { id: "photo-1", albumId: "album-1" });
        return { imageAssetId: "asset-1", imageAsset: { originalName: "stage.jpg" } };
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mediaServicePath]: {
      createImageAssets: async () => [],
      deleteUnusedImageAsset: async () => {},
      getImageAssetById: async (assetId) => ({ assetId, contentType: "image/jpeg", data: Buffer.from("stage") }),
    },
  });
  try {
    assert.deepEqual(await service.getAdminEventAlbumPhoto({ albumId: "album-1", photoId: "photo-1" }), {
      assetId: "asset-1",
      contentType: "image/jpeg",
      data: Buffer.from("stage"),
      originalName: "stage.jpg",
    });
  } finally {
    restore();
  }
});
