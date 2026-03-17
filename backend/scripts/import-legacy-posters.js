#!/usr/bin/env node

const { prisma } = require("../src/lib/prisma");
const { importLegacyPosters } = require("../src/modules/media/legacy-import.service");

const main = async () => {
  const summary = await importLegacyPosters();

  console.log(
    `Legacy poster import complete. Imported: ${summary.importedCount}, skipped: ${summary.skippedCount}`
  );

  summary.results.forEach((result) => {
    console.log(`- ${result.status.toUpperCase()}: ${result.title}`);
  });
};

main()
  .catch((error) => {
    console.error("Legacy poster import failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
