const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const middlewarePath = require.resolve("../src/middleware/maintenance");
const envPath = require.resolve("../src/config/env");

const loadMaintenance = (enabled) =>
  loadModuleWithMocks(middlewarePath, {
    [envPath]: {
      env: {
        SITE_MAINTENANCE_MODE: enabled,
        SITE_MAINTENANCE_MESSAGE: "Tournament systems are being upgraded.",
        SITE_MAINTENANCE_RETRY_AFTER_SECONDS: 600,
      },
    },
  });

const createResponse = () => ({
  locals: {},
  headers: {},
  statusCode: null,
  body: null,
  setHeader(name, value) {
    this.headers[name] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("maintenance middleware allows requests when the switch is disabled", () => {
  const loaded = loadMaintenance(false);
  try {
    let continued = false;
    loaded.module.requireSiteAvailable(
      { method: "GET", path: "/api/tournaments" },
      createResponse(),
      () => {
        continued = true;
      }
    );
    assert.equal(continued, true);
  } finally {
    loaded.restore();
  }
});

test("maintenance middleware returns a structured 503 for normal API traffic", () => {
  const loaded = loadMaintenance(true);
  try {
    const response = createResponse();
    loaded.module.requireSiteAvailable(
      { method: "GET", path: "/api/tournaments", requestId: "request-123" },
      response,
      () => assert.fail("request should not continue")
    );

    assert.equal(response.statusCode, 503);
    assert.equal(response.headers["Retry-After"], "600");
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.headers["X-Maintenance-Mode"], "active");
    assert.equal(response.locals.expectedMaintenance, true);
    assert.deepEqual(response.body, {
      success: false,
      code: "SITE_MAINTENANCE",
      message: "Tournament systems are being upgraded.",
      retryAfterSeconds: 600,
      requestId: "request-123",
    });
  } finally {
    loaded.restore();
  }
});

test("maintenance middleware preserves only the PayHere POST notification callback", () => {
  const loaded = loadMaintenance(true);
  try {
    let continued = false;
    loaded.module.requireSiteAvailable(
      { method: "POST", path: "/api/payments/payhere/notify" },
      createResponse(),
      () => {
        continued = true;
      }
    );
    assert.equal(continued, true);

    const response = createResponse();
    loaded.module.requireSiteAvailable(
      { method: "GET", path: "/api/payments/payhere/notify" },
      response,
      () => assert.fail("non-POST request should not continue")
    );
    assert.equal(response.statusCode, 503);
  } finally {
    loaded.restore();
  }
});
