const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const securityPath = path.join(__dirname, "../src/middleware/security.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const loadSecurityMiddleware = () =>
  loadModuleWithMocks(securityPath, {
    [envPath]: {
      env: {
        CORS_ORIGINS: ["https://app.example.com"],
        NODE_ENV: "test",
        REQUIRE_API_ORIGIN: true,
        SESSION_COOKIE_NAME: "quest_session",
      },
    },
  });

const runMiddleware = (middleware, req) =>
  new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error || null));
  });

const buildRequest = ({ path, method = "GET", headers = {} }) => ({
  path,
  method,
  headers,
});

test("strict API origin checks allow health checks and safe public GET requests", async () => {
  const { module: security, restore } = loadSecurityMiddleware();

  try {
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({
          path: "/api/health",
          headers: { cookie: "quest_session=session-token" },
        }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/health/live" }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/health/ready" }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/tournaments/quest-cup" }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/ticket-events/quest-lan" }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/events" }),
      ),
      null,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/events/quest-ascension" }),
      ),
      null,
    );
    assert.equal(
      (await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/events", method: "POST" }),
      ))?.statusCode,
      403,
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/mobile/auth/oauth/google/start" }),
      ),
      null,
    );
  } finally {
    restore();
  }
});

test("strict API origin checks still block sensitive and authenticated requests without an origin", async () => {
  const { module: security, restore } = loadSecurityMiddleware();

  try {
    const sensitiveGetError = await runMiddleware(
      security.requireAllowedApiOrigin,
      buildRequest({ path: "/api/email-verification/verify" }),
    );
    const authenticatedGetError = await runMiddleware(
      security.requireAllowedApiOrigin,
      buildRequest({
        path: "/api/me",
        headers: { cookie: "quest_session=session-token" },
      }),
    );
    const postError = await runMiddleware(
      security.requireAllowedApiOrigin,
      buildRequest({ path: "/api/contact", method: "POST" }),
    );

    assert.equal(sensitiveGetError?.statusCode, 403);
    assert.equal(authenticatedGetError?.statusCode, 403);
    assert.equal(postError?.statusCode, 403);
  } finally {
    restore();
  }
});

test("PayHere notifications are exempt from browser origin and CSRF checks", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const request = buildRequest({
      path: "/api/payments/payhere/notify",
      method: "POST",
      headers: { origin: "https://www.payhere.lk" },
    });
    assert.equal(
      await runMiddleware(security.requireAllowedApiOrigin, request),
      null,
    );
    assert.equal(
      await runMiddleware(security.protectAgainstCsrf, request),
      null,
    );
  } finally {
    restore();
  }
});

test("mobile OAuth grant exchange is exempt from browser origin and CSRF checks", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const request = buildRequest({
      path: "/api/mobile/auth/oauth/exchange",
      method: "POST",
    });
    assert.equal(
      await runMiddleware(security.requireAllowedApiOrigin, request),
      null,
    );
    assert.equal(
      await runMiddleware(security.protectAgainstCsrf, request),
      null,
    );
  } finally {
    restore();
  }
});

test("origin and CSRF checks accept the configured origin and reject a foreign origin", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const allowed = buildRequest({
      path: "/api/change-password",
      method: "POST",
      headers: { origin: "https://app.example.com" },
    });
    const foreign = buildRequest({
      path: "/api/change-password",
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    assert.equal(
      await runMiddleware(security.requireAllowedApiOrigin, allowed),
      null,
    );
    assert.equal(
      await runMiddleware(security.protectAgainstCsrf, allowed),
      null,
    );
    assert.equal(
      (await runMiddleware(security.requireAllowedApiOrigin, foreign))
        ?.statusCode,
      403,
    );
    assert.equal(
      (await runMiddleware(security.protectAgainstCsrf, foreign))?.statusCode,
      403,
    );
  } finally {
    restore();
  }
});

test("CSRF protection blocks cookie-authenticated writes without origin", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const error = await runMiddleware(
      security.protectAgainstCsrf,
      buildRequest({
        path: "/api/change-password",
        method: "POST",
        headers: { cookie: "other=1; quest_session=session-token" },
      }),
    );
    assert.equal(error?.statusCode, 403);
  } finally {
    restore();
  }
});

test("native bearer sessions can call protected APIs without a browser origin", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const request = buildRequest({
      path: "/api/admin/orders",
      method: "PATCH",
      headers: { authorization: `Bearer ${"a".repeat(96)}` },
    });

    assert.equal(
      await runMiddleware(security.requireAllowedApiOrigin, request),
      null,
    );
    assert.equal(
      await runMiddleware(security.protectAgainstCsrf, request),
      null,
    );
  } finally {
    restore();
  }
});

test("bearer headers cannot bypass browser protections when a session cookie is present", async () => {
  const { module: security, restore } = loadSecurityMiddleware();
  try {
    const request = buildRequest({
      path: "/api/admin/orders",
      method: "PATCH",
      headers: {
        cookie: "quest_session=browser-token",
        authorization: `Bearer ${"a".repeat(96)}`,
      },
    });

    assert.equal(
      (await runMiddleware(security.requireAllowedApiOrigin, request))
        ?.statusCode,
      403,
    );
    assert.equal(
      (await runMiddleware(security.protectAgainstCsrf, request))?.statusCode,
      403,
    );
  } finally {
    restore();
  }
});

test("security headers include API CSP and production transport protection", () => {
  const productionLoad = loadModuleWithMocks(securityPath, {
    [envPath]: {
      env: {
        CORS_ORIGINS: ["https://app.example.com"],
        NODE_ENV: "production",
        REQUIRE_API_ORIGIN: true,
        SESSION_COOKIE_NAME: "quest_session",
      },
    },
  });
  const headers = new Map();
  try {
    productionLoad.module.setSecurityHeaders(
      buildRequest({ path: "/api/health" }),
      { setHeader: (name, value) => headers.set(name, value) },
      () => {},
    );
    assert.match(headers.get("Content-Security-Policy"), /default-src 'none'/);
    assert.match(headers.get("Strict-Transport-Security"), /max-age=31536000/);
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(headers.get("Cache-Control"), "no-store");
  } finally {
    productionLoad.restore();
  }
});
