const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const middlewarePath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const sessionServicePath = path.join(__dirname, "../src/modules/auth/session.service.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

test("attachSession loads an authenticated session only once per request", async () => {
  let lookupCount = 0;
  const session = {
    sessionId: "session-1",
    user: { id: "user-1", role: "user", emailVerified: true },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [sessionServicePath]: {
      getSessionFromRequest: async () => {
        lookupCount += 1;
        return session;
      },
    },
    [loggerPath]: { logger: { warn: () => {} } },
  });

  try {
    const req = {};
    const nextErrors = [];
    const next = (error) => nextErrors.push(error || null);

    await middleware.attachSession(req, {}, next);
    await middleware.attachSession(req, {}, next);

    assert.equal(lookupCount, 1);
    assert.equal(req.session, session);
    assert.equal(req.user, session.user);
    assert.deepEqual(nextErrors, [null, null]);
  } finally {
    restore();
  }
});

test("attachSession remembers an anonymous lookup for the rest of the request", async () => {
  let lookupCount = 0;
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [sessionServicePath]: {
      getSessionFromRequest: async () => {
        lookupCount += 1;
        return null;
      },
    },
    [loggerPath]: { logger: { warn: () => {} } },
  });

  try {
    const req = {};
    await middleware.attachSession(req, {}, () => {});
    await middleware.attachSession(req, {}, () => {});

    assert.equal(lookupCount, 1);
    assert.equal(req.session, null);
    assert.equal(req.user, null);
  } finally {
    restore();
  }
});

test("authentication and role middleware deny missing or insufficient credentials", () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [sessionServicePath]: { getSessionFromRequest: async () => null },
    [loggerPath]: { logger: { warn: () => {} } },
  });

  try {
    const run = (handler, req) => {
      let result = "allowed";
      handler(req, {}, (error) => {
        result = error || null;
      });
      return result;
    };

    assert.equal(run(middleware.requireAuth, { user: null }).statusCode, 401);
    assert.equal(
      run(middleware.requireAdmin, { user: { id: "user-1", role: "user" }, method: "GET", originalUrl: "/api/admin/users", ip: "127.0.0.1" }).statusCode,
      403
    );
    assert.equal(
      run(middleware.requireVerifiedEmail, { user: { id: "user-1", emailVerified: false } }).statusCode,
      403
    );
    assert.equal(run(middleware.requireAdmin, { user: { id: "admin-1", role: "admin" } }), null);
  } finally {
    restore();
  }
});
