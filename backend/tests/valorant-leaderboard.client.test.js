const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const SYSTEM_ACTOR = "system:valorant-leaderboard";
const INTERNAL_BASE_URL = "https://valorant-platform-backend.internal";

const envWithConfig = {
  env: {
    VALORANT_INTERNAL_BASE_URL: INTERNAL_BASE_URL,
    QUEST_LEADERBOARD_SYSTEM_ACTOR: SYSTEM_ACTOR,
    VALORANT_SERVICE_SECRET: "test-service-secret",
    VALORANT_SERVICE_KEY_ID: "test-key-id",
    VALORANT_SERVICE_ISSUER: "quest-esports",
    VALORANT_SERVICE_AUDIENCE: "valorant-platform",
  },
};
const envWithoutBaseUrl = { env: { VALORANT_INTERNAL_BASE_URL: "" } };
const envWithoutActor = {
  env: {
    VALORANT_INTERNAL_BASE_URL: INTERNAL_BASE_URL,
    QUEST_LEADERBOARD_SYSTEM_ACTOR: "",
  },
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const decodeJwtPayload = (token) => {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
};

const loadClient = (envMock) => loadModuleWithMocks(clientPath, { [envPath]: envMock });

test("getLeaderboard hits the internal base URL with a signed request and returns the parsed payload", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, { entries: [], total: 0, page: 1, per_page: 50, total_pages: 1 });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.getLeaderboard({ page: 2, perPage: 25 });
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/leaderboard?page=2&per_page=25`);
    assert.equal(result.total_pages, 1);

    assert.match(capturedOptions.headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(
      decodeJwtPayload(capturedOptions.headers.Authorization.replace(/^Bearer /, "")).sub,
      SYSTEM_ACTOR,
    );
    assert.equal(typeof capturedOptions.headers["X-Quest-Operation-Id"], "string");
    assert.equal(capturedOptions.headers["X-Quest-Operation-Id"].length, 36);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generates a fresh operation id for each request", async () => {
  const originalFetch = globalThis.fetch;
  const operationIds = [];
  globalThis.fetch = async (url, options) => {
    operationIds.push(options.headers["X-Quest-Operation-Id"]);
    return jsonResponse(200, { entries: [], total: 0, page: 1, per_page: 50, total_pages: 1 });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    await client.getLeaderboard({ page: 1, perPage: 50 });
    await client.searchLeaderboard("john#1234");
    assert.equal(operationIds.length, 2);
    assert.notEqual(operationIds[0], operationIds[1]);
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
    const { module: client } = loadClient(envWithConfig);
    const result = await client.searchLeaderboard("john#1234");
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/leaderboard/search/john%231234`);
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 503 when VALORANT_INTERNAL_BASE_URL is not configured", async () => {
  const { module: client } = loadClient(envWithoutBaseUrl);
  await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
});

test("throws 503 when QUEST_LEADERBOARD_SYSTEM_ACTOR is not configured", async () => {
  const { module: client } = loadClient(envWithoutActor);
  await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
});

test("throws 503 on transport failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient(envWithConfig);
    await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 404 when upstream reports an out-of-range page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(404, { detail: "Page 999 not found." });
  try {
    const { module: client } = loadClient(envWithConfig);
    await assert.rejects(client.getLeaderboard({ page: 999, perPage: 50 }), (e) => e.statusCode === 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
