const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { prisma } = require("../src/lib/prisma");
const { tournamentBannerDirectory } = require("../src/middleware/upload");

const apply = process.argv.includes("--apply");
const MAX_DIMENSION = 2400;
const MAX_WEB_READY_BYTES = 500 * 1024;
const SAFE_IMAGE_NAME = /^[a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp)$/i;
const TOURNAMENT_IMAGE_FIELDS = [
  "bannerImageName",
  "heroImageName",
  "completedPosterImageName",
  "firstPlaceImageName",
  "secondPlaceImageName",
  "thirdPlaceImageName",
];

const collectReferencedImages = async () => {
  const [tournaments, series] = await Promise.all([
    prisma.tournament.findMany({
      select: Object.fromEntries(TOURNAMENT_IMAGE_FIELDS.map((field) => [field, true])),
    }),
    prisma.eventSeries.findMany({ select: { heroImageName: true } }),
  ]);

  return new Set(
    [
      ...tournaments.flatMap((tournament) =>
        TOURNAMENT_IMAGE_FIELDS.map((field) => tournament[field])
      ),
      ...series.map((item) => item.heroImageName),
    ].filter(Boolean)
  );
};

const optimizeImage = async (sourceName) => {
  if (!SAFE_IMAGE_NAME.test(sourceName)) {
    return { status: "skipped", reason: "unsafe filename" };
  }

  const sourcePath = path.join(tournamentBannerDirectory, sourceName);
  let stats;
  let metadata;
  try {
    [stats, metadata] = await Promise.all([
      fs.stat(sourcePath),
      sharp(sourcePath).metadata(),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "skipped", reason: "missing file" };
    }
    throw error;
  }

  const alreadyWebReady =
    path.extname(sourceName).toLowerCase() === ".webp" &&
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
  const targetPath = path.join(tournamentBannerDirectory, targetName);
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

    await prisma.$transaction([
      ...TOURNAMENT_IMAGE_FIELDS.map((field) =>
        prisma.tournament.updateMany({
          where: { [field]: sourceName },
          data: { [field]: targetName },
        })
      ),
      prisma.eventSeries.updateMany({
        where: { heroImageName: sourceName },
        data: { heroImageName: targetName },
      }),
    ]);
    databaseUpdated = true;
    await fs.unlink(sourcePath);

    const optimizedStats = await fs.stat(targetPath);
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
  const referencedImages = await collectReferencedImages();
  const summary = {
    referenced: referencedImages.size,
    candidates: 0,
    optimized: 0,
    skipped: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  for (const sourceName of referencedImages) {
    const result = await optimizeImage(sourceName);
    if (result.status === "candidate") summary.candidates += 1;
    else if (result.status === "optimized") summary.optimized += 1;
    else summary.skipped += 1;
    summary.bytesBefore += result.bytesBefore || 0;
    summary.bytesAfter += result.bytesAfter || 0;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }, null, 2));
  if (!apply && summary.candidates > 0) {
    console.log("Run with --apply to optimize the listed production assets and update their database references.");
  }
}

main()
  .catch((error) => {
    console.error("Tournament banner optimization failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
