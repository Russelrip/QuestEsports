const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260818150000_seed_valorant_premier_veto_preset/migration.sql"), "utf8");

test("Premier preset migration seeds an additive built-in Valorant preset", () => {
  assert.match(sql, /INSERT INTO "veto_rule_presets"/);
  assert.match(sql, /00000000-0000-4000-8000-000000000304/);
  assert.match(sql, /'valorant'/);
  assert.match(sql, /'premier'/);
  assert.match(sql, /\{"kind":"decider","actor":null,"seriesIndex":1\}/);
  assert.match(sql, /ON CONFLICT \("id"\) DO NOTHING/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
