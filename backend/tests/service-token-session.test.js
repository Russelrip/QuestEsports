const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const sessionServicePath = path.join(__dirname, "../src/modules/auth/session.service.js");
const middlewarePath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const serviceAccountPath = path.join(__dirname, "../src/modules/service-accounts/service-account.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const { requestAuditSource } = require("../src/lib/audit");

const SERVICE_TOKEN = `qsa_${"A".repeat(64)}`;
const botUser = { id: "bot-1", role: "user", isServiceAccount: true, emailVerified: true };

const loadSessionService = () => {
  const serviceLookups = [];
  const sessionLookups = [];
  const { module, restore } = loadModuleWithMocks(sessionServicePath, {
    [envPath]: { env: { SESSION_COOKIE_NAME: "quest_session", WRITE_FREEZE_MODE: "validation" } },
    [loggerPath]: { logger: { warn: () => {}, error: () => {}, info: () => {} } },
    [prismaPath]: {
      prisma: {
        session: {
          findUnique: async (args) => {
            sessionLookups.push(args);
            return null;
          },
        },
      },
    },
    [serviceAccountPath]: {
      authenticateServiceToken: async (token, meta) => {
        serviceLookups.push({ token, meta });
        return token === SERVICE_TOKEN
          ? { serviceTokenId: "token-1", expiresAt: new Date("2027-01-01"), user: botUser }
          : null;
      },
    },
  });
  return { service: module, restore, serviceLookups, sessionLookups };
};

test("a service token resolves to its service account without touching sessions", async () => {
  const { service, restore, serviceLookups, sessionLookups } = loadSessionService();
  try {
    const session = await service.getSessionFromRequest({
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
      ip: "10.0.0.5",
    });

    assert.equal(session.source, "service_token");
    assert.equal(session.serviceTokenId, "token-1");
    assert.equal(session.user, botUser);
    // Nothing for logout to delete: a service token is revoked, not signed out.
    assert.equal(session.token, null);
    assert.deepEqual(serviceLookups, [{ token: SERVICE_TOKEN, meta: { ipAddress: "10.0.0.5" } }]);
    assert.equal(sessionLookups.length, 0);
  } finally {
    restore();
  }
});

test("a rejected service token is anonymous, not an error", async () => {
  const { service, restore, sessionLookups } = loadSessionService();
  try {
    const session = await service.getSessionFromRequest({
      headers: { authorization: `Bearer qsa_${"B".repeat(64)}` },
    });
    assert.equal(session, null);
    assert.equal(sessionLookups.length, 0, "a service-shaped token is never tried as a session");
  } finally {
    restore();
  }
});

test("a browser cookie always wins over a service token", async () => {
  const { service, restore, serviceLookups, sessionLookups } = loadSessionService();
  try {
    await service.getSessionFromRequest({
      headers: { cookie: "quest_session=browser-token", authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    assert.equal(serviceLookups.length, 0);
    assert.equal(sessionLookups.length, 1);
  } finally {
    restore();
  }
});

test("a session bearer token is still looked up as a session", async () => {
  const { service, restore, serviceLookups, sessionLookups } = loadSessionService();
  try {
    await service.getSessionFromRequest({ headers: { authorization: `Bearer ${"a".repeat(96)}` } });
    assert.equal(serviceLookups.length, 0);
    assert.equal(sessionLookups.length, 1);
  } finally {
    restore();
  }
});

test("attachSession marks a service-token request so the audit log records it as a bot", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [sessionServicePath]: {
      getSessionFromRequest: async () => ({ source: "service_token", serviceTokenId: "token-1", user: botUser }),
    },
    [loggerPath]: { logger: { warn: () => {} } },
  });
  try {
    const req = { originalUrl: "/api/admin/team-registrations/r-1/roster" };
    await middleware.attachSession(req, {}, () => {});

    assert.equal(req.serviceToken, "token-1");
    assert.equal(requestAuditSource(req), "bot");
  } finally {
    restore();
  }
});

test("attachSession leaves a person's request unmarked", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [sessionServicePath]: {
      getSessionFromRequest: async () => ({ sessionId: "session-1", user: { id: "user-1", role: "admin" } }),
    },
    [loggerPath]: { logger: { warn: () => {} } },
  });
  try {
    const req = { originalUrl: "/api/admin/orders" };
    await middleware.attachSession(req, {}, () => {});

    assert.equal(req.serviceToken, null);
    assert.equal(requestAuditSource(req), "admin");
  } finally {
    restore();
  }
});
