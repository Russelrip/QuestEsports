const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
const authPath = path.join(__dirname, "../src/modules/valorant/valorant.auth.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const envMock = { env: {
  VALORANT_INTERNAL_BASE_URL: "http://localhost:8000",
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
  VALORANT_TIMEOUT_MS: 15000,
  VALORANT_READ_RETRIES: 2,
} };

const authMock = {
  signServiceToken: () => "signed-token",
  buildServiceAuthHeaders: ({ operationId, externalKey }) => ({
    Authorization: "Bearer signed-token",
    "X-Quest-Operation-Id": operationId,
    ...(externalKey ? { "Idempotency-Key": externalKey } : {}),
  }),
};

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : null;
    },
  },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const loadClient = () => loadModuleWithMocks(clientPath, {
  [envPath]: envMock,
  [authPath]: authMock,
});

test("valorantRequest signs headers and parses a 2xx response", async () => {
  let capturedHeaders;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return jsonResponse(200, { id: "team-1" }, { "X-Request-ID": "fastapi-req-1" });
  };
  try {
    const { module: client } = loadClient();
    const result = await client.valorantRequest({
      method: "POST",
      path: "/api/v1/teams",
      body: { name: "Quest Five" },
      actorUserId: "user-1",
      operationId: "op-1",
      externalKey: "saved-team-1",
      idempotent: true,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: "team-1" });
    assert.equal(result.requestId, "fastapi-req-1");
    assert.equal(capturedHeaders["X-Quest-Operation-Id"], "op-1");
    assert.equal(capturedHeaders["Idempotency-Key"], "saved-team-1");
    assert.match(capturedHeaders.Authorization, /^Bearer signed-token$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest maps a documented FastAPI error code to FastApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(409, {
    error: { code: "SERIES_ALREADY_FINALIZED", message: "series already finalized" },
  }, { "X-Request-ID": "fastapi-req-2" });
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "POST", path: "/api/v1/series/x/finalize", actorUserId: "user-1", operationId: "op-2" }),
      (error) => error instanceof client.FastApiError
        && error.code === "SERIES_ALREADY_FINALIZED"
        && error.status === 409
        && error.requestId === "fastapi-req-2",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest classifies a transport failure as InternalServiceError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "POST", path: "/api/v1/series/x/finalize", actorUserId: "user-1", operationId: "op-3" }),
      (error) => error instanceof client.InternalServiceError && error.code === "valorant_unreachable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest never retries mutations but retries idempotent reads on 5xx", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return jsonResponse(503, { error: { code: "INTERNAL_ERROR", message: "boom" } });
  };
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "DELETE", path: "/api/v1/series/x", actorUserId: "user-1", operationId: "op-4" }),
    );
    assert.equal(calls.length, 1, "mutations must not be retried");

    calls.length = 0;
    await assert.rejects(
      client.valorantRequest({ method: "GET", path: "/api/v1/teams", actorUserId: "user-1", operationId: "op-5", idempotent: true }),
    );
    assert.equal(calls.length, 3, "idempotent reads retry up to VALORANT_READ_RETRIES+1 attempts");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest surfaces a documented 401 as FastApiError, not an internal error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: "ADMIN_AUTH_REQUIRED", message: "admin key required" },
  });
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "GET", path: "/api/v1/teams", actorUserId: "user-1", operationId: "op-6" }),
      (error) => error instanceof client.FastApiError && error.code === "ADMIN_AUTH_REQUIRED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest maps a body-read AbortError to InternalServiceError (no retry for mutations)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "POST", path: "/api/v1/teams", actorUserId: "user-1", operationId: "op-7" }),
      (error) => error instanceof client.InternalServiceError && error.code === "valorant_unreachable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
