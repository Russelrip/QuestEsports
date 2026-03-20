const { migrateImageAssetsToFilesystem } = require("../src/modules/media/media.service");

async function main() {
  const summary = await migrateImageAssetsToFilesystem();
  console.log(
    `Poster image migration complete. Migrated: ${summary.migratedCount}, skipped: ${summary.skippedCount}, remaining DB images: ${summary.remainingDbImages}`
  );
}

main()
  .catch((error) => {
    console.error("Poster image migration failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = require("../src/lib/prisma");
    await prisma.$disconnect();
  });
