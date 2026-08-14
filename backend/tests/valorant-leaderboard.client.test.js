const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const envWithUrl = { env: { VALORANT_SL_API_URL: "https://api.valorantsl.com" } };
const envWithoutUrl = { env: { VALORANT_SL_API_URL: "" } };

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const loadClient = (envMock) => loadModuleWithMocks(clientPath, { [envPath]: envMock });

test("getLeaderboard builds the upstream query and returns the parsed payload", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { entries: [], total: 0, page: 1, per_page: 50, total_pages: 1 });
  };
  try {
    const { module: client } = loadClient(envWithUrl);
    const result = await client.getLeaderboard({ page: 2, perPage: 25 });
    assert.equal(capturedUrl, "https://api.valorantsl.com/api/v1/leaderboard?page=2&per_page=25");
    assert.equal(result.total_pages, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchLeaderboard URL-encodes the query and passes through a null result", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse(200, null);
  };
  try {
    const { module: client } = loadClient(envWithUrl);
    const result = await client.searchLeaderboard("john#1234");
    assert.equal(capturedUrl, "https://api.valorantsl.com/api/v1/leaderboard/search/john%231234");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 503 when VALORANT_SL_API_URL is not configured", async () => {
  const { module: client } = loadClient(envWithoutUrl);
  await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
});

test("throws 503 on transport failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient(envWithUrl);
    await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 404 when upstream reports an out-of-range page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(404, { detail: "Page 999 not found." });
  try {
    const { module: client } = loadClient(envWithUrl);
    await assert.rejects(client.getLeaderboard({ page: 999, perPage: 50 }), (e) => e.statusCode === 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
