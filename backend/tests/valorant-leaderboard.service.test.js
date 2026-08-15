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
