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
        })
      ),
      null
    );
    assert.equal(
      await runMiddleware(
        security.requireAllowedApiOrigin,
        buildRequest({ path: "/api/tournaments/quest-cup" })
      ),
      null
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
      buildRequest({ path: "/api/email-verification/verify" })
    );
    const authenticatedGetError = await runMiddleware(
      security.requireAllowedApiOrigin,
      buildRequest({
        path: "/api/me",
        headers: { cookie: "quest_session=session-token" },
      })
    );
    const postError = await runMiddleware(
      security.requireAllowedApiOrigin,
      buildRequest({ path: "/api/contact", method: "POST" })
    );

    assert.equal(sensitiveGetError?.statusCode, 403);
    assert.equal(authenticatedGetError?.statusCode, 403);
    assert.equal(postError?.statusCode, 403);
  } finally {
    restore();
  }
});
