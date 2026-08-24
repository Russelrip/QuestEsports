const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/players/ranking-sync.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const leaderboardPath = path.join(
  __dirname,
  "../src/modules/valorant-leaderboard/service.js",
);
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260825030000_add_player_rankings/migration.sql",
);

const load = ({ accounts = [], pages = null, listLeaderboard = null } = {}) => {
  const upserts = [];
  const prisma = {
    gameAccount: { findMany: async () => accounts },
    playerRanking: {
      upsert: async (args) => { upserts.push(args); return args.create; },
    },
  };
  const leaderboard = {
    listLeaderboard: listLeaderboard
      || (async ({ page }) => pages[page - 1] ?? { entries: [], totalPages: pages.length }),
  };
  const { module, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [leaderboardPath]: leaderboard,
    [loggerPath]: { logger: { warn() {}, error() {}, info() {} } },
  });
  return { service: module, upserts, restore };
};

const entry = (puuid, over = {}) => ({
  puuid,
  currentTier: "Immortal 1",
  elo: 1842,
  rankInTier: 12,
  peakRank: { tier: "Radiant", season: "e9a3" },
  lastPlayed: "2026-08-01T00:00:00.000Z",
  ...over,
});

test("a player is matched by PUUID and given a board position", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-b" }],
    pages: [{ entries: [entry("puuid-a"), entry("puuid-b"), entry("puuid-c")], totalPages: 1 }],
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.matched, 1);
    assert.equal(result.updated, 1);
    // Second on the board.
    assert.equal(upserts[0].create.position, 2);
    assert.equal(upserts[0].create.elo, 1842);
    assert.equal(upserts[0].create.tier, "Immortal 1");
    assert.equal(upserts[0].create.peakTier, "Radiant");
    assert.equal(upserts[0].create.peakSeason, "e9a3");
  } finally {
    restore();
  }
});

test("position is continuous across pages", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-4" }],
    pages: [
      { entries: [entry("puuid-1"), entry("puuid-2")], totalPages: 2 },
      { entries: [entry("puuid-3"), entry("puuid-4")], totalPages: 2 },
    ],
  });
  try {
    await service.syncValorantRankings();
    assert.equal(upserts[0].create.position, 4);
  } finally {
    restore();
  }
});

// The cache exists so a profile survives the upstream being down. A failed sync
// must leave the previous values alone, not blank them.
test("an unavailable leaderboard leaves the cache untouched", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-a" }],
    listLeaderboard: async () => { throw new Error("503 upstream"); },
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.skipped, "leaderboard_unavailable");
    assert.equal(result.updated, 0);
    assert.equal(upserts.length, 0);
  } finally {
    restore();
  }
});

// A rank read from a partial board would be quietly wrong, which is worse than
// showing nothing.
test("a truncated board stores no position", async () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({
    entries: [entry(`puuid-${i}`)],
    totalPages: 30,
  }));
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-3" }],
    pages,
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.truncated, true);
    assert.equal(upserts[0].create.position, null);
    // The rest of the standing is still cached — only the position is unsafe.
    assert.equal(upserts[0].create.elo, 1842);
  } finally {
    restore();
  }
});

test("a player absent from the board is left alone, not zeroed", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "not-on-board" }],
    pages: [{ entries: [entry("puuid-a")], totalPages: 1 }],
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.matched, 0);
    assert.equal(upserts.length, 0);
  } finally {
    restore();
  }
});

test("one failing row does not abandon the rest of the sync", async () => {
  const upserts = [];
  const prisma = {
    gameAccount: {
      findMany: async () => [
        { playerId: "bad", externalId: "puuid-a" },
        { playerId: "good", externalId: "puuid-b" },
      ],
    },
    playerRanking: {
      upsert: async (args) => {
        if (args.create.playerId === "bad") throw new Error("constraint");
        upserts.push(args);
        return args.create;
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [leaderboardPath]: {
      listLeaderboard: async () => ({
        entries: [entry("puuid-a"), entry("puuid-b")],
        totalPages: 1,
      }),
    },
    [loggerPath]: { logger: { warn() {}, error() {}, info() {} } },
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.matched, 2);
    assert.equal(result.updated, 1);
    assert.equal(upserts[0].create.playerId, "good");
  } finally {
    restore();
  }
});

test("no accounts means no upstream call at all", async () => {
  let called = false;
  const { service, restore } = load({
    accounts: [],
    listLeaderboard: async () => { called = true; return { entries: [], totalPages: 1 }; },
  });
  try {
    const result = await service.syncValorantRankings();
    assert.equal(result.skipped, "no_accounts");
    assert.equal(called, false);
  } finally {
    restore();
  }
});

test("only active accounts for this title are considered", async () => {
  let where;
  const prisma = {
    gameAccount: { findMany: async (args) => { where = args.where; return []; } },
    playerRanking: { upsert: async () => {} },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [leaderboardPath]: { listLeaderboard: async () => ({ entries: [], totalPages: 1 }) },
    [loggerPath]: { logger: { warn() {}, error() {}, info() {} } },
  });
  try {
    await service.syncValorantRankings();
    assert.deepEqual(where, { game: "valorant", status: "active" });
  } finally {
    restore();
  }
});

test("a peak rank returned as a bare string still reads", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-a" }],
    pages: [{ entries: [entry("puuid-a", { peakRank: "Radiant", peakSeason: "e8a2" })], totalPages: 1 }],
  });
  try {
    await service.syncValorantRankings();
    assert.equal(upserts[0].create.peakTier, "Radiant");
    assert.equal(upserts[0].create.peakSeason, "e8a2");
  } finally {
    restore();
  }
});

test("missing numeric fields become null rather than NaN", async () => {
  const { service, upserts, restore } = load({
    accounts: [{ playerId: "p1", externalId: "puuid-a" }],
    pages: [{
      entries: [entry("puuid-a", { elo: null, rankInTier: undefined, lastPlayed: null, peakRank: null })],
      totalPages: 1,
    }],
  });
  try {
    await service.syncValorantRankings();
    const created = upserts[0].create;
    assert.equal(created.elo, null);
    assert.equal(created.rankInTier, null);
    assert.equal(created.lastPlayedAt, null);
  } finally {
    restore();
  }
});

test("migration keeps the cache a cache and hardens it", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  // One cached standing per player per title.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "player_rankings_player_id_game_key"/);
  // A leaderboard position is 1-based; "Rank #0" must be impossible.
  assert.match(sql, /player_rankings_position_positive_check/);
  assert.match(sql, /"position" IS NULL OR "position" >= 1/);
  // Keyed on the player, never the PUUID.
  assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ""), /external_id|puuid/i);
  assert.match(sql, /ALTER TABLE public\."player_rankings" ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /DROP\s+(COLUMN|TABLE)/i);
});
