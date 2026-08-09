const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const cleanupModulePath = path.join(__dirname, "../src/lib/upload-cleanup.js");

test("media library listing returns file size and reference counts without loading image bytes", async () => {
  const servicePath = path.join(__dirname, "../src/modules/media/media.service.js");
  let findManyOptions;
  const asset = {
    id: "image-1",
    title: "Finals artwork",
    description: "Grand final graphic",
    category: "graphic",
    originalName: "finals.webp",
    storedFilename: "stored-finals.webp",
    contentType: "image/webp",
    byteSize: 2048,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    _count: { posters: 1, productImages: 2 },
  };
  const prisma = {
    imageAsset: {
      count: async () => 1,
      findMany: async (options) => {
        findManyOptions = options;
        return [asset];
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: mediaService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: { posterImageDirectory: "uploads/poster-images" },
    [cleanupModulePath]: { removeUploadsQuietly: async () => true },
  });

  try {
    const result = await mediaService.listImageAssets({
      page: "1",
      pageSize: "24",
      category: "graphic",
      search: "finals",
    });

    assert.equal(findManyOptions.select.data, undefined);
    assert.deepEqual(findManyOptions.select._count, {
      select: { posters: true, productImages: true },
    });
    assert.deepEqual(result.pagination, {
      page: 1,
      pageSize: 24,
      total: 1,
      totalPages: 1,
    });
    assert.deepEqual(result.items[0], {
      id: "image-1",
      title: "Finals artwork",
      description: "Grand final graphic",
      category: "graphic",
      originalName: "finals.webp",
      contentType: "image/webp",
      byteSize: 2048,
      createdAt: asset.createdAt,
      imageUrl: "/api/uploads/poster-images/stored-finals.webp",
      usage: { posters: 1, products: 2 },
      canDelete: false,
    });
  } finally {
    restore();
  }
});
