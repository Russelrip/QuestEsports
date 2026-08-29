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
  delete environment.NODE_V8_COVERAGE;
  return { ...environment, ...overrides };
};

const runNode = (script, overrides) => {
  const environment = testEnvironment(overrides);
  // An explicit empty value also prevents Node 22's test runner from
  // re-injecting its temporary coverage directory into spawned children.
  environment.NODE_V8_COVERAGE = "";
  return spawnSync(process.execPath, ["-e", script], {
    cwd: backendRoot,
    env: environment,
    encoding: "utf8",
  });
};

const parseLastJsonLine = (output) =>
  JSON.parse(output.trim().split(/\r?\n/).at(-1));

test("child test processes do not inherit the parent coverage directory", () => {
  const result = runNode("process.stdout.write(process.env.NODE_V8_COVERAGE || '')");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("validation mode allows GET/HEAD health probes and reports writers disabled", () => {
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

test("the app freezes malformed, unauthorized, normalized, and real callback mutations before other checks", () => {
  const result = runNode(`
    const http = require("node:http");
    const app = require("./src/app");
    const request = (server, method, path, headers = {}, body = null) => new Promise((resolve, reject) => {
      const requestStream = http.request({ host: "127.0.0.1", port: server.address().port, method, path, headers }, (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => resolve({
          method,
          path,
          status: response.statusCode,
          retryAfter: response.headers["retry-after"],
          freeze: response.headers["x-write-freeze"],
          exposed: response.headers["access-control-expose-headers"],
          code: responseBody ? JSON.parse(responseBody).code : null,
        }));
      });
      requestStream.on("error", reject);
      if (body) requestStream.write(body);
      requestStream.end();
    });
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const health = await request(server, "GET", "/API/HEALTH/LIVE");
        const status = await request(server, "HEAD", "/api/health/write-freeze");
        const safeReads = await Promise.all([
          request(server, "GET", "/api/health/ready"),
          request(server, "GET", "/api/capabilities"),
          request(server, "GET", "/api/openapi.json"),
        ]);
        const methods = await Promise.all(["POST", "PUT", "PATCH", "DELETE"].map((method) => request(
          server,
          method,
          "/api/v1/mutation",
          { Origin: "https://evil.example", Cookie: "quest_session=stale" },
        )));
        const exposed = await request(server, "POST", "/api/v1/mutation", {
          Origin: "http://localhost:3000",
        });
        const payHere = await request(server, "POST", "/api/payments/payhere/notify/", { "Content-Type": "application/json" }, "{malformed");
        const callbacks = await Promise.all([
          request(server, "GET", "/API/AUTH/GOOGLE/CALLBACK/?code=ignored"),
          request(server, "GET", "/api/v1/auth/oauth/google/link/callback/"),
          request(server, "GET", "/api/email-verification/verify/"),
          request(server, "HEAD", "/api/email-change/confirm/"),
          request(server, "GET", "/API/AUTH/GOOGLE/START/"),
        ]);
        const writeShapedReads = await Promise.all([
          request(server, "GET", "/api/unknown"),
          request(server, "HEAD", "/api/orders/order-1"),
          request(server, "GET", "/api/ticket-orders/status"),
          request(server, "GET", "/api/payments/payment-1"),
          request(server, "GET", "/api/v1/match-rooms/mine"),
          request(server, "GET", "/api/v1/veto-rooms/mine"),
          request(server, "GET", "/api/v1/valorant/leaderboard/register/discord/login"),
        ]);
        console.log(JSON.stringify({ health, status, safeReads, methods, exposed, payHere, callbacks, writeShapedReads }));
        setTimeout(() => server.close(), 50);
      } catch (error) {
        console.error(error);
        server.close(() => process.exitCode = 1);
      }
    });
  `, { WRITE_FREEZE_MODE: "validation" });
  assert.equal(result.status, 0, result.stderr);
  const output = parseLastJsonLine(result.stdout);
  assert.equal(output.health.status, 200);
  assert.equal(output.status.status, 200);
  for (const response of output.safeReads) {
    assert.notEqual(response.code, "WRITE_FREEZE");
    assert.notEqual(response.freeze, "validation");
    if (response.path !== "/api/health/ready") {
      assert.equal(response.status, 200);
    }
  }
  for (const response of [...output.methods, output.exposed, output.payHere, ...output.callbacks, ...output.writeShapedReads]) {
    assert.equal(response.status, 503);
    assert.equal(response.retryAfter, "900");
    assert.equal(response.freeze, "validation");
    if (response.method !== "HEAD") {
      assert.equal(response.code, "WRITE_FREEZE");
    }
  }
  assert.match(output.exposed.exposed, /X-Write-Freeze/);
});

test("off mode preserves ordinary app routing", () => {
  const result = runNode(`
    const http = require("node:http");
    const app = require("./src/app");
    const server = app.listen(0, "127.0.0.1", () => {
      const request = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: "/api/v1/mutation" }, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          console.log(JSON.stringify({ status: response.statusCode, body: body ? JSON.parse(body) : null }));
          server.close();
        });
      });
      request.end(JSON.stringify({ example: true }));
    });
  `, { WRITE_FREEZE_MODE: "off" });
  assert.equal(result.status, 0, result.stderr);
  const output = parseLastJsonLine(result.stdout);
  assert.equal(output.status, 404);
  assert.notEqual(output.body?.code, "WRITE_FREEZE");
});

test("validation session reads do not refresh sessions or clean up expired sessions", () => {
  const result = runNode(`
    const path = require("node:path");
    const cache = (relativePath, exports) => {
      const filename = require.resolve(path.resolve(process.cwd(), "src", relativePath));
      require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [] };
    };
    const calls = [];
    let expired = false;
    const future = new Date(Date.now() + 60_000);
    const session = {
      id: "session-1",
      expiresAt: future,
      createdAt: future,
      lastSeenAt: new Date(0),
      userAgent: null,
      ipAddress: null,
      rememberMe: false,
      user: { id: "user-1" },
    };
    cache("lib/prisma", { prisma: { session: {
      findUnique: async () => { calls.push("findUnique"); return expired ? { ...session, expiresAt: new Date(0) } : session; },
      updateMany: async () => { calls.push("updateMany"); return { count: 1 }; },
      deleteMany: async () => { calls.push("deleteMany"); return { count: 1 }; },
    } } });
    cache("config/env", { env: { WRITE_FREEZE_MODE: "validation", SESSION_COOKIE_NAME: "quest_session", NODE_ENV: "test", SESSION_TTL_DAYS: 1, REMEMBER_ME_SESSION_TTL_DAYS: 30 } });
    cache("lib/logger", { logger: { warn() {} } });
    cache("modules/auth/auth.service", { PUBLIC_USER_SELECT: {} });
    const service = require("./src/modules/auth/session.service");
    service.getSessionFromRequest({ headers: { cookie: "quest_session=token" } }).then(() => {
      expired = true;
      return service.getSessionFromRequest({ headers: { cookie: "quest_session=token" } });
    }).then(() => console.log(JSON.stringify(calls))).catch((error) => { console.error(error); process.exitCode = 1; });
  `, { WRITE_FREEZE_MODE: "validation" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseLastJsonLine(result.stdout), ["findUnique", "findUnique"]);
});

test("WRITE_FREEZE_MODE defaults only when absent and rejects explicit non-exact values", () => {
  const defaultResult = runNode(
    "process.stdout.write(require('./src/config/env').env.WRITE_FREEZE_MODE)",
  );
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.equal(defaultResult.stdout, "off");

  for (const value of ["", " validation", "VALIDATION", "blocked"]) {
    const invalidResult = runNode("require('./src/config/env')", {
      WRITE_FREEZE_MODE: value,
    });
    assert.notEqual(invalidResult.status, 0, `expected ${JSON.stringify(value)} to fail`);
    assert.match(invalidResult.stderr, /Invalid WRITE_FREEZE_MODE value/);
  }
});

test("startup records the 0.0.0.0 HTTP listen and gates all five writers by mode", () => {
  for (const [mode, expectedCalls] of [
    ["validation", ["uploads", "database", "realtime"]],
    ["off", ["uploads", "database", "realtime", "job", "commerce", "challonge", "ranking", "hygiene"]],
  ]) {
    const result = runNode(`
      const path = require("node:path");
      const cache = (relativePath, exports) => {
        const filename = require.resolve(path.resolve(process.cwd(), "src", relativePath));
        require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [] };
      };
      const calls = [];
      const listens = [];
      const fakeServer = { listening: false, on() { return this; } };
      cache("app", { listen: (...args) => { listens.push(args); return fakeServer; } });
      cache("lib/database", { initializeDatabase: async () => calls.push("database"), closeDatabase: async () => {} });
      cache("lib/jobs", { startJobWorker: () => calls.push("job"), stopJobWorker: async () => {} });
      cache("lib/commerce-maintenance", { startCommerceMaintenance: () => calls.push("commerce"), stopCommerceMaintenance: async () => {} });
      cache("lib/logger", { logger: { info() {}, warn() {}, error() {} } });
      cache("lib/observability-transport", { flushObservabilityTransport: async () => {} });
      cache("lib/data-hygiene-maintenance", { startDataHygieneMaintenance: () => calls.push("hygiene"), stopDataHygieneMaintenance: async () => {} });
      cache("config/env", { env: { PORT: 0, NODE_ENV: "test", WRITE_FREEZE_MODE: process.env.WRITE_FREEZE_MODE } });
      cache("middleware/upload", { ensureUploadDirectories: async () => calls.push("uploads") });
      cache("modules/challonge/challonge.jobs", { startChallongeScheduler: () => calls.push("challonge"), stopChallongeScheduler: async () => {} });
      cache("modules/players/ranking.jobs", { startRankingScheduler: () => calls.push("ranking"), stopRankingScheduler: async () => {} });
      cache("modules/realtime/realtime.service", { startRealtimeTransport: async () => calls.push("realtime"), stopRealtimeTransport: async () => {} });
      cache("modules/realtime/realtime.controller", { drainRealtimeConnections() {} });
      require("./src/server").start({ registerProcessDiagnosticsFn: () => {}, registerProcessSignalsFn: () => {} }).then(() => console.log(JSON.stringify({ calls, listens }))).catch((error) => { console.error(error); process.exitCode = 1; });
    `, { WRITE_FREEZE_MODE: mode });
    assert.equal(result.status, 0, result.stderr);
    const output = parseLastJsonLine(result.stdout);
    assert.deepEqual(output.calls, expectedCalls);
    assert.deepEqual(output.listens, [[0, "0.0.0.0"]]);
  }
});
