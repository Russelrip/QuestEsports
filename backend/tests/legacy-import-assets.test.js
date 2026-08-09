const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/media/legacy-import.service.js"
);
const source = fs.readFileSync(servicePath, "utf8");
const repositoryRoot = path.join(__dirname, "../..");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");

test("every declared legacy poster source is packaged in the repository", () => {
  const declaredPaths = [...source.matchAll(/filePath:\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );

  assert.ok(declaredPaths.length > 0, "expected legacy poster declarations");
  for (const relativePath of declaredPaths) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, relativePath)),
      true,
      `missing legacy poster source: ${relativePath}`
    );
  }
});

test("legacy poster import uses a stable key and becomes idempotent", async () => {
  const posters = new Map();
  const imageAssets = new Map();
  const advisoryLockCalls = [];
  const tempRoot = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "quest-legacy-import-test-")
  );
  const tx = {
    $executeRaw: async (strings) => advisoryLockCalls.push(strings.join("")),
    imageAsset: {
      create: async ({ data }) => {
        const stored = { ...data, createdAt: new Date(imageAssets.size) };
        imageAssets.set(data.id, stored);
        return stored;
      },
      findMany: async () => [...imageAssets.values()]
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
      delete: async ({ where }) => imageAssets.delete(where.id),
    },
    poster: {
      findMany: async () => [...posters.values()].map((poster) => ({
        ...poster,
        imageAsset: {
          ...imageAssets.get(poster.imageAssetId),
          _count: {
            posters: [...posters.values()].filter(
              (candidate) => candidate.imageAssetId === poster.imageAssetId
            ).length,
            productImages: 0,
          },
        },
      })),
      create: async ({ data }) => {
        assert.ok(data.importKey.startsWith("legacy-poster:"));
        assert.equal(posters.has(data.importKey), false);
        posters.set(data.importKey, data);
        return data;
      },
      update: async ({ where, data }) => {
        const existing = [...posters.values()].find((poster) => poster.id === where.id);
        posters.delete(existing.importKey);
        const updated = { ...existing, ...data };
        posters.set(updated.importKey, updated);
        return updated;
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: { $transaction: async (callback) => callback(tx) },
    },
    [uploadModulePath]: { posterImageDirectory: tempRoot },
  });

  try {
    const first = await service.importLegacyPosters();
    const firstWriteCount = (await fsPromises.readdir(tempRoot)).length;
    const posterToRepair = [...posters.values()][0];
    const assetToRepair = imageAssets.get(posterToRepair.imageAssetId);
    await fsPromises.unlink(path.join(tempRoot, assetToRepair.storedFilename));
    const duplicateAsset = {
      ...assetToRepair,
      id: "00000000-0000-0000-0000-000000000001",
      storedFilename: "duplicate-openwinners.jpg",
      createdAt: new Date(86400000),
    };
    imageAssets.set(duplicateAsset.id, duplicateAsset);
    await fsPromises.writeFile(
      path.join(tempRoot, duplicateAsset.storedFilename),
      "temporary duplicate"
    );
    posterToRepair.imageAssetId = duplicateAsset.id;
    const second = await service.importLegacyPosters();
    const third = await service.importLegacyPosters();

    assert.ok(first.importedCount > 0);
    assert.equal(first.linkedCount, 0);
    assert.equal(first.repairedCount, 0);
    assert.equal(first.deduplicatedCount, 0);
    assert.equal(first.skippedCount, 0);
    assert.equal(firstWriteCount, first.importedCount);
    assert.equal(second.importedCount, 0);
    assert.equal(second.linkedCount, 0);
    assert.equal(second.repairedCount, 1);
    assert.equal(second.deduplicatedCount, 1);
    assert.equal(second.skippedCount, first.importedCount - 1);
    assert.equal(posters.get(posterToRepair.importKey).imageAssetId, assetToRepair.id);
    assert.equal(imageAssets.has(duplicateAsset.id), false);
    assert.equal(third.importedCount, 0);
    assert.equal(third.linkedCount, 0);
    assert.equal(third.repairedCount, 0);
    assert.equal(third.deduplicatedCount, 0);
    assert.equal(third.skippedCount, first.importedCount);
    assert.equal((await fsPromises.readdir(tempRoot)).length, firstWriteCount);
    assert.equal(advisoryLockCalls.length, 3);
    assert.ok(advisoryLockCalls.every((query) => query.includes("pg_advisory_xact_lock")));
  } finally {
    restore();
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});
