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

test("request observability rejects unsafe caller-supplied request ids", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(
    observabilityMiddlewarePath,
    {}
  );
  try {
    const req = { headers: { "x-request-id": "bad\r\nforged-header" } };
    const res = { setHeader: () => undefined };
    middleware.attachRequestContext(req, res, () => undefined);
    assert.match(req.requestId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(req.requestId, req.headers["x-request-id"]);
  } finally {
    restore();
  }
});

test("request observability exposes application processing time", () => {
  const loggedRequests = [];
  const { module: middleware, restore } = loadModuleWithMocks(
    observabilityMiddlewarePath,
    {
      [loggerPath]: {
        logger: {
          info: (message, metadata) => loggedRequests.push({ message, metadata }),
          warn: () => {},
          error: () => {},
        },
      },
    }
  );

  try {
    const headers = new Map();
    const listeners = new Map();
    const req = {
      startedAt: Date.now() - 25,
      headers: {},
      method: "GET",
      originalUrl: "/api/tournaments",
    };
    const res = {
      headersSent: false,
      statusCode: 200,
      hasHeader: (name) => headers.has(name),
      setHeader: (name, value) => headers.set(name, value),
      on: (name, listener) => listeners.set(name, listener),
      writeHead() {
        this.headersSent = true;
      },
    };

    middleware.logRequestLifecycle(req, res, () => {});
    res.writeHead(200);
    listeners.get("finish")();

    assert.match(headers.get("Server-Timing"), /^app;dur=\d+$/);
    assert.equal(loggedRequests.length, 1);
    assert.ok(loggedRequests[0].metadata.durationMs >= 0);
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
        DISCORD_ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/123/secret",
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
      sourceErrorCode: "P2024",
    });

    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedWarnings.length, 0);
    assert.equal(shippedPayloads.length, 2);
    assert.equal(shippedPayloads[0].url, "https://monitoring.example.com/events");
    assert.equal(shippedPayloads[0].token, "secret");
    assert.equal(shippedPayloads[0].payload.context.requestId, "req-123");
    assert.equal(shippedPayloads[0].payload.type, "exception");
    assert.equal(shippedPayloads[1].url, "https://discord.com/api/webhooks/123/secret");
    assert.equal(shippedPayloads[1].payload.allowed_mentions.parse.length, 0);
    assert.equal(shippedPayloads[1].payload.embeds[0].title, "Backend exception");
    assert.match(shippedPayloads[1].payload.embeds[0].description, /boom/);
    assert.ok(shippedPayloads[1].payload.embeds[0].fields.some(
      (field) => field.name === "Source code" && field.value === "P2024"
    ));
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
      code: "oauth-code",
      state: "oauth-state",
      callbackPath:
        "/api/auth/google/callback?oauthCode=oauth-code&state=oauth-state&invite-token=invite-token",
      nested: {
        authToken: "abc123",
      },
      error: new Error(
        "Request failed at /verify-email?token=verification-token"
      ),
    });

    assert.equal(consoleMessages.length, 1);
    const payload = JSON.parse(consoleMessages[0]);
    assert.equal(payload.password, "[REDACTED]");
    assert.equal(payload.code, "[REDACTED]");
    assert.equal(payload.state, "[REDACTED]");
    assert.equal(
      payload.callbackPath,
      "/api/auth/google/callback?oauthCode=[REDACTED]&state=[REDACTED]&invite-token=[REDACTED]"
    );
    assert.equal(payload.nested.authToken, "[REDACTED]");
    assert.doesNotMatch(payload.error.message, /verification-token/);
    assert.doesNotMatch(payload.error.stack, /verification-token/);
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    restore();
  }
});
