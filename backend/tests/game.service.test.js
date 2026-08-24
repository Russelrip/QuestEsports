const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/games/game.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260824210000_add_canonical_game/migration.sql",
);

const loadService = (prisma) => loadModuleWithMocks(servicePath, {
  [prismaModulePath]: { prisma },
});

const stubPrisma = ({ games = [], aliases = [] } = {}) => ({
  game: {
    findUnique: async ({ where }) => games.find((g) => g.slug === where.slug) ?? null,
    findMany: async ({ where }) =>
      games.filter((g) => (where?.isActive === undefined ? true : g.isActive === where.isActive)),
  },
  gameAlias: {
    findUnique: async ({ where }) => aliases.find((a) => a.alias === where.alias) ?? null,
  },
});

test("normalizeGameKey collapses the spellings free-text columns accumulate", () => {
  const { module: service, restore } = loadService(stubPrisma());
  try {
    assert.equal(service.normalizeGameKey("VALORANT"), "valorant");
    assert.equal(service.normalizeGameKey("  valorant  "), "valorant");
    assert.equal(service.normalizeGameKey("PUBG Mobile"), "pubg-mobile");
    assert.equal(service.normalizeGameKey("COD   Mobile"), "cod-mobile");
    assert.equal(service.normalizeGameKey("Call of Duty: Mobile"), "call-of-duty-mobile");
    assert.equal(service.normalizeGameKey("--Valorant--"), "valorant");
    assert.equal(service.normalizeGameKey(""), "");
    assert.equal(service.normalizeGameKey(null), "");
    assert.equal(service.normalizeGameKey(undefined), "");
  } finally {
    restore();
  }
});

test("resolveGameId prefers a canonical slug", async () => {
  const { module: service, restore } = loadService(
    stubPrisma({ games: [{ id: "game-val", slug: "valorant", isActive: true }] }),
  );
  try {
    assert.equal(await service.resolveGameId("VALORANT"), "game-val");
    assert.equal(await service.resolveGameId("  valorant "), "game-val");
  } finally {
    restore();
  }
});

// The case that makes the alias table necessary: "COD Mobile" normalises to
// `cod-mobile`, which is NOT the established public slug `codm`. Without the
// alias it would spawn a second title for a game that already exists.
test("resolveGameId falls back to an alias when the slug does not match", async () => {
  const { module: service, restore } = loadService(
    stubPrisma({
      games: [{ id: "game-codm", slug: "codm", isActive: true }],
      aliases: [
        { alias: "cod-mobile", gameId: "game-codm" },
        { alias: "call-of-duty-mobile", gameId: "game-codm" },
      ],
    }),
  );
  try {
    assert.equal(await service.resolveGameId("COD Mobile"), "game-codm");
    assert.equal(await service.resolveGameId("Call of Duty: Mobile"), "game-codm");
    assert.equal(await service.resolveGameId("codm"), "game-codm");
  } finally {
    restore();
  }
});

test("resolveGameId returns null for an unknown title rather than throwing", async () => {
  const { module: service, restore } = loadService(
    stubPrisma({ games: [{ id: "game-val", slug: "valorant", isActive: true }] }),
  );
  try {
    assert.equal(await service.resolveGameId("Rocket League"), null);
    assert.equal(await service.resolveGameId(""), null);
    assert.equal(await service.resolveGameId(null), null);
  } finally {
    restore();
  }
});

test("listGames hides inactive titles unless asked", async () => {
  const games = [
    { id: "a", slug: "valorant", displayName: "VALORANT", shortName: "VAL", isActive: true },
    { id: "b", slug: "retired", displayName: "Retired", shortName: null, isActive: false },
  ];
  const { module: service, restore } = loadService(stubPrisma({ games }));
  try {
    assert.deepEqual((await service.listGames()).map((g) => g.slug), ["valorant"]);
    assert.deepEqual(
      (await service.listGames({ includeInactive: true })).map((g) => g.slug),
      ["valorant", "retired"],
    );
  } finally {
    restore();
  }
});

// The JS normaliser and the SQL normaliser must stay in step: if they diverge,
// rows the migration mapped would resolve differently at runtime.
test("migration normalises game text the same way the service does", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /regexp_replace\(lower\(btrim\([^)]*\)\), '\[\^a-z0-9\]\+', '-', 'g'\)/);
  assert.match(sql, /btrim\(regexp_replace/);
});

test("migration is expand-only: no column dropped or made NOT NULL", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /SET\s+NOT\s+NULL/i);
  // Every added FK column must be nullable, so no ADD COLUMN carries NOT NULL.
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS "game_id" UUID NOT NULL/i);
});

// scripts/verify-database-security.js fails CI on any public table without RLS.
// A catalog table is exactly the kind that gets quietly exempted and then joined
// to something that does hold personal data.
test("migration hardens both new tables against the Supabase Data API", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const table of ["games", "game_aliases"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\."${table}" FROM PUBLIC`));
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
});

test("migration guards every statement so it can be re-run", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const addColumns = sql.match(/ALTER TABLE "[a-z_]+"\s+ADD COLUMN/g) ?? [];
  assert.ok(addColumns.length >= 8, "expected a game_id column on every game-bearing table");
  for (const statement of addColumns) {
    assert.match(statement, /ADD COLUMN$/);
  }
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, addColumns.length);
  assert.match(sql, /ON CONFLICT \("slug"\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \("alias"\) DO NOTHING/);
});
