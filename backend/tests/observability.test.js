const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const monitoringPath = path.join(__dirname, "../src/lib/monitoring.js");
const observabilityMiddlewarePath = path.join(
  __dirname,
  "../src/middleware/observability.js"
);
const envPath = path.join(__dirname, "../src/config/env.js");
const transportPath = path.join(__dirname, "../src/lib/observability-transport.js");

test("request observability middleware assigns and returns a request id", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(
    observabilityMiddlewarePath,
    {}
  );

  try {
    const headers = new Map();
    const req = {
      headers: {},
    };
    const res = {
      setHeader: (name, value) => headers.set(name, value),
    };

    await new Promise((resolve, reject) => {
      middleware.attachRequestContext(req, res, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    assert.ok(req.requestId);
    assert.equal(headers.get("X-Request-Id"), req.requestId);
  } finally {
    restore();
  }
});

test("monitoring capture ships webhook events with request context", async () => {
  const shippedPayloads = [];
  const loggedErrors = [];
  const loggedWarnings = [];

  const { module: monitoring, restore } = loadModuleWithMocks(monitoringPath, {
    [envPath]: {
      env: {
        NODE_ENV: "test",
        LOG_DRAIN_URL: "",
        MONITORING_WEBHOOK_URL: "https://monitoring.example.com/events",
        MONITORING_WEBHOOK_TOKEN: "secret",
      },
    },
    [loggerPath]: {
      redact: (value) => value,
      logger: {
        error: (message, metadata) => loggedErrors.push({ message, metadata }),
        warn: (message, metadata) => loggedWarnings.push({ message, metadata }),
      },
    },
    [transportPath]: {
      schedulePostJson: (options) => {
        shippedPayloads.push(options);
        return true;
      },
    },
  });

  try {
    monitoring.captureException(new Error("boom"), {
      requestId: "req-123",
      path: "/api/test",
    });

    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedWarnings.length, 0);
    assert.equal(shippedPayloads.length, 1);
    assert.equal(shippedPayloads[0].url, "https://monitoring.example.com/events");
    assert.equal(shippedPayloads[0].token, "secret");
    assert.equal(shippedPayloads[0].payload.context.requestId, "req-123");
    assert.equal(shippedPayloads[0].payload.type, "exception");
  } finally {
    restore();
  }
});

test("logger redacts sensitive fields before writing log payloads", async () => {
  const consoleMessages = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = (message) => consoleMessages.push(message);
  console.error = (message) => consoleMessages.push(message);

  const { module: loggerModule, restore } = loadModuleWithMocks(loggerPath, {
    [envPath]: {
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "debug",
        LOG_DRAIN_URL: "",
        LOG_DRAIN_TOKEN: "",
      },
    },
    [transportPath]: {
      schedulePostJson: () => false,
    },
  });

  try {
    loggerModule.logger.info("Sensitive log", {
      password: "secret-password",
      nested: {
        authToken: "abc123",
      },
    });

    assert.equal(consoleMessages.length, 1);
    const payload = JSON.parse(consoleMessages[0]);
    assert.equal(payload.password, "[REDACTED]");
    assert.equal(payload.nested.authToken, "[REDACTED]");
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    restore();
  }
});
