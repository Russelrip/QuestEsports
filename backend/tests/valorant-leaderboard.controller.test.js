const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");
const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");

const makeRes = () => {
  const calls = { status: 200, json: undefined };
  const res = {
    statusCode: 200,
    status(code) { calls.status = code; return res; },
    json(body) { calls.json = body; return res; },
  };
  return { res, calls };
};

const loadController = (serviceMock) => loadModuleWithMocks(controllerPath, { [servicePath]: serviceMock });

test("getLeaderboard wraps the mapped page in the Quest envelope", async () => {
  const serviceMock = {
    listLeaderboard: async ({ page, perPage }) => ({ entries: [], total: 0, page, perPage, totalPages: 1 }),
    searchLeaderboardPlayers: async () => [],
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.getLeaderboard({ query: { page: "2", per_page: "25" } }, res);
  assert.equal(calls.status, 200);
  assert.equal(calls.json.success, true);
  assert.equal(calls.json.data.page, 2);
  assert.equal(calls.json.data.perPage, 25);
});

test("getLeaderboard clamps per_page to the upstream max of 200", async () => {
  let seenPerPage;
  const serviceMock = {
    listLeaderboard: async ({ perPage }) => { seenPerPage = perPage; return { entries: [], total: 0, page: 1, perPage, totalPages: 1 }; },
    searchLeaderboardPlayers: async () => [],
  };
  const { module: controller } = loadController(serviceMock);
  const { res } = makeRes();
  await controller.getLeaderboard({ query: { page: "1", per_page: "9999" } }, res);
  assert.equal(seenPerPage, 200);
});

test("searchLeaderboard returns { entry: null } for a blank query", async () => {
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async (q) => (q === "sahan" ? [{ puuid: "p-1", name: "Sahan" }] : []),
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.searchLeaderboard({ query: {} }, res);
  assert.equal(calls.json.data.entry, null);
});

test("searchLeaderboard returns the ranked entries plus the legacy entry field", async () => {
  let seen;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async (query, options) => {
      seen = { query, options };
      return [{ puuid: "p-1", name: "Sahan", rank: 3 }, { puuid: "p-2", name: "Sahani", rank: 9 }];
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.searchLeaderboard({ query: { q: "  sahan  " } }, res);
  assert.equal(seen.query, "sahan");
  assert.equal(seen.options.limit, 25);
  assert.equal(calls.json.data.entries.length, 2);
  assert.equal(calls.json.data.entry.puuid, "p-1");
});

test("searchLeaderboard clamps the result limit", async () => {
  let seenLimit;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async (_query, { limit }) => { seenLimit = limit; return []; },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.searchLeaderboard({ query: { q: "sahan", limit: "9999" } }, res);
  assert.equal(seenLimit, 50);
  assert.deepEqual(calls.json.data.entries, []);
  assert.equal(calls.json.data.entry, null);
});

const noopServices = {
  checkPuuid: async () => null,
  previewRegistration: async () => null,
  submitRegistration: async () => null,
};

test("checkPuuid passes only the PUUID and authenticated user to the service", async () => {
  let seenInput;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async () => [],
    ...noopServices,
    checkPuuid: async (input) => {
      seenInput = input;
      return { exists: true, user: { name: "Sahan", tag: "QST", discord_username: "sahan" } };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.checkPuuid({ user: { id: "user-1" }, body: { puuid: "p-1" } }, res);
  assert.deepEqual(seenInput, { userId: "user-1", puuid: "p-1" });
  assert.equal(calls.json.data.user.name, "Sahan");
});

test("previewRegistration accepts only a PUUID and authenticated user", async () => {
  let seenInput;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async () => [],
    ...noopServices,
    previewRegistration: async (input) => {
      seenInput = input;
      return {
        puuid: input.puuid,
        name: "Sahan",
        tag: "QST",
        current_rank: "Radiant",
        elo: 2000,
        peak_rank: "Radiant",
        peak_season: "e10a1",
        last_played: "2026-08-15T00:00:00Z",
      };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.previewRegistration({ user: { id: "user-1" }, body: { puuid: "p-1", discord_id: "forged" } }, res);
  assert.deepEqual(seenInput, { userId: "user-1", puuid: "p-1" });
  assert.equal(calls.json.data.current_rank, "Radiant");
  assert.equal(calls.json.data.peak_season, "e10a1");
  assert.equal(calls.json.data.last_played, "2026-08-15T00:00:00Z");
});

test("submitRegistration ignores forged Discord identity fields", async () => {
  let seenInput;
  const body = { discord_id: "123", discord_username: "sahan", puuid: "p-1" };
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayers: async () => [],
    ...noopServices,
    submitRegistration: async (input) => {
      seenInput = input;
      return { success: true, message: "Registered", player: { puuid: "p-1" } };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.submitRegistration({ user: { id: "user-1" }, body }, res);
  assert.deepEqual(seenInput, { userId: "user-1", puuid: "p-1" });
  assert.equal(calls.json.data.success, true);
  assert.equal(calls.json.data.player.puuid, "p-1");
});
