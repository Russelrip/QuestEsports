const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../prisma/migrations/20260715120000_add_game_categories_sponsors_metadata/migration.sql"),
  "utf8"
);

test("website change migration preserves compatible tournament defaults and seeded categories", () => {
  assert.match(migration, /CREATE TABLE "game_categories"/);
  assert.match(migration, /CREATE TABLE "tournament_sponsors"/);
  assert.match(migration, /"organizer" TEXT NOT NULL DEFAULT 'Quest E-sports'/);
  assert.match(migration, /"country" TEXT NOT NULL DEFAULT 'Sri Lanka'/);
  assert.match(migration, /"location" TEXT NOT NULL DEFAULT 'TBA'/);
  for (const slug of ["valorant", "pubg-mobile", "mlbb", "codm"]) {
    assert.match(migration, new RegExp(`'${slug}'`));
  }
  assert.match(migration, /ON DELETE SET NULL/);
});

test("admin hold migration backfills and uniquely locks slot pricing", () => {
  const slotMigration = fs.readFileSync(
    path.join(
      __dirname,
      "../prisma/migrations/20260718190000_lock_admin_reservation_slot_and_fee/migration.sql"
    ),
    "utf8"
  );
  assert.match(slotMigration, /ADD COLUMN "assigned_slot_number" INTEGER/);
  assert.match(slotMigration, /ADD COLUMN "quoted_fee_amount" DECIMAL\(12,2\)/);
  assert.match(slotMigration, /generate_series\(1, hold\.max_teams\)/);
  assert.match(slotMigration, /SET NOT NULL/);
  assert.match(
    slotMigration,
    /admin_slot_reservations_tournament_id_assigned_slot_number_key/
  );
});
