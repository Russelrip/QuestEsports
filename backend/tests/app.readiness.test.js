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
    getRealtimeStatus: () => ({ sharedTransportRequired }),
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
    protectAgainstCsrf: passthrough,
    requireAllowedApiOrigin: passthrough,
    setSecurityHeaders: passthrough,
  },
});

const requestReadiness = (app) => new Promise((resolve, reject) => {
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const request = http.get({
      host: "127.0.0.1",
      port: address.port,
      path: "/api/health/ready",
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        server.close(() => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
      });
    });
    request.on("error", (error) => server.close(() => reject(error)));
  });
  server.on("error", reject);
});

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
