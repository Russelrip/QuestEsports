const fs = require("node:fs/promises");
const path = require("node:path");
const { prisma } = require("../src/lib/prisma");

const PENDING_MIGRATIONS_EXIT_CODE = 10;

const checkPendingMigrations = async () => {
  const migrationsRoot = path.join(__dirname, "../prisma/migrations");
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const localMigrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrationRows = await prisma.$queryRaw`
    SELECT migration_name AS "migrationName",
           finished_at AS "finishedAt",
           rolled_back_at AS "rolledBackAt"
    FROM public."_prisma_migrations"
  `;
  const incomplete = migrationRows.filter(
    ({ finishedAt, rolledBackAt }) => !finishedAt && !rolledBackAt
  );
  if (incomplete.length) {
    throw new Error(
      `Database has incomplete migrations: ${incomplete
        .map(({ migrationName }) => migrationName)
        .join(", ")}`
    );
  }

  const applied = new Set(
    migrationRows
      .filter(({ finishedAt, rolledBackAt }) => finishedAt && !rolledBackAt)
      .map(({ migrationName }) => migrationName)
  );
  const localMigrationSet = new Set(localMigrations);
  const unknownApplied = [...applied].filter(
    (migration) => !localMigrationSet.has(migration)
  );
  if (unknownApplied.length) {
    throw new Error(
      `Database has applied migrations missing from this release: ${unknownApplied.join(
        ", "
      )}`
    );
  }

  const pending = localMigrations.filter((migration) => !applied.has(migration));

  if (pending.length) {
    console.error(`Pending database migrations: ${pending.join(", ")}`);
    process.exitCode = PENDING_MIGRATIONS_EXIT_CODE;
    return;
  }

  console.log("No pending database migrations.");
};

checkPendingMigrations()
  .catch((error) => {
    console.error("Could not verify pending database migrations.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
