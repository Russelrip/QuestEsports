const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");

const loadService = (clientMock) => loadModuleWithMocks(servicePath, { [clientPath]: clientMock });

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
    puuid: "p-1", name: "Sahan", tag: "QST", discordUsername: "sahan", currentTier: "Diamond 2",
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
  assert.equal(result.discordUsername, "russel");
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

test("searchLeaderboardPlayers matches a partial Discord username and keeps the real rank", async () => {
  const { module: service } = loadService(snapshotClient([
    player("Alpha", "QST", "alpha"),
    player("Bravo", "QST", "sahanx"),
    player("Charlie", "QST", "charlie"),
  ]));
  const results = await service.searchLeaderboardPlayers("sahan");
  assert.equal(results.length, 1);
  assert.equal(results[0].discordUsername, "sahanx");
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

test("searchLeaderboardPlayers is case-insensitive and tolerates a leading @", async () => {
  const { module: service } = loadService(snapshotClient([player("Sahan", "QST", "Sahan_G")]));
  const results = await service.searchLeaderboardPlayers("@SAHAN_g");
  assert.equal(results.length, 1);
  assert.equal(results[0].discordUsername, "Sahan_G");
});

test("searchLeaderboardPlayers ranks exact over prefix over substring", async () => {
  const { module: service } = loadService(snapshotClient([
    player("A", "AAA", "xxnovaxx"),
    player("B", "BBB", "novaking"),
    player("C", "CCC", "nova"),
  ]));
  const results = await service.searchLeaderboardPlayers("nova");
  assert.deepEqual(results.map((e) => e.discordUsername), ["nova", "novaking", "xxnovaxx"]);
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
  const results = await service.searchLeaderboardPlayers("player420");
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
  assert.equal(results[0].discordUsername, "ghost");
  assert.equal(results[0].rank, null);
});

test("searchLeaderboardPlayers falls back to the exact lookup when the snapshot fails", async () => {
  const { module: service } = loadService({
    getLeaderboard: async () => { throw new Error("upstream down"); },
    searchLeaderboard: async () => player("Sahan", "QST", "sahan"),
  });
  const results = await service.searchLeaderboardPlayers("sahan");
  assert.equal(results.length, 1);
  assert.equal(results[0].discordUsername, "sahan");
});

test("searchLeaderboardPlayers returns an empty list when nothing matches anywhere", async () => {
  const roster = Array.from({ length: 5001 }, (_, index) => player(`P${index}`, "QST", `player${index}`));
  const { module: service } = loadService(snapshotClient(roster));
  assert.deepEqual(await service.searchLeaderboardPlayers("nobody"), []);
});

test("searchLeaderboardPlayers caps the result list at the requested limit", async () => {
  const roster = Array.from({ length: 40 }, (_, index) => player(`P${index}`, "QST", `nova${index}`));
  const { module: service } = loadService(snapshotClient(roster));
  assert.equal((await service.searchLeaderboardPlayers("nova", { limit: 5 })).length, 5);
});
