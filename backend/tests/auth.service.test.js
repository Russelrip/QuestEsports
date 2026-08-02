const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const tokensModulePath = path.join(__dirname, "../src/lib/tokens.js");
const secretBoxModulePath = path.join(__dirname, "../src/lib/secret-box.js");
const totpModulePath = path.join(__dirname, "../src/lib/totp.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");
const envModulePath = path.join(__dirname, "../src/config/env.js");
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
  mfaEnabled: true,
  lastLoginAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  mfaCredential: {
    secretCiphertext: "encrypted-secret",
  },
};

const challenge = {
  id: "challenge-1",
  userId: "user-1",
  rememberMe: true,
  user,
};

const loadAuthService = ({
  challengeUpdateCount = 1,
  backupUpdateCount = 1,
  prismaOverride,
  additionalMocks = {},
} = {}) => {
  const calls = [];
  const tx = {
    loginChallenge: {
      updateMany: async (args) => {
        calls.push(["challenge", args]);
        return { count: challengeUpdateCount };
      },
    },
    backupCode: {
      updateMany: async (args) => {
        calls.push(["backup", args]);
        return { count: backupUpdateCount };
      },
    },
  };
  const prisma = prismaOverride || {
    loginChallenge: {
      findFirst: async (args) => {
        calls.push(["findChallenge", args]);
        return challenge;
      },
    },
    $transaction: async (callback) => callback(tx),
  };
  const { module, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [tokensModulePath]: {
      createTokenPair: () => ({
        rawToken: "raw-token",
        tokenHash: "hash:raw-token",
        expiresAt: new Date(Date.now() + 60_000),
      }),
      hashToken: (token) => `hash:${token}`,
    },
    [secretBoxModulePath]: {
      decryptSecret: () => "totp-secret",
      encryptSecret: (value) => value,
    },
    [totpModulePath]: {
      generateTotpSecret: () => "totp-secret",
      verifyTotpCode: () => true,
      buildOtpAuthUrl: () => "otpauth://totp/quest",
    },
    [loggerModulePath]: {
      logger: {
        error: () => {},
        warn: () => {},
      },
    },
    [envModulePath]: {
      env: {
        MFA_ISSUER: "Quest E-sports",
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

  return {
    module,
    restore,
    calls,
  };
};

test("completeMfaLogin consumes the challenge and recovery code in one transaction", async () => {
  const { module: authService, restore, calls } = loadAuthService();

  try {
    const result = await authService.completeMfaLogin({
      body: {
        challengeToken: "challenge-token",
        backupCode: "ABCD-1234",
      },
    });

    assert.equal(result.userId, "user-1");
    assert.equal(result.rememberMe, true);
    assert.equal(result.usedRecoveryCode, true);
    assert.equal(calls[0][0], "findChallenge");
    assert.equal(calls[1][0], "challenge");
    assert.equal(calls[2][0], "backup");
    assert.equal(calls[1][1].where.id, "challenge-1");
    assert.equal(calls[1][1].where.usedAt, null);
    assert.equal(calls[2][1].where.codeHash, "hash:ABCD1234");
  } finally {
    restore();
  }
});

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

test("completeMfaLogin rejects reused challenges without consuming recovery codes", async () => {
  const { module: authService, restore, calls } = loadAuthService({
    challengeUpdateCount: 0,
  });

  try {
    await assert.rejects(
      authService.completeMfaLogin({
        body: {
          challengeToken: "challenge-token",
          backupCode: "ABCD-1234",
        },
      }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "This verification challenge is invalid or has expired."
    );

    assert.deepEqual(
      calls.map(([name]) => name),
      ["findChallenge", "challenge"]
    );
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
    user: { ...user, id: "admin-1", role: "admin", mfaEnabled: false },
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

test("beginMfaSetup requires the current password before revealing a secret", async () => {
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      user: {
        findUnique: async () => {
          throw new Error("The database must not be queried without a password.");
        },
      },
    },
  });

  try {
    await assert.rejects(
      authService.beginMfaSetup({ currentUser: { id: "user-1" }, body: {} }),
      (error) => error.statusCode === 400 && error.message === "Current password is required."
    );
  } finally {
    restore();
  }
});

test("beginMfaSetup verifies the current password before storing a new secret", async () => {
  const upserts = [];
  const { module: authService, restore } = loadAuthService({
    prismaOverride: {
      user: {
        findUnique: async () => ({
          ...user,
          mfaEnabled: false,
          passwordHash: "stored-password-hash",
        }),
      },
      mfaCredential: {
        upsert: async (args) => upserts.push(args),
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
    await assert.rejects(
      authService.beginMfaSetup({
        currentUser: { id: "user-1" },
        body: { currentPassword: "wrong-password" },
      }),
      (error) => error.statusCode === 401 && error.message === "Current password is incorrect."
    );
    assert.equal(upserts.length, 0);

    const setup = await authService.beginMfaSetup({
      currentUser: { id: "user-1" },
      body: { currentPassword: "correct-password" },
    });
    assert.equal(setup.secret, "totp-secret");
    assert.equal(setup.otpauthUrl, "otpauth://totp/quest");
    assert.equal(upserts.length, 1);
  } finally {
    restore();
  }
});
