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
    searchLeaderboardPlayer: async () => null,
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
    searchLeaderboardPlayer: async () => null,
  };
  const { module: controller } = loadController(serviceMock);
  const { res } = makeRes();
  await controller.getLeaderboard({ query: { page: "1", per_page: "9999" } }, res);
  assert.equal(seenPerPage, 200);
});

test("searchLeaderboard returns { entry: null } for a blank query", async () => {
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async (q) => (q === "sahan" ? { puuid: "p-1", name: "Sahan" } : null),
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.searchLeaderboard({ query: {} }, res);
  assert.equal(calls.json.data.entry, null);
});

const noopServices = {
  getDiscordLogin: async () => null,
  getDiscordCallback: async () => null,
  checkPuuid: async () => null,
  previewRegistration: async () => null,
  submitRegistration: async () => null,
};

test("getDiscordLogin wraps the upstream discord url in the Quest envelope", async () => {
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async () => null,
    ...noopServices,
    getDiscordLogin: async () => ({ url: "https://discord.com/api/oauth2/authorize?client_id=1" }),
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.getDiscordLogin({ query: {} }, res);
  assert.equal(calls.status, 200);
  assert.equal(calls.json.success, true);
  assert.equal(calls.json.data.url, "https://discord.com/api/oauth2/authorize?client_id=1");
  assert.ok(calls.json.meta.serverNow);
});

test("getDiscordCallback reads code from req.query.code and wraps the result", async () => {
  let seenCode;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async () => null,
    ...noopServices,
    getDiscordCallback: async (code) => {
      seenCode = code;
      return { user: { discord_id: "123", discord_username: "sahan" }, exists: true, existing_data: null };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.getDiscordCallback({ query: { code: "abc123" } }, res);
  assert.equal(seenCode, "abc123");
  assert.equal(calls.json.data.exists, true);
  assert.equal(calls.json.data.user.discord_username, "sahan");
});

test("checkPuuid reads puuid from req.body and wraps the result", async () => {
  let seenPuuid;
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async () => null,
    ...noopServices,
    checkPuuid: async (puuid) => {
      seenPuuid = puuid;
      return { exists: true, user: { name: "Sahan", tag: "QST", discord_username: "sahan" } };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.checkPuuid({ body: { puuid: "p-1" } }, res);
  assert.equal(seenPuuid, "p-1");
  assert.equal(calls.json.data.user.name, "Sahan");
});

test("previewRegistration passes the upstream snake_case payload through unchanged", async () => {
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async () => null,
    ...noopServices,
    previewRegistration: async (puuid) => ({
      puuid,
      name: "Sahan",
      tag: "QST",
      current_rank: "Radiant",
      elo: 2000,
      peak_rank: "Radiant",
      peak_season: "e10a1",
      last_played: "2026-08-15T00:00:00Z",
    }),
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.previewRegistration({ body: { puuid: "p-1" } }, res);
  assert.equal(calls.json.data.current_rank, "Radiant");
  assert.equal(calls.json.data.peak_season, "e10a1");
  assert.equal(calls.json.data.last_played, "2026-08-15T00:00:00Z");
});

test("submitRegistration passes the raw body through to the service", async () => {
  let seenInput;
  const body = { discord_id: "123", discord_username: "sahan", puuid: "p-1" };
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async () => null,
    ...noopServices,
    submitRegistration: async (input) => {
      seenInput = input;
      return { success: true, message: "Registered", player: { puuid: "p-1" } };
    },
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.submitRegistration({ body }, res);
  assert.deepEqual(seenInput, body);
  assert.equal(calls.json.data.success, true);
  assert.equal(calls.json.data.player.puuid, "p-1");
});
