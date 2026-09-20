const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const backendRoot = path.join(__dirname, "..");
const appPath = path.join(backendRoot, "src/app.js");
const envPath = path.join(backendRoot, "src/config/env.js");
const routesPath = path.join(backendRoot, "src/routes/index.js");
const v1RoutesPath = path.join(backendRoot, "src/routes/v1.js");
const openApiPath = path.join(backendRoot, "src/lib/openapi.js");
const databasePath = path.join(backendRoot, "src/lib/database.js");
const uploadPath = path.join(backendRoot, "src/middleware/upload.js");
const loggerPath = path.join(backendRoot, "src/lib/logger.js");
const realtimePath = path.join(backendRoot, "src/modules/realtime/realtime.service.js");
const maintenancePath = path.join(backendRoot, "src/middleware/maintenance.js");
const errorHandlerPath = path.join(backendRoot, "src/middleware/error-handler.js");
const observabilityPath = path.join(backendRoot, "src/middleware/observability.js");
const securityPath = path.join(backendRoot, "src/middleware/security.js");

const passthrough = (req, res, next) => next();

const realtimeStatusFixture = {
  workerId: "worker-a:123:uuid",
  activeConnections: 7,
  activeClients: 3,
  publishedEvents: 42,
  lastErrorAt: null,
};

const loadApp = ({ realtimeEnabled, sharedTransportRequired, transportReady }) => loadModuleWithMocks(appPath, {
  [envPath]: {
    env: {
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
      SITE_MAINTENANCE_MODE: false,
      REALTIME_SSE_ENABLED: realtimeEnabled,
    },
  },
  [routesPath]: passthrough,
  [v1RoutesPath]: passthrough,
  [openApiPath]: { openApiDocument: {} },
  [databasePath]: {
    checkDatabaseReadiness: async () => {},
  },
  [uploadPath]: {
    checkUploadReadiness: async () => {},
  },
  [loggerPath]: { logger: { warn() {} } },
  [realtimePath]: {
    getRealtimeStatus: () => ({ ...realtimeStatusFixture, sharedTransportRequired }),
    isRealtimeTransportReady: () => transportReady,
  },
  [maintenancePath]: {
    requireSiteAvailable: passthrough,
    sendMaintenanceResponse: passthrough,
  },
  [errorHandlerPath]: {
    notFoundHandler: (req, res) => res.status(404).end(),
    errorHandler: (error, req, res, next) => next(error),
  },
  [observabilityPath]: {
    attachRequestContext: passthrough,
    logRequestLifecycle: passthrough,
  },
  [securityPath]: {
    // Mirrors the real predicate, which security.test.js covers directly.
    isInternalRequest: (req) => !req.headers["x-forwarded-for"],
    protectAgainstCsrf: passthrough,
    requireAllowedApiOrigin: passthrough,
    setSecurityHeaders: passthrough,
  },
});

const requestJson = (app, { path = "/api/health/ready", headers = {} } = {}) => new Promise((resolve, reject) => {
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const request = http.get({
      host: "127.0.0.1",
      port: address.port,
      path,
      headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        server.close(() => resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: JSON.parse(body),
        }));
      });
    });
    request.on("error", (error) => server.close(() => reject(error)));
  });
  server.on("error", reject);
});

// Nginx appends this on every request it proxies to the API, so it is what
// separates a caller at the public edge from the release gate on the host.
const publicCaller = { headers: { "x-forwarded-for": "203.0.113.10" } };

const requestReadiness = (app) => requestJson(app);

test("clustered SSE readiness fails while the shared realtime transport is disconnected", async () => {
  const loaded = loadApp({
    realtimeEnabled: true,
    sharedTransportRequired: true,
    transportReady: false,
  });

  try {
    const result = await requestReadiness(loaded.module);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.success, false);
  } finally {
    loaded.restore();
  }
});

test("non-clustered readiness remains database/storage-only", async () => {
  const loaded = loadApp({
    realtimeEnabled: true,
    sharedTransportRequired: false,
    transportReady: false,
  });

  try {
    const result = await requestReadiness(loaded.module);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.readiness, {
      database: "ready",
      storage: "ready",
    });
  } finally {
    loaded.restore();
  }
});

test("public readiness reports the verdict without naming each dependency", async () => {
  const loaded = loadApp({
    realtimeEnabled: true,
    sharedTransportRequired: false,
    transportReady: false,
  });

  try {
    const result = await requestJson(loaded.module, {
      path: "/api/health/ready",
      ...publicCaller,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.readiness, undefined);
  } finally {
    loaded.restore();
  }
});

test("public liveness keeps the realtime flag and drops worker and transport detail", async () => {
  const loaded = loadApp({
    realtimeEnabled: true,
    sharedTransportRequired: true,
    transportReady: true,
  });

  try {
    const result = await requestJson(loaded.module, {
      path: "/api/health/live",
      ...publicCaller,
    });
    assert.equal(result.statusCode, 200);
    // The browser still needs this to decide whether to open an EventSource.
    assert.deepEqual(result.body.realtime, { enabled: true });
    assert.equal(result.body.observability, undefined);
    assert.equal(result.body.maintenance.enabled, false);
  } finally {
    loaded.restore();
  }
});

test("internal liveness still carries worker identity and transport counters", async () => {
  const loaded = loadApp({
    realtimeEnabled: true,
    sharedTransportRequired: true,
    transportReady: true,
  });

  try {
    const result = await requestJson(loaded.module, { path: "/api/health/live" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.realtime.enabled, true);
    assert.equal(result.body.realtime.workerId, realtimeStatusFixture.workerId);
    assert.equal(result.body.realtime.activeConnections, 7);
    assert.equal(typeof result.body.observability, "object");
  } finally {
    loaded.restore();
  }
});

test("health responses do not advertise the application framework", async () => {
  const loaded = loadApp({
    realtimeEnabled: false,
    sharedTransportRequired: false,
    transportReady: false,
  });

  try {
    const result = await requestJson(loaded.module, {
      path: "/api/health/live",
      ...publicCaller,
    });
    assert.equal(result.headers["x-powered-by"], undefined);
  } finally {
    loaded.restore();
  }
});
