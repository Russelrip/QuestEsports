const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  extractSupabaseProjectRef,
  assertSafeDatabasePair,
} = require("../scripts/copy-public-data-to-staging");

const markerMigrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260810120000_add_deployment_environment_marker/migration.sql",
);

const clientWithMarker = (environment, projectRef) => ({
  $queryRaw: async () => [{ environment, projectRef, databaseName: "postgres" }],
});

test("Supabase project references are resolved from direct and pooler URLs", () => {
  assert.equal(
    extractSupabaseProjectRef(new URL("postgresql://postgres@db.prodref.supabase.co/postgres")),
    "prodref",
  );
  assert.equal(
    extractSupabaseProjectRef(new URL("postgresql://postgres.stage123@aws-0-ap-south-1.pooler.supabase.com/postgres")),
    "stage123",
  );
});

test("staging copy rejects the same marked project through different endpoints", async () => {
  await assert.rejects(
    assertSafeDatabasePair({
      production: clientWithMarker("production", "sameproject"),
      staging: clientWithMarker("staging", "sameproject"),
      parsedProductionUrl: new URL("postgresql://postgres.sameproject@pooler.example.com/postgres"),
      parsedStagingUrl: new URL("postgresql://other@db.sameproject.supabase.co/postgres"),
    }),
    /same project/,
  );
});

test("staging copy requires explicit production and staging database markers", async () => {
  await assert.rejects(
    assertSafeDatabasePair({
      production: clientWithMarker("development", "prodref"),
      staging: clientWithMarker("staging", "stageref"),
      parsedProductionUrl: new URL("postgresql://postgres@db.prodref.supabase.co/postgres"),
      parsedStagingUrl: new URL("postgresql://postgres@db.stageref.supabase.co/postgres"),
    }),
    /Source marker must be production/,
  );
});

test("staging copy requires project references in both database markers", async () => {
  await assert.rejects(
    assertSafeDatabasePair({
      production: clientWithMarker("production", null),
      staging: clientWithMarker("staging", "stageref"),
      parsedProductionUrl: new URL("postgresql://postgres@db.prodref.supabase.co/postgres"),
      parsedStagingUrl: new URL("postgresql://postgres@db.stageref.supabase.co/postgres"),
    }),
    /must define project_ref/,
  );
});

test("deployment marker is hidden from every unused Supabase Data API role", () => {
  const migration = fs.readFileSync(markerMigrationPath, "utf8");
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(migration, new RegExp(`'${role}'`));
  }
  assert.match(migration, /REVOKE ALL PRIVILEGES/);
});
