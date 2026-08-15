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

const upstreamErrorResponse = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
});

test("getDiscordLogin hits GET /api/v1/auth/discord/login with signed headers and returns the url payload", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, { url: "https://discord.com/api/oauth2/authorize?client_id=1" });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.getDiscordLogin();
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/auth/discord/login`);
    assert.equal(capturedOptions.method, "GET");
    assert.match(capturedOptions.headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(
      decodeJwtPayload(capturedOptions.headers.Authorization.replace(/^Bearer /, "")).sub,
      SYSTEM_ACTOR,
    );
    assert.equal(typeof capturedOptions.headers["X-Quest-Operation-Id"], "string");
    assert.equal(result.url, "https://discord.com/api/oauth2/authorize?client_id=1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getDiscordCallback passes the code as a URL-encoded query param", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { user: { discord_id: "123", discord_username: "sahan" }, exists: true, existing_data: null });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.getDiscordCallback("abc&def");
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/auth/discord/callback?code=abc%26def`);
    assert.equal(result.exists, true);
    assert.equal(result.user.discord_username, "sahan");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkPuuid POSTs { puuid } to /api/v1/auth/check-puuid with JSON headers", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, { exists: true, user: { name: "Sahan", tag: "QST", discord_username: "sahan" } });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.checkPuuid("p-1");
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/auth/check-puuid`);
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(capturedOptions.body), { puuid: "p-1" });
    assert.equal(typeof capturedOptions.headers["X-Quest-Operation-Id"], "string");
    assert.equal(result.exists, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("previewRegistration POSTs { puuid } to /api/v1/register/preview and passes snake_case through", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, {
      puuid: "p-1",
      name: "Sahan",
      tag: "QST",
      current_rank: "Radiant",
      elo: 2000,
      peak_rank: "Radiant",
      peak_season: "e10a1",
      last_played: "2026-08-15T00:00:00Z",
    });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.previewRegistration("p-1");
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/register/preview`);
    assert.equal(capturedOptions.method, "POST");
    assert.deepEqual(JSON.parse(capturedOptions.body), { puuid: "p-1" });
    assert.equal(result.peak_season, "e10a1");
    assert.equal(result.current_rank, "Radiant");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitRegistration POSTs the raw input to /api/v1/register/submit", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  const input = { discord_id: "123", discord_username: "sahan", puuid: "p-1" };
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, { success: true, message: "Registered", player: { puuid: "p-1" } });
  };
  try {
    const { module: client } = loadClient(envWithConfig);
    const result = await client.submitRegistration(input);
    assert.equal(capturedUrl, `${INTERNAL_BASE_URL}/api/v1/register/submit`);
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(capturedOptions.body), input);
    assert.equal(result.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("propagates a 409 upstream error as HttpError with the upstream status and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    upstreamErrorResponse(409, {
      error: {
        code: "ALREADY_REGISTERED",
        message: "Player already registered for this season.",
        request_id: "req-123",
      },
    });
  try {
    const { module: client } = loadClient(envWithConfig);
    await assert.rejects(
      client.submitRegistration({ discord_id: "1", discord_username: "sahan", puuid: "p-1" }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.equal(e.statusCode, 409);
        assert.equal(e.message, "Player already registered for this season.");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the upstream error code when message is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => upstreamErrorResponse(404, { error: { code: "PLAYER_NOT_FOUND", request_id: "req-2" } });
  try {
    const { module: client } = loadClient(envWithConfig);
    await assert.rejects(
      client.previewRegistration("p-missing"),
      (e) => e.statusCode === 404 && e.message === "PLAYER_NOT_FOUND",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 503 on transport failure for registration POSTs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient(envWithConfig);
    await assert.rejects(client.checkPuuid("p-1"), (e) => e.statusCode === 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
