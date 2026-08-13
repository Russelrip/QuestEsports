const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { prisma } = require("../src/lib/prisma");
const { posterImageDirectory } = require("../src/middleware/upload");

const apply = process.argv.includes("--apply");
const MAX_DIMENSION = 2560;
const MAX_WEB_READY_BYTES = 750 * 1024;
const SAFE_IMAGE_NAME = /^[a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp)$/i;

const collectAlbumAssets = () =>
  prisma.imageAsset.findMany({
    where: { albumPhotos: { some: {} } },
    select: {
      id: true,
      storedFilename: true,
    },
  });

const repairMissingAsset = async (assetId) => {
  await prisma.albumPhoto.deleteMany({ where: { imageAssetId: assetId } });
};

const optimizeAsset = async (asset) => {
  const sourceName = asset.storedFilename;
  if (!sourceName || !SAFE_IMAGE_NAME.test(sourceName)) {
    return { status: "skipped", reason: "missing or unsafe filename" };
  }

  const sourcePath = path.join(posterImageDirectory, sourceName);
  let stats;
  let metadata;
  try {
    [stats, metadata] = await Promise.all([
      fs.stat(sourcePath),
      sharp(sourcePath).metadata(),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (apply) {
        await repairMissingAsset(asset.id);
        return { status: "repaired", reason: "removed missing album photo" };
      }
      return { status: "repair-candidate", reason: "missing album photo file" };
    }
    throw error;
  }

  const alreadyWebReady =
    metadata.format === "webp" &&
    stats.size <= MAX_WEB_READY_BYTES &&
    (metadata.width || 0) <= MAX_DIMENSION &&
    (metadata.height || 0) <= MAX_DIMENSION;
  if (alreadyWebReady) {
    return { status: "skipped", reason: "already optimized" };
  }

  if (!apply) {
    return { status: "candidate", bytesBefore: stats.size };
  }

  const targetName = `${Date.now()}-${crypto.randomUUID()}.webp`;
  const targetPath = path.join(posterImageDirectory, targetName);
  const temporaryPath = `${targetPath}.tmp`;
  let databaseUpdated = false;

  try {
    await sharp(sourcePath)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 5 })
      .toFile(temporaryPath);
    await fs.rename(temporaryPath, targetPath);
    const optimizedStats = await fs.stat(targetPath);

    await prisma.imageAsset.update({
      where: { id: asset.id },
      data: {
        storedFilename: targetName,
        contentType: "image/webp",
        byteSize: optimizedStats.size,
        data: null,
      },
    });
    databaseUpdated = true;
    const remainingReferences = await prisma.imageAsset.count({
      where: { storedFilename: sourceName },
    });
    if (remainingReferences === 0) {
      await fs.unlink(sourcePath);
    }

    return {
      status: "optimized",
      bytesBefore: stats.size,
      bytesAfter: optimizedStats.size,
    };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (!databaseUpdated) {
      await fs.rm(targetPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
};

async function main() {
  const assets = await collectAlbumAssets();
  const summary = {
    referenced: assets.length,
    candidates: 0,
    optimized: 0,
    repairCandidates: 0,
    repaired: 0,
    skipped: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  for (const asset of assets) {
    const result = await optimizeAsset(asset);
    if (result.status === "candidate") summary.candidates += 1;
    else if (result.status === "optimized") summary.optimized += 1;
    else if (result.status === "repair-candidate") summary.repairCandidates += 1;
    else if (result.status === "repaired") summary.repaired += 1;
    else summary.skipped += 1;
    summary.bytesBefore += result.bytesBefore || 0;
    summary.bytesAfter += result.bytesAfter || 0;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }, null, 2));
  if (!apply && (summary.candidates > 0 || summary.repairCandidates > 0)) {
    console.log("Run with --apply to optimize the listed production album photos and update their database records.");
  }
}

main()
  .catch((error) => {
    console.error("Event album photo optimization failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
