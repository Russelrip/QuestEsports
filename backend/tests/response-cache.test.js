const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const middlewarePath = path.join(__dirname, "../src/middleware/response-cache.js");
const cachePath = path.join(__dirname, "../src/lib/cache.js");

const createResponse = () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = new Map();
  response.setHeader = (name, value) => response.headers.set(name, value);
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    response.emit("finish");
    return response;
  };
  return response;
};

test("concurrent response-cache misses share one successful handler response", async () => {
  const writes = [];
  const { module: responseCache, restore } = loadModuleWithMocks(middlewarePath, {
    [cachePath]: {
      get: async () => null,
      set: async (...args) => writes.push(args),
      invalidateTags: async () => undefined,
    },
  });

  try {
    const middleware = responseCache.cacheJson({ ttlSeconds: 60, tags: ["tournaments"] });
    const request = { method: "GET", originalUrl: "/api/tournaments/quest-cup", headers: {} };
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    let firstNextCalls = 0;
    let secondNextCalls = 0;

    await middleware(request, firstResponse, () => { firstNextCalls += 1; });
    const secondRequest = middleware(request, secondResponse, () => { secondNextCalls += 1; });
    await Promise.resolve();
    firstResponse.json({ success: true, tournament: { id: "tournament-1" } });
    await secondRequest;

    assert.equal(firstNextCalls, 1);
    assert.equal(secondNextCalls, 0);
    assert.equal(secondResponse.headers.get("X-Cache"), "COALESCED");
    assert.deepEqual(secondResponse.body, firstResponse.body);
    assert.equal(writes.length, 1);
  } finally {
    restore();
  }
});

test("concurrent response-cache misses share transient failures without caching them", async () => {
  const writes = [];
  const { module: responseCache, restore } = loadModuleWithMocks(middlewarePath, {
    [cachePath]: {
      get: async () => null,
      set: async (...args) => writes.push(args),
      invalidateTags: async () => undefined,
    },
  });

  try {
    const middleware = responseCache.cacheJson({ ttlSeconds: 60, tags: ["tournaments"] });
    const firstRequest = { method: "GET", originalUrl: "/api/tournaments/quest-cup", headers: {}, requestId: "first" };
    const secondRequest = { ...firstRequest, requestId: "second" };
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    let firstNextCalls = 0;
    let secondNextCalls = 0;

    await middleware(firstRequest, firstResponse, () => { firstNextCalls += 1; });
    const waitingRequest = middleware(secondRequest, secondResponse, () => { secondNextCalls += 1; });
    await Promise.resolve();
    firstResponse.status(503).json({ success: false, message: "Database is busy.", requestId: "first" });
    await waitingRequest;

    assert.equal(firstNextCalls, 1);
    assert.equal(secondNextCalls, 0);
    assert.equal(secondResponse.statusCode, 503);
    assert.equal(secondResponse.headers.get("X-Cache"), "COALESCED");
    assert.equal(secondResponse.body.requestId, "second");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("route-scoped public caches may explicitly serve identical responses to cookie requests", async () => {
  let reads = 0;
  const cachedBody = { status: 200, body: { success: true, data: { source: "challonge" } } };
  const { module: responseCache, restore } = loadModuleWithMocks(middlewarePath, {
    [cachePath]: {
      get: async () => { reads += 1; return cachedBody; },
      set: async () => undefined,
      invalidateTags: async () => undefined,
    },
  });
  try {
    const middleware = responseCache.cacheJson({ ttlSeconds: 30, allowCookies: true });
    const response = createResponse();
    let nextCalls = 0;
    await middleware({ method: "GET", originalUrl: "/api/v1/tournaments/quest/bracket", headers: { cookie: "session=abc" } }, response, () => { nextCalls += 1; });
    assert.equal(reads, 1);
    assert.equal(nextCalls, 0);
    assert.equal(response.headers.get("X-Cache"), "HIT");
  } finally { restore(); }
});
