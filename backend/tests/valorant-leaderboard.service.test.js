const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const loadService = (clientMock, prismaMock = { oAuthAccount: { findFirst: async () => null } }) =>
  loadModuleWithMocks(servicePath, { [clientPath]: clientMock, [prismaPath]: { prisma: prismaMock } });

test("listLeaderboard maps the paginated upstream payload to camelCase", async () => {
  const clientMock = {
    getLeaderboard: async () => ({
      entries: [
        { puuid: "p-1", name: "Sahan", tag: "QST", discord_username: "sahan", current_tier: "Diamond 2", elo: 1520, rank_in_tier: 40, peak_rank: "Ascendant 1", peak_season: "e10a1", last_played_match: "2026-08-10T00:00:00Z" },
      ],
      total: 1, page: 1, per_page: 50, total_pages: 1,
    }),
    searchLeaderboard: async () => null,
  };
  const { module: service } = loadService(clientMock);
  const result = await service.listLeaderboard({ page: 1, perPage: 50 });
  assert.deepEqual(result.entries[0], {
    puuid: "p-1", name: "Sahan", tag: "QST", currentTier: "Diamond 2",
    elo: 1520, rankInTier: 40, peakRank: "Ascendant 1", peakSeason: "e10a1", lastPlayed: "2026-08-10T00:00:00Z",
  });
  assert.equal(result.perPage, 50);
  assert.equal(result.totalPages, 1);
});

test("searchLeaderboardPlayer maps a found entry", async () => {
  const clientMock = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => ({ puuid: "p-2", name: "Russel", tag: "QST", discord_username: "russel", current_tier: "Platinum 3", elo: 900, rank_in_tier: 10, peak_rank: "Diamond 1", peak_season: "e9a3", last_played_match: null }),
  };
  const { module: service } = loadService(clientMock);
  const result = await service.searchLeaderboardPlayer("russel");
  assert.equal(result.discordUsername, undefined);
  assert.equal(result.peakRank, "Diamond 1");
  assert.equal(result.lastPlayed, null);
});

test("searchLeaderboardPlayer returns null when upstream has no match", async () => {
  const clientMock = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => null,
  };
  const { module: service } = loadService(clientMock);
  assert.equal(await service.searchLeaderboardPlayer("nobody"), null);
});

// --- searchLeaderboardPlayers (ranked partial search) ----------------------

const snapshotClient = (entries, { onSearch } = {}) => ({
  getLeaderboard: async ({ page, perPage }) => ({
    entries: entries.slice((page - 1) * perPage, page * perPage),
    total: entries.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(entries.length / perPage)),
  }),
  searchLeaderboard: onSearch || (async () => null),
});

const player = (name, tag, discord) => ({
  puuid: `p-${discord}`, name, tag, discord_username: discord,
  current_tier: "Diamond 2", elo: 1500, rank_in_tier: 40,
  peak_rank: null, peak_season: null, last_played_match: null,
});

test("searchLeaderboardPlayers matches a partial Riot name and keeps the real rank", async () => {
  const { module: service } = loadService(snapshotClient([
    player("Alpha", "QST", "alpha"),
    player("SahanX", "QST", "private-handle"),
    player("Charlie", "QST", "charlie"),
  ]));
  const results = await service.searchLeaderboardPlayers("sahan");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "SahanX");
  assert.equal(results[0].discordUsername, undefined);
  assert.equal(results[0].rank, 2);
});

test("searchLeaderboardPlayers matches Riot name, tag, and full name#tag", async () => {
  const client = snapshotClient([
    player("Russel", "QST", "russel"),
    player("Sahan", "LKA", "sahan"),
  ]);
  const { module: service } = loadService(client);
  assert.deepEqual((await service.searchLeaderboardPlayers("russ")).map((e) => e.name), ["Russel"]);
  assert.deepEqual((await service.searchLeaderboardPlayers("lka")).map((e) => e.name), ["Sahan"]);
  assert.deepEqual((await service.searchLeaderboardPlayers("Russel#QST")).map((e) => e.name), ["Russel"]);
});

test("searchLeaderboardPlayers is case-insensitive", async () => {
  const { module: service } = loadService(snapshotClient([player("Sahan", "QST", "Sahan_G")]));
  const results = await service.searchLeaderboardPlayers("SAHAN");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Sahan");
});

test("searchLeaderboardPlayers ranks exact over prefix over substring", async () => {
  const { module: service } = loadService(snapshotClient([
    player("xxnovaxx", "AAA", "private-a"),
    player("novaking", "BBB", "private-b"),
    player("nova", "CCC", "private-c"),
  ]));
  const results = await service.searchLeaderboardPlayers("nova");
  assert.deepEqual(results.map((e) => e.name), ["nova", "novaking", "xxnovaxx"]);
});

test("searchLeaderboardPlayers ignores queries shorter than two characters", async () => {
  let called = false;
  const client = snapshotClient([player("Sahan", "QST", "sahan")]);
  const wrapped = { ...client, getLeaderboard: async (args) => { called = true; return client.getLeaderboard(args); } };
  const { module: service } = loadService(wrapped);
  assert.deepEqual(await service.searchLeaderboardPlayers("s"), []);
  assert.equal(called, false);
});

test("searchLeaderboardPlayers pages the whole leaderboard for the snapshot", async () => {
  const roster = Array.from({ length: 450 }, (_, index) => player(`P${index}`, "QST", `player${index}`));
  const { module: service } = loadService(snapshotClient(roster));
  const results = await service.searchLeaderboardPlayers("P420");
  assert.equal(results.length, 1);
  assert.equal(results[0].rank, 421);
});

test("searchLeaderboardPlayers trusts a miss against a complete snapshot without calling upstream", async () => {
  let searched = false;
  const { module: service } = loadService(snapshotClient([player("Alpha", "QST", "alpha")], {
    onSearch: async () => { searched = true; return player("Ghost", "QST", "ghost"); },
  }));
  assert.deepEqual(await service.searchLeaderboardPlayers("ghost"), []);
  assert.equal(searched, false);
});

test("searchLeaderboardPlayers falls back to the exact lookup when the snapshot is truncated", async () => {
  // 5001 players is one past the 25 x 200 snapshot ceiling, so the snapshot
  // cannot rule the query out on its own.
  const roster = Array.from({ length: 5001 }, (_, index) => player(`P${index}`, "QST", `player${index}`));
  let searched;
  const { module: service } = loadService(snapshotClient(roster, {
    onSearch: async (query) => { searched = query; return player("Ghost", "QST", "ghost"); },
  }));
  const results = await service.searchLeaderboardPlayers("ghost");
  assert.equal(searched, "ghost");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Ghost");
  assert.equal(results[0].rank, null);
});

test("searchLeaderboardPlayers falls back to the exact lookup when the snapshot fails", async () => {
  const { module: service } = loadService({
    getLeaderboard: async () => { throw new Error("upstream down"); },
    searchLeaderboard: async () => player("Sahan", "QST", "sahan"),
  });
  const results = await service.searchLeaderboardPlayers("sahan");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Sahan");
});

test("searchLeaderboardPlayers returns an empty list when nothing matches anywhere", async () => {
  const roster = Array.from({ length: 5001 }, (_, index) => player(`P${index}`, "QST", `player${index}`));
  const { module: service } = loadService(snapshotClient(roster));
  assert.deepEqual(await service.searchLeaderboardPlayers("nobody"), []);
});

test("searchLeaderboardPlayers caps the result list at the requested limit", async () => {
  const roster = Array.from({ length: 40 }, (_, index) => player(`nova${index}`, "QST", `private${index}`));
  const { module: service } = loadService(snapshotClient(roster));
  assert.equal((await service.searchLeaderboardPlayers("nova", { limit: 5 })).length, 5);
});

test("registration derives the canonical Discord identity from the authenticated user's linked account", async () => {
  let seenInput;
  const client = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => null,
    submitRegistration: async (input) => {
      seenInput = input;
      return { success: true };
    },
  };
  const { module: service } = loadService(client, {
    oAuthAccount: {
      findFirst: async (args) => {
        assert.deepEqual(args.where, { userId: "user-1", provider: "discord" });
        return {
          providerUserId: "discord-snowflake",
          user: { discordTag: "current-name" },
        };
      },
    },
  });

  await service.submitRegistration({
    userId: "user-1",
    puuid: "p-1",
    discord_id: "forged-id",
    discord_username: "forged-name",
  });

  assert.deepEqual(seenInput, {
    puuid: "p-1",
    discord_id: "discord-snowflake",
    discord_username: "current-name",
  });
});

test("registration rejects an authenticated user without a linked Discord account", async () => {
  const client = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => null,
    submitRegistration: async () => {
      throw new Error("must not call upstream");
    },
  };
  const { module: service } = loadService(client);

  await assert.rejects(
    service.submitRegistration({ userId: "user-1", puuid: "p-1" }),
    (error) => error.statusCode === 403 && error.code === "DISCORD_LINK_REQUIRED",
  );
});

 test("public search never discloses a Discord-only match, including fallback", async () => {
  const secret = player("PublicRiot", "TAG", "private-discord");
  for (const getLeaderboard of [async () => ({entries: [secret], total_pages: 1}), async () => { throw new Error("unavailable"); }]) {
    const { module: service } = loadService({getLeaderboard, searchLeaderboard: async () => secret});
    assert.deepEqual(await service.searchLeaderboardPlayers("private-discord"), []);
    assert.equal(await service.searchLeaderboardPlayer("private-discord"), null);
  }
});

test("linked users checking another PUUID receive only public Riot fields", async () => {
  const { module: service } = loadService({
    checkPuuid: async () => ({ exists: true, user: {name: "Riot", tag: "TAG", discord_username: "private", discord_id: "private-id"} }),
  }, {oAuthAccount: {findFirst: async () => ({providerUserId: "caller-id", user: {discordTag: "caller"}})}});
  assert.deepEqual(await service.checkPuuid({userId: "caller", puuid: "someone-else"}), {
    exists: true, user: {name: "Riot", tag: "TAG"},
  });
});
