const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  USER_KEYS,
  buildCleanupWhere,
  buildManifest,
  buildUserCreateData,
  clearStaleRateLimitBuckets,
  createFixtureSeed,
  deleteFixtureRows,
  getCleanupConfiguration,
  getPrepareConfiguration,
  getMigrationInvocation,
  parseArguments,
  PREPARE_SUCCESS_MARKER,
  prepareFixtures,
  serializeManifest,
  writeManifest,
  writeManifestWithRollback,
  validateDisposableDatabaseUrl,
} = require("../scripts/oauth-e2e-fixtures");

const buildEnvironment = (overrides = {}) => ({
  NODE_ENV: "test",
  OAUTH_E2E_DATABASE_URL: "postgresql://fixture:secret@127.0.0.1/quest_e2e",
  SESSION_COOKIE_NAME: "quest_session",
  ...overrides,
});

test("creates a deterministic run-scoped fixture shape with injected randomness", () => {
  let randomBytesCall = 0;
  const seed = createFixtureSeed({
    runId: "run-123",
    randomUUID: (() => {
      let call = 0;
      return () => `00000000-0000-4000-8000-${String(++call).padStart(12, "0")}`;
    })(),
    randomBytes: (size) => Buffer.alloc(size, ++randomBytesCall),
  });

  assert.equal(seed.runId, "run-123");
  assert.deepEqual(Object.keys(seed.users), USER_KEYS);
  assert.equal(new Set(Object.values(seed.users).map((user) => user.id)).size, 5);
  assert.equal(new Set(Object.values(seed.users).map((user) => user.email)).size, 5);
  assert.equal(new Set(Object.values(seed.users).map((user) => user.username)).size, 5);
  assert.ok(seed.collisionProviderUserId.includes("run-123"));
  assert.ok(seed.lastMethodProviderUserId.includes("run-123"));
  for (const key of USER_KEYS) {
    assert.match(seed.users[key].email, /^oauth-e2e-run-123-[a-z-]+@example\.test$/);
    assert.equal(typeof seed.users[key].password, "string");
  }
});

test("marks only real-password users with passwordSetAt", () => {
  const verifiedAt = new Date("2026-08-19T00:00:00.000Z");
  const seed = createFixtureSeed({ runId: "marker-test" });

  for (const key of USER_KEYS) {
    const data = buildUserCreateData({
      user: seed.users[key],
      passwordHash: `hash-${key}`,
      verifiedAt,
      key,
    });
    assert.equal(data.emailVerified, true);
    assert.equal(data.emailVerifiedAt, verifiedAt);
    if (key === "lastMethod") {
      assert.equal(Object.hasOwn(data, "passwordSetAt"), false);
    } else {
      assert.equal(data.passwordSetAt, verifiedAt);
    }
  }
});

test("serializes one manifest without hashes or logging metadata", () => {
  const seed = createFixtureSeed({ runId: "serialization-test" });
  const manifest = buildManifest({
    runId: seed.runId,
    sessionCookieName: "quest_session",
    users: seed.users,
    collisionProviderUserId: seed.collisionProviderUserId,
    lastMethodCookie: "quest_session=token-value",
  });
  const serialized = serializeManifest(manifest);
  const parsed = JSON.parse(serialized);

  assert.deepEqual(Object.keys(parsed), [
    "runId",
    "sessionCookieName",
    "users",
    "collisionProviderUserId",
    "lastMethodCookie",
  ]);
  assert.equal(serialized.split("\n").length, 2);
  assert.equal(serialized.includes("passwordHash"), false);
  assert.equal(serialized.includes("passwordSetAt"), false);
  assert.equal(serialized.includes("console"), false);
  assert.equal(parsed.users.link.password, seed.users.link.password);
});

test("builds cleanup where clauses from only manifest user IDs", () => {
  const manifest = {
    users: Object.fromEntries(
      USER_KEYS.map((key, index) => [
        key,
        {
          id: `user-${index + 1}`,
          email: `email-${index}@example.test`,
        },
      ])
    ),
  };
  const where = buildCleanupWhere(manifest);

  assert.deepEqual(where.userIds, ["user-1", "user-2", "user-3", "user-4", "user-5"]);
  assert.deepEqual(where.oauthAccount, { userId: { in: where.userIds } });
  assert.deepEqual(where.session, { userId: { in: where.userIds } });
  assert.deepEqual(where.user, { id: { in: where.userIds } });
  assert.equal(JSON.stringify(where).includes("email"), false);
  assert.equal(JSON.stringify(where).includes("run"), false);
});

test("requires a dedicated OAuth E2E database URL and test mode", () => {
  assert.throws(
    () => getPrepareConfiguration(buildEnvironment({ OAUTH_E2E_DATABASE_URL: "" })),
    /OAUTH_E2E_DATABASE_URL/
  );
  assert.throws(
    () => getPrepareConfiguration(buildEnvironment({ NODE_ENV: "production" })),
    /NODE_ENV=test/
  );
  assert.throws(
    () => getPrepareConfiguration(buildEnvironment({ NODE_ENV: "development" })),
    /NODE_ENV=test/
  );
});

test("requires a loopback disposable database with a test-like database name", () => {
  assert.throws(
    () => validateDisposableDatabaseUrl(
      "OAUTH_E2E_DATABASE_URL",
      "postgresql://fixture:secret@db.example.com:5432/quest_e2e",
    ),
    /loopback database host/,
  );
  assert.throws(
    () => validateDisposableDatabaseUrl(
      "OAUTH_E2E_DATABASE_URL",
      "postgresql://fixture:secret@127.0.0.1:5432/quest",
    ),
    /database name must contain test, e2e, or oauth/,
  );
  assert.throws(
    () => getCleanupConfiguration(
      buildEnvironment({
        OAUTH_E2E_DATABASE_URL: "postgresql://fixture:secret@localhost:5432/production",
      }),
    ),
    /database name must contain test, e2e, or oauth/,
  );
  assert.throws(
    () => getPrepareConfiguration(buildEnvironment({
      OAUTH_E2E_DIRECT_URL: "postgresql://fixture:secret@db.example.com:5432/quest_e2e",
    })),
    /OAUTH_E2E_DIRECT_URL must use a loopback database host/,
  );
  assert.doesNotThrow(() => getPrepareConfiguration(buildEnvironment({
    OAUTH_E2E_DATABASE_URL: "postgresql://fixture:secret@[::1]:5432/Quest_OAuth",
  })));
});

test("defaults the direct migration URL to the dedicated database URL", () => {
  const configuration = getPrepareConfiguration(buildEnvironment());
  assert.equal(configuration.directUrl, configuration.databaseUrl);
});

test("clears rate-limit buckets when available and tolerates minimal Prisma seams", async () => {
  let argumentsValue;
  await clearStaleRateLimitBuckets({
    rateLimitBucket: {
      deleteMany: async (value) => {
        argumentsValue = value;
      },
    },
  }, buildEnvironment());
  await clearStaleRateLimitBuckets({}, buildEnvironment());
  await assert.rejects(
    clearStaleRateLimitBuckets({}, buildEnvironment({ NODE_ENV: "production" })),
    /NODE_ENV=test/,
  );
  assert.deepEqual(argumentsValue, {});
});

test("requires a manifest path for both CLI commands and exposes only a safe prepare marker", () => {
  assert.deepEqual(
    parseArguments(["prepare", "--manifest", "fixtures/manifest.json"]),
    { command: "prepare", manifestPath: path.resolve("fixtures/manifest.json") },
  );
  assert.deepEqual(
    parseArguments(["cleanup", "--manifest", "fixtures/manifest.json"]),
    { command: "cleanup", manifestPath: path.resolve("fixtures/manifest.json") },
  );
  assert.throws(() => parseArguments(["prepare"]), /prepare --manifest <path>/);
  assert.match(PREPARE_SUCCESS_MARKER, /^OAuth E2E fixture prepare succeeded\.$/);
  assert.doesNotMatch(PREPARE_SUCCESS_MARKER, /password|cookie|postgres/i);
});

test("writes manifests with restrictive permissions and rolls back on write failure", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-fixture-test-"));
  const manifestPath = path.join(temporaryDirectory, "manifest.json");
  const seed = createFixtureSeed({ runId: "manifest-file-test" });
  const manifest = buildManifest({
    runId: seed.runId,
    sessionCookieName: "quest_session",
    users: seed.users,
    collisionProviderUserId: seed.collisionProviderUserId,
    lastMethodCookie: "quest_session=token-value",
  });

  try {
    writeManifest(manifestPath, manifest);
    const mode = fs.statSync(manifestPath).mode & 0o777;
    if (process.platform !== "win32") assert.equal(mode & 0o077, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")), manifest);

    const primaryError = new Error("manifest write failed");
    const cleanupCalls = [];
    await assert.rejects(
      writeManifestWithRollback({
        manifestPath: path.join(temporaryDirectory, "missing", "manifest.json"),
        manifest,
        cleanup: async ({ manifest: cleanupManifest }) => {
          cleanupCalls.push(cleanupManifest);
        },
        write: () => {
          throw primaryError;
        },
      }),
      (error) => error === primaryError,
    );
    assert.equal(cleanupCalls.length, 1);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("uses a shell only for the Windows npx command script", () => {
  const invocation = getMigrationInvocation();

  assert.equal(invocation.command, process.platform === "win32" ? "npx.cmd" : "npx");
  assert.equal(invocation.shell, process.platform === "win32");
});

test("prepares rows with bcrypt cost 10 and creates the reusable session through the seam", async () => {
  const createdUsers = [];
  const createdOAuthAccounts = [];
  let migrationCalled = false;
  let sessionArguments;
  let rateLimitArguments;
  const transactionClient = {
    user: {
      create: async ({ data }) => {
        createdUsers.push(data);
        return data;
      },
    },
    oAuthAccount: {
      create: async ({ data }) => {
        createdOAuthAccounts.push(data);
        return data;
      },
    },
  };
  const dependencies = {
    prisma: {
      $transaction: async (callback) => callback(transactionClient),
      rateLimitBucket: {
        deleteMany: async (argumentsValue) => {
          rateLimitArguments = argumentsValue;
        },
      },
    },
    createSession: async (argumentsValue) => {
      sessionArguments = argumentsValue;
      return { token: "raw-session-token" };
    },
  };

  const manifest = await prepareFixtures({
    environment: buildEnvironment({ OAUTH_E2E_RUN_ID: "prepare-test" }),
    dependencies,
    migrate: async () => {
      migrationCalled = true;
    },
    now: new Date("2026-08-19T00:00:00.000Z"),
  });

  assert.equal(migrationCalled, true);
  assert.deepEqual(rateLimitArguments, {});
  assert.equal(createdUsers.length, 5);
  assert.equal(createdOAuthAccounts.length, 1);
  assert.match(createdUsers[0].passwordHash, /^\$2b\$10\$/);
  assert.equal(createdOAuthAccounts[0].provider, "google");
  assert.deepEqual(sessionArguments, {
    userId: manifest.users.lastMethod.id,
    rememberMe: true,
    userAgent: "oauth-e2e-fixture",
  });
  assert.equal(manifest.lastMethodCookie, "quest_session=raw-session-token");
});

test("deletes OAuth accounts and sessions before users", async () => {
  const calls = [];
  const manifest = {
    users: Object.fromEntries(
      USER_KEYS.map((key, index) => [key, { id: `id-${index + 1}` }])
    ),
  };
  const transactionClient = {
    oAuthAccount: {
      deleteMany: async (argumentsValue) => calls.push(["oauth", argumentsValue]),
    },
    session: {
      deleteMany: async (argumentsValue) => calls.push(["session", argumentsValue]),
    },
    user: {
      deleteMany: async (argumentsValue) => calls.push(["user", argumentsValue]),
    },
  };

  await deleteFixtureRows(
    { $transaction: async (callback) => callback(transactionClient) },
    manifest
  );

  assert.deepEqual(calls.map(([model]) => model), ["oauth", "session", "user"]);
  for (const [, argumentsValue] of calls) {
    assert.deepEqual(argumentsValue.where.userId || argumentsValue.where.id, {
      in: ["id-1", "id-2", "id-3", "id-4", "id-5"],
    });
  }
});

test("cleans generated rows when session creation fails and preserves the original error", async () => {
  const deletedRows = [];
  const transactionClient = {
    user: {
      create: async ({ data }) => data,
      deleteMany: async ({ where }) => deletedRows.push(["user", where]),
    },
    oAuthAccount: {
      create: async ({ data }) => data,
      deleteMany: async ({ where }) => deletedRows.push(["oauth", where]),
    },
    session: {
      deleteMany: async ({ where }) => deletedRows.push(["session", where]),
    },
  };
  const sessionError = new Error("session creation failed");

  await assert.rejects(
    prepareFixtures({
      environment: buildEnvironment({ OAUTH_E2E_RUN_ID: "session-failure" }),
      dependencies: {
        prisma: {
          $transaction: async (callback) => callback(transactionClient),
        },
        createSession: async () => {
          throw sessionError;
        },
      },
      migrate: async () => undefined,
    }),
    (error) => error === sessionError
  );

  assert.deepEqual(deletedRows.map(([model]) => model), ["oauth", "session", "user"]);
  const generatedUserIds = deletedRows[0][1].userId.in;
  assert.equal(generatedUserIds.length, 5);
  assert.deepEqual(deletedRows[1][1].userId.in, generatedUserIds);
  assert.deepEqual(deletedRows[2][1].id.in, generatedUserIds);
});

test("rolls back partial inserts when user creation fails without a transaction", async () => {
  const deletedRows = [];
  let createdCount = 0;
  const prisma = {
    user: {
      create: async ({ data }) => {
        createdCount += 1;
        if (createdCount === 3) throw new Error("user insert failed");
        return data;
      },
      deleteMany: async ({ where }) => deletedRows.push(["user", where]),
    },
    oAuthAccount: {
      create: async ({ data }) => data,
      deleteMany: async ({ where }) => deletedRows.push(["oauth", where]),
    },
    session: {
      deleteMany: async ({ where }) => deletedRows.push(["session", where]),
    },
  };
  const insertError = new Error("user insert failed");

  await assert.rejects(
    prepareFixtures({
      environment: buildEnvironment({ OAUTH_E2E_RUN_ID: "partial-insert-failure" }),
      dependencies: { prisma, createSession: async () => ({ token: "unused" }) },
      migrate: async () => undefined,
    }),
    (error) => error.message === insertError.message,
  );

  assert.deepEqual(deletedRows.map(([model]) => model), ["oauth", "session", "user"]);
  assert.equal(deletedRows[0][1].userId.in.length, USER_KEYS.length);
});

test("rolls back generated rows when Prisma disconnect fails and preserves that error", async () => {
  const deletedRows = [];
  const transactionClient = {
    user: {
      create: async ({ data }) => data,
      deleteMany: async ({ where }) => deletedRows.push(["user", where]),
    },
    oAuthAccount: {
      create: async ({ data }) => data,
      deleteMany: async ({ where }) => deletedRows.push(["oauth", where]),
    },
    session: {
      deleteMany: async ({ where }) => deletedRows.push(["session", where]),
    },
  };
  const disconnectError = new Error("disconnect failed");

  await assert.rejects(
    prepareFixtures({
      environment: buildEnvironment({ OAUTH_E2E_RUN_ID: "disconnect-failure" }),
      dependencies: {
        prisma: { $transaction: async (callback) => callback(transactionClient) },
        createSession: async () => ({ token: "raw-session-token" }),
      },
      disconnectRuntime: async () => {
        throw disconnectError;
      },
      migrate: async () => undefined,
    }),
    (error) => error === disconnectError,
  );

  assert.deepEqual(deletedRows.map(([model]) => model), ["oauth", "session", "user"]);
});

test("preserves the primary prepare error when generated-row rollback cannot be verified", async () => {
  const primaryError = new Error("session creation failed");
  const rollbackError = new Error("rollback failed");
  let transactionCalls = 0;
  const transactionClient = {
    user: { create: async ({ data }) => data },
    oAuthAccount: { create: async ({ data }) => data },
    session: {},
  };
  const prisma = {
    $transaction: async (callback) => {
      transactionCalls += 1;
      if (transactionCalls === 2) throw rollbackError;
      return callback(transactionClient);
    },
    user: { deleteMany: async () => undefined },
    oAuthAccount: { deleteMany: async () => undefined },
    session: { deleteMany: async () => undefined },
  };

  await assert.rejects(
    prepareFixtures({
      environment: buildEnvironment({ OAUTH_E2E_RUN_ID: "rollback-failure" }),
      dependencies: {
        prisma,
        createSession: async () => {
          throw primaryError;
        },
      },
      migrate: async () => undefined,
    }),
    (error) => error === primaryError && error.oauthE2ERollbackError === rollbackError,
  );
});
