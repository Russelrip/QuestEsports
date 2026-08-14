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
