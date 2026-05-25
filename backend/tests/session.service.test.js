const test = require("node:test");
const assert = require("node:assert/strict");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const SESSION_COOKIE_NAME = "quest_session";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const buildService = ({
  findUniqueResult = null,
  findManyResult = [],
} = {}) => {
  const sessionModel = {
    findUniqueCalls: [],
    updateCalls: [],
    deleteManyCalls: [],
    findManyCalls: [],
    findUnique: async (args) => {
      sessionModel.findUniqueCalls.push(args);
      return findUniqueResult;
    },
    update: async (args) => {
      sessionModel.updateCalls.push(args);
      return args;
    },
    deleteMany: async (args) => {
      sessionModel.deleteManyCalls.push(args);
      return { count: 1 };
    },
    findMany: async (args) => {
      sessionModel.findManyCalls.push(args);
      return findManyResult;
    },
    create: async () => {
      throw new Error("not implemented in test");
    },
    findFirst: async () => null,
  };

  const { module, restore } = loadModuleWithMocks(
    require.resolve("../src/modules/auth/session.service"),
    {
      [require.resolve("../src/lib/prisma")]: {
        prisma: {
          session: sessionModel,
        },
      },
      [require.resolve("../src/config/env")]: {
        env: {
          NODE_ENV: "test",
          SESSION_COOKIE_NAME,
          SESSION_TTL_DAYS: 1,
          REMEMBER_ME_SESSION_TTL_DAYS: 30,
        },
      },
      [require.resolve("../src/modules/auth/auth.service")]: {
        PUBLIC_USER_SELECT: {
          id: true,
        },
      },
    }
  );

  return {
    sessionModel,
    service: module,
    restore,
  };
};

const buildRequest = (token) => ({
  headers: {
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  },
});

const buildSessionRecord = ({ expiresAt, lastSeenAt }) => ({
  id: "session-1",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  expiresAt,
  lastSeenAt,
  userAgent: "Mozilla/5.0",
  ipAddress: "127.0.0.1",
  rememberMe: false,
  user: {
    id: "user-1",
    firstName: "Quest",
    lastName: "Admin",
    email: "admin@example.com",
    username: "quest-admin",
    phone: null,
    discordTag: null,
    role: "admin",
    pendingEmail: null,
    emailVerified: true,
    emailVerifiedAt: new Date("2026-05-01T00:00:00.000Z"),
    mfaEnabled: false,
    lastLoginAt: new Date("2026-05-02T00:00:00.000Z"),
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
  },
});

test("getSessionFromRequest skips lastSeenAt writes for recently seen sessions", async () => {
  const now = Date.now();
  const { service, sessionModel, restore } = buildService({
    findUniqueResult: buildSessionRecord({
      expiresAt: new Date(now + 60_000),
      lastSeenAt: new Date(now - 60_000),
    }),
  });

  try {
    const session = await service.getSessionFromRequest(buildRequest("token-1"));

    assert.equal(session?.sessionId, "session-1");
    assert.equal(sessionModel.updateCalls.length, 0);
    assert.equal(sessionModel.findUniqueCalls.length, 1);
  } finally {
    restore();
  }
});

test("getSessionFromRequest refreshes lastSeenAt for stale sessions", async () => {
  const now = Date.now();
  const { service, sessionModel, restore } = buildService({
    findUniqueResult: buildSessionRecord({
      expiresAt: new Date(now + 60_000),
      lastSeenAt: new Date(now - FIVE_MINUTES_MS - 1_000),
    }),
  });

  try {
    const session = await service.getSessionFromRequest(buildRequest("token-2"));

    assert.equal(session?.sessionId, "session-1");
    assert.equal(sessionModel.updateCalls.length, 1);
    assert.equal(sessionModel.updateCalls[0].where.id, "session-1");
    assert.ok(sessionModel.updateCalls[0].data.lastSeenAt instanceof Date);
  } finally {
    restore();
  }
});

test("getSessionFromRequest removes expired sessions and returns null", async () => {
  const now = Date.now();
  const { service, sessionModel, restore } = buildService({
    findUniqueResult: buildSessionRecord({
      expiresAt: new Date(now - 1_000),
      lastSeenAt: new Date(now - 60_000),
    }),
  });

  try {
    const session = await service.getSessionFromRequest(buildRequest("token-3"));

    assert.equal(session, null);
    assert.equal(sessionModel.updateCalls.length, 0);
    assert.equal(sessionModel.deleteManyCalls.length, 2);
    assert.ok(
      sessionModel.deleteManyCalls.some(
        (call) => call.where?.tokenHash && typeof call.where.tokenHash === "string"
      )
    );
  } finally {
    restore();
  }
});

test("listUserSessions only queries active sessions and marks the current session", async () => {
  const futureExpiry = new Date(Date.now() + 60_000);
  const { service, sessionModel, restore } = buildService({
    findManyResult: [
      {
        id: "session-1",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-05-02T00:00:00.000Z"),
        expiresAt: futureExpiry,
        userAgent: "Mozilla/5.0",
        ipAddress: "127.0.0.1",
        rememberMe: true,
      },
    ],
  });

  try {
    const sessions = await service.listUserSessions({
      userId: "user-1",
      currentSessionId: "session-1",
    });

    assert.equal(sessionModel.findManyCalls.length, 1);
    assert.equal(sessionModel.findManyCalls[0].where.userId, "user-1");
    assert.ok(sessionModel.findManyCalls[0].where.expiresAt.gt instanceof Date);
    assert.deepEqual(sessions, [
      {
        id: "session-1",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-05-02T00:00:00.000Z"),
        expiresAt: futureExpiry,
        userAgent: "Mozilla/5.0",
        ipAddress: "127.0.0.1",
        rememberMe: true,
        isCurrent: true,
      },
    ]);
  } finally {
    restore();
  }
});
