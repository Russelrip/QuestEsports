const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260823120000_add_players_and_game_accounts/migration.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
// The "does not touch X" assertions have to read executable SQL only: the
// migration's own header comment legitimately names the legacy columns it is
// promising to leave alone.
const statements = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("player identity migration is additive and touches no legacy identity column", () => {
  for (const table of ["players", "game_accounts"]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\."${table}" FROM PUBLIC`));
  }

  assert.doesNotMatch(statements, /DROP TABLE|DROP COLUMN|TRUNCATE|DROP CONSTRAINT/i);

  // The legacy free-text identity columns keep their values and their meaning.
  // Roster linking and backfill are separate, later, reviewed changes.
  assert.doesNotMatch(statements, /saved_team_members/);
  assert.doesNotMatch(statements, /registration_members/);
  assert.doesNotMatch(statements, /team_registrations/);
  assert.doesNotMatch(statements, /captain_riot_id/);
  assert.doesNotMatch(statements, /riot_id/);

  // No backfill in the migration.
  assert.doesNotMatch(statements, /^\s*(INSERT|UPDATE)\s+/im);
});

test("player identity migration revokes the Supabase Data API roles", () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
  // The public reference is sequence-backed, so the sequence needs the same
  // posture as the tables or the Data API roles could read ahead of it.
  assert.match(sql, /REVOKE ALL PRIVILEGES ON SEQUENCE public\."player_public_id_seq" FROM PUBLIC/);
});

test("game accounts enforce identity integrity in the database, not in app code", () => {
  // One Quest player per real game account.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "game_accounts_game_external_id_key"\s*\nON "game_accounts"\("game", "external_id"\)/,
  );
  // One ACTIVE account per player per game; replaced rows survive for history.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "game_accounts_active_player_game_idx"[\s\S]*?WHERE status = 'active'/,
  );
  // Uniqueness on a de-normalized key is only cosmetic, so normalization is a
  // constraint rather than a convention.
  assert.match(sql, /CHECK \("external_id" = lower\(btrim\("external_id"\)\) AND length\("external_id"\) > 0\)/);
  // A player row must survive losing its Quest account; a game account must not
  // outlive its player.
  assert.match(sql, /"players_user_id_fkey"[\s\S]*?ON DELETE SET NULL/);
  assert.match(sql, /"game_accounts_player_id_fkey"[\s\S]*?ON DELETE CASCADE/);
});

test("verification states never claim ownership Quest cannot prove", () => {
  // There is no Riot Sign-On available to Quest: the VALORANT upstream resolves
  // accounts through HenrikDev, which proves an account exists but never proves
  // the signed-in user holds it. A state named for ownership would be a lie in
  // the schema itself.
  // Assert on the declared values, not the file text — the schema comment
  // explaining the absence legitimately names the state.
  assert.doesNotMatch(sql, /CREATE TYPE "GameAccountVerificationStatus"[\s\S]*?ownership_verified/i);

  const enumBlock = /enum GameAccountVerificationStatus \{([\s\S]*?)\}/.exec(schema);
  assert.ok(enumBlock, "GameAccountVerificationStatus must exist");
  const states = enumBlock[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
  assert.ok(!states.includes("ownership_verified"));
  assert.deepEqual(states, [
    "resolved",
    "user_confirmed",
    "discord_corroborated",
    "admin_verified",
    "legacy_unverified",
    "revoked",
  ]);
});

test("schema keeps verification strength separate from lifecycle", () => {
  // An admin-verified account can still be locked by a live tournament, and a
  // replaced account keeps its verification history. Collapsing these into one
  // column loses that.
  // Whitespace is owned by `prisma format`, so match on the declaration only.
  assert.match(schema, /verificationStatus\s+GameAccountVerificationStatus/);
  assert.match(schema, /\bstatus\s+GameAccountStatus/);
  assert.match(schema, /enum GameAccountStatus \{[\s\S]*?locked[\s\S]*?replaced[\s\S]*?\}/);
});
