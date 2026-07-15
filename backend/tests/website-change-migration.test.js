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
