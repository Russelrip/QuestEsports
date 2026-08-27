const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const backendRoot = path.join(__dirname, "..");

const testEnvironment = (overrides = {}) => {
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    QUEST_DISABLE_DOTENV: "true",
    DATABASE_URL: "postgresql://quest:quest@127.0.0.1:5432/quest",
    DIRECT_URL: "postgresql://quest:quest@127.0.0.1:5432/quest",
    SESSION_COOKIE_NAME: "quest_session",
  };
  delete environment.WRITE_FREEZE_MODE;
  return { ...environment, ...overrides };
};

const runNode = (script, overrides) =>
  spawnSync(process.execPath, ["-e", script], {
    cwd: backendRoot,
    env: testEnvironment(overrides),
    encoding: "utf8",
  });

const parseLastJsonLine = (output) =>
  JSON.parse(output.trim().split(/\r?\n/).at(-1));

test("validation mode allows health reads and reports writers disabled", () => {
  const result = runNode(`
    const http = require("node:http");
    const app = require("./src/app");
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const paths = ["/api/health/live", "/api/health/write-freeze"];
      Promise.all(paths.map((path) => new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path }, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        }).on("error", reject);
      }))).then((responses) => {
        console.log(JSON.stringify(responses));
        server.close();
      }).catch((error) => {
        console.error(error);
        server.close(() => process.exitCode = 1);
      });
    });
  `, { WRITE_FREEZE_MODE: "validation" });
  assert.equal(result.status, 0, result.stderr);
  const [health, status] = parseLastJsonLine(result.stdout);
  assert.equal(health.status, 200);
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { mode: "validation", writersEnabled: false });
});

test("validation mode rejects every mutation and callback with retryable freeze headers", () => {
  const result = runNode(`
    const { requireWritesEnabled } = require("./src/middleware/write-freeze");
    const response = () => ({
      locals: {}, headers: {}, statusCode: null, body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    });
    const outcomes = ["POST", "PUT", "PATCH", "DELETE"].map((method) => {
      const res = response();
      requireWritesEnabled({ method, path: "/api/v1/mutation", requestId: "request-123" }, res, () => { res.continued = true; });
      return { status: res.statusCode, retryAfter: res.headers["Retry-After"], freeze: res.headers["X-Write-Freeze"], code: res.body.code };
    });
    const callback = response();
    requireWritesEnabled({ method: "GET", path: "/api/payments/payhere/notify" }, callback, () => { callback.continued = true; });
    outcomes.push({ status: callback.statusCode, retryAfter: callback.headers["Retry-After"], freeze: callback.headers["X-Write-Freeze"], code: callback.body.code });
    console.log(JSON.stringify(outcomes));
  `, {
    WRITE_FREEZE_MODE: "validation",
    SITE_MAINTENANCE_RETRY_AFTER_SECONDS: "600",
  });
  assert.equal(result.status, 0, result.stderr);
  for (const outcome of JSON.parse(result.stdout)) {
    assert.deepEqual(outcome, {
      status: 503,
      retryAfter: "600",
      freeze: "validation",
      code: "WRITE_FREEZE",
    });
  }
});

test("off mode preserves reads and mutations", () => {
  const result = runNode(`
    const { requireWritesEnabled } = require("./src/middleware/write-freeze");
    const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
    const continued = methods.map((method) => {
      let nextCalled = false;
      requireWritesEnabled({ method, path: "/api/v1/example" }, { locals: {}, setHeader() {}, status() { return this; }, json() { return this; } }, () => { nextCalled = true; });
      return nextCalled;
    });
    console.log(JSON.stringify(continued));
  `, { WRITE_FREEZE_MODE: "off" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLastJsonLine(result.stdout), [true, true, true, true, true, true]);
});

test("invalid WRITE_FREEZE_MODE is rejected and defaults to off", () => {
  const defaultResult = runNode(
    "process.stdout.write(require('./src/config/env').env.WRITE_FREEZE_MODE)",
  );
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.equal(defaultResult.stdout, "off");

  const invalidResult = runNode("require('./src/config/env')", {
    WRITE_FREEZE_MODE: "blocked",
  });
  assert.notEqual(invalidResult.status, 0);
  assert.match(invalidResult.stderr, /Invalid WRITE_FREEZE_MODE value/);
});

test("validation startup initializes the database and HTTP server without starting writers", () => {
  const result = runNode(`
    const path = require("node:path");
    const cache = (relativePath, exports) => {
      const filename = require.resolve(path.resolve(process.cwd(), "src", relativePath));
      require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [] };
    };
    const calls = [];
    const fakeServer = { listening: false, on() { return this; } };
    cache("app", { listen: () => fakeServer });
    cache("lib/database", { initializeDatabase: async () => calls.push("database"), closeDatabase: async () => {} });
    cache("lib/jobs", { startJobWorker: () => calls.push("job"), stopJobWorker: async () => {} });
    cache("lib/commerce-maintenance", { startCommerceMaintenance: () => calls.push("commerce"), stopCommerceMaintenance: async () => {} });
    cache("lib/logger", { logger: { info() {}, warn() {}, error() {} } });
    cache("lib/observability-transport", { flushObservabilityTransport: async () => {} });
    cache("lib/data-hygiene-maintenance", { startDataHygieneMaintenance: () => calls.push("hygiene"), stopDataHygieneMaintenance: async () => {} });
    cache("config/env", { env: { PORT: 0, NODE_ENV: "test", WRITE_FREEZE_MODE: "validation" } });
    cache("middleware/upload", { ensureUploadDirectories: async () => calls.push("uploads") });
    cache("modules/challonge/challonge.jobs", { startChallongeScheduler: () => calls.push("challonge"), stopChallongeScheduler: async () => {} });
    cache("modules/players/ranking.jobs", { startRankingScheduler: () => calls.push("ranking"), stopRankingScheduler: async () => {} });
    cache("modules/realtime/realtime.service", { startRealtimeTransport: async () => calls.push("realtime"), stopRealtimeTransport: async () => {} });
    cache("modules/realtime/realtime.controller", { drainRealtimeConnections() {} });
    require("./src/server").start({ registerProcessDiagnosticsFn: () => {}, registerProcessSignalsFn: () => {} }).then(() => console.log(JSON.stringify(calls))).catch((error) => { console.error(error); process.exitCode = 1; });
  `, { WRITE_FREEZE_MODE: "validation" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLastJsonLine(result.stdout), ["uploads", "database", "realtime"]);
});
