const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const tokensModulePath = path.join(__dirname, "../src/lib/tokens.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");
const verificationEmailModulePath = path.join(
  __dirname,
  "../src/lib/mail/sendVerificationEmail.js"
);
const emailChangeModulePath = path.join(
  __dirname,
  "../src/lib/mail/sendEmailChangeEmail.js"
);
const resetPasswordModulePath = path.join(
  __dirname,
  "../src/lib/mail/sendResetPasswordEmail.js"
);
const securityEventModulePath = path.join(
  __dirname,
  "../src/lib/mail/sendSecurityEventEmail.js"
);

const user = {
  id: "user-1",
  firstName: "Team",
  lastName: "Captain",
  email: "captain@example.com",
  username: "captain",
  phone: null,
  discordTag: null,
  role: "user",
  pendingEmail: null,
  emailVerified: true,
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const loadAuthService = ({ prismaOverride, additionalMocks = {} } = {}) => {
  const { module, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: prismaOverride || {} },
    [tokensModulePath]: {
      createTokenPair: () => ({
        rawToken: "raw-token",
        tokenHash: "hash:raw-token",
        expiresAt: new Date(Date.now() + 60_000),
      }),
      hashToken: (token) => `hash:${token}`,
    },
    [loggerModulePath]: {
      logger: {
        error: () => {},
        warn: () => {},
      },
    },
    [verificationEmailModulePath]: {
      sendVerificationEmail: async () => undefined,
    },
    [emailChangeModulePath]: {
      sendEmailChangeEmail: async () => undefined,
    },
    [resetPasswordModulePath]: {
      sendResetPasswordEmail: async () => undefined,
    },
    [securityEventModulePath]: {
      sendSecurityEventEmail: async () => undefined,
    },
    ...additionalMocks,
  });

  return { module, restore };
};

test("authenticateUser performs a dummy password comparison for unknown accounts", async () => {
  const comparisons = [];
  const warnings = [];
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      user: { findFirst: async () => null },
    },
    additionalMocks: {
      [require.resolve("bcryptjs")]: {
        compare: async (password, hash) => {
          comparisons.push({ password, hash });
          return false;
        },
      },
      [loggerModulePath]: {
        logger: {
          error: () => {},
          warn: (_message, metadata) => warnings.push(metadata),
        },
      },
    },
  });

  try {
    await assert.rejects(
      authService.authenticateUser({
        body: { emailOrUsername: "missing@example.com", password: "password" },
      }),
      (error) => error.statusCode === 401 && error.message === "Invalid credentials."
    );
    assert.equal(comparisons.length, 1);
    assert.equal(comparisons[0].password, "password");
    assert.match(comparisons[0].hash, /^\$2b\$10\$/);
    assert.equal(warnings[0].emailOrUsername, undefined);
    assert.match(warnings[0].identifierFingerprint, /^[a-f0-9]{16}$/);
  } finally {
    restore();
  }
});

test("authenticateUser returns a direct login result after valid credentials", async () => {
  const updates = [];
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      user: {
        findFirst: async () => ({ ...user, passwordHash: "stored-password-hash" }),
        update: async (args) => updates.push(args),
      },
    },
    additionalMocks: {
      [require.resolve("bcryptjs")]: {
        compare: async (password, hash) =>
          password === "correct-password" && hash === "stored-password-hash",
      },
    },
  });

  try {
    const result = await authService.authenticateUser({
      body: {
        emailOrUsername: "captain",
        password: "correct-password",
        remember: true,
      },
    });

    assert.equal(result.userId, "user-1");
    assert.equal(result.rememberMe, true);
    assert.equal(result.user.username, "captain");
    assert.equal(updates.length, 1);
  } finally {
    restore();
  }
});

test("createMobileOAuthGrant stores only a short-lived token hash", async () => {
  const calls = [];
  const tx = {
    mobileOAuthGrant: {
      updateMany: async (args) => calls.push(["invalidate", args]),
      create: async (args) => calls.push(["create", args]),
    },
  };
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      $transaction: async (callback) => callback(tx),
    },
  });

  try {
    const result = await authService.createMobileOAuthGrant({
      userId: "admin-1",
      provider: "google",
    });

    assert.equal(result.token, "raw-token");
    assert.equal(calls[0][0], "invalidate");
    assert.equal(calls[1][0], "create");
    assert.equal(calls[1][1].data.userId, "admin-1");
    assert.equal(calls[1][1].data.provider, "google");
    assert.equal(calls[1][1].data.tokenHash, "hash:raw-token");
    assert.deepEqual(Object.keys(calls[1][1].data).sort(), [
      "expiresAt",
      "id",
      "provider",
      "tokenHash",
      "userId",
    ]);
  } finally {
    restore();
  }
});

test("consumeMobileOAuthGrant atomically rejects a reused one-time grant", async () => {
  const updates = [];
  const grant = {
    id: "grant-1",
    provider: "discord",
    user: { ...user, id: "admin-1", role: "admin" },
  };
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      mobileOAuthGrant: {
        findFirst: async (args) => {
          assert.equal(args.where.tokenHash, "hash:one-time-grant");
          return grant;
        },
        updateMany: async (args) => {
          updates.push(args);
          return { count: 0 };
        },
      },
    },
  });

  try {
    await assert.rejects(
      authService.consumeMobileOAuthGrant({ token: "one-time-grant" }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "This mobile sign-in has expired or was already used."
    );
    assert.equal(updates[0].where.id, "grant-1");
    assert.equal(updates[0].where.usedAt, null);
  } finally {
    restore();
  }
});

test("admin profile updates validate the target user's email", async () => {
  const calls = [];
  const target = { ...user, email: "target@example.com", username: "target" };
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      user: {
        findUnique: async () => ({ id: target.id, email: target.email }),
        findFirst: async () => null,
        update: async (args) => {
          calls.push(args);
          return { ...target, ...args.data };
        },
      },
    },
  });

  try {
    const updated = await authService.updateUserProfile({
      requestedUserId: target.id,
      currentUser: { ...user, id: "admin-1", role: "admin", email: "not-an-email" },
      body: { firstName: "Target", lastName: "User", username: "target-user" },
    });
    assert.equal(updated.username, "target-user");
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("mapUserForResponse preserves an avatar URL from an already-mapped session user", () => {
  const { module: authService, restore } = loadAuthService();
  try {
    const mapped = authService.mapUserForResponse({
      ...user,
      avatarUrl: "/api/uploads/avatars/player.webp",
    });
    assert.equal(mapped.avatarUrl, "/api/uploads/avatars/player.webp");
  } finally {
    restore();
  }
});
