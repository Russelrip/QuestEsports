const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const bcrypt = require("bcryptjs");
const { validatePostgresDatabaseUrl } = require("../src/lib/database-url");

const USER_KEYS = Object.freeze([
  "link",
  "collisionTarget",
  "collisionOwner",
  "safeUnlink",
  "lastMethod",
]);
const PASSWORD_USER_KEYS = new Set(USER_KEYS.slice(0, 4));
const DEFAULT_SESSION_COOKIE_NAME = "quest_session";
const BACKEND_ROOT = path.join(__dirname, "..");
const LOOPBACK_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const requiredValue = (environment, name) => {
  const value = String(environment[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const assertTestEnvironment = (environment) => {
  const nodeEnv = String(environment.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (nodeEnv !== "test") {
    throw new Error("OAuth E2E fixtures require NODE_ENV=test.");
  }
};

const validateDisposableDatabaseUrl = (name, value) => {
  const url = validatePostgresDatabaseUrl(name, value);
  const hostname = String(url.hostname || "").toLowerCase();
  if (!LOOPBACK_DATABASE_HOSTS.has(hostname)) {
    throw new Error(`${name} must use a loopback database host for OAuth E2E fixtures.`);
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${name} must contain a valid database name.`);
  }
  if (!/(?:test|e2e|oauth)/i.test(databaseName)) {
    throw new Error(`${name} database name must contain test, e2e, or oauth.`);
  }
  return url;
};

const getPrepareConfiguration = (environment = process.env) => {
  assertTestEnvironment(environment);

  const databaseUrl = requiredValue(environment, "OAUTH_E2E_DATABASE_URL");
  const directUrl =
    String(environment.OAUTH_E2E_DIRECT_URL || "").trim() || databaseUrl;
  validateDisposableDatabaseUrl("OAUTH_E2E_DATABASE_URL", databaseUrl);
  validateDisposableDatabaseUrl("OAUTH_E2E_DIRECT_URL", directUrl);

  const sessionCookieName = requiredValue(environment, "SESSION_COOKIE_NAME");
  if (/\s/.test(sessionCookieName)) {
    throw new Error("SESSION_COOKIE_NAME must not contain whitespace.");
  }

  const requestedRunId = String(environment.OAUTH_E2E_RUN_ID || "").trim();
  if (requestedRunId && !/^[A-Za-z0-9_-]{1,80}$/.test(requestedRunId)) {
    throw new Error("OAUTH_E2E_RUN_ID must contain only letters, numbers, _ or -.");
  }

  return {
    databaseUrl,
    directUrl,
    sessionCookieName,
    runId: requestedRunId || null,
  };
};

const getCleanupConfiguration = (environment = process.env, manifest) => {
  assertTestEnvironment(environment);

  const databaseUrl = requiredValue(environment, "OAUTH_E2E_DATABASE_URL");
  const directUrl =
    String(environment.OAUTH_E2E_DIRECT_URL || "").trim() || databaseUrl;
  validateDisposableDatabaseUrl("OAUTH_E2E_DATABASE_URL", databaseUrl);
  validateDisposableDatabaseUrl("OAUTH_E2E_DIRECT_URL", directUrl);

  return {
    databaseUrl,
    directUrl,
    sessionCookieName:
      String(environment.SESSION_COOKIE_NAME || "").trim() ||
      String(manifest?.sessionCookieName || "").trim() ||
      DEFAULT_SESSION_COOKIE_NAME,
  };
};

const randomText = (randomBytes, size, encoding = "hex") =>
  randomBytes(size).toString(encoding);

const createFixtureSeed = ({
  runId = null,
  randomUUID = crypto.randomUUID,
  randomBytes = crypto.randomBytes,
} = {}) => {
  const resolvedRunId = runId || randomUUID();
  const users = {};

  for (const key of USER_KEYS) {
    const roleName = key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    const email = `oauth-e2e-${resolvedRunId}-${roleName}@example.test`;
    const username = `oauth-e2e-${resolvedRunId}-${roleName}-${randomText(
      randomBytes,
      6
    )}`;
    users[key] = {
      id: randomUUID(),
      email,
      username,
      password: randomText(randomBytes, 24, "base64url"),
    };
  }

  return {
    runId: resolvedRunId,
    users,
    collisionProviderUserId: `oauth-e2e-discord-${resolvedRunId}-${randomText(
      randomBytes,
      12
    )}`,
    lastMethodProviderUserId: `oauth-e2e-google-${resolvedRunId}-${randomText(
      randomBytes,
      12
    )}`,
  };
};

const buildUserCreateData = ({ user, passwordHash, verifiedAt, key }) => ({
  id: user.id,
  firstName: "OAuth",
  lastName: key,
  email: user.email,
  emailNormalized: user.email.toLowerCase(),
  username: user.username,
  usernameNormalized: user.username.toLowerCase(),
  passwordHash,
  ...(PASSWORD_USER_KEYS.has(key) ? { passwordSetAt: verifiedAt } : {}),
  emailVerified: true,
  emailVerifiedAt: verifiedAt,
  role: "user",
});

const buildManifest = ({
  runId,
  sessionCookieName,
  users,
  collisionProviderUserId,
  lastMethodCookie,
}) => ({
  runId,
  sessionCookieName,
  users: Object.fromEntries(
    USER_KEYS.map((key) => [
      key,
      {
        id: users[key].id,
        email: users[key].email,
        password: users[key].password,
      },
    ])
  ),
  collisionProviderUserId,
  lastMethodCookie,
});

const serializeManifest = (manifest) => `${JSON.stringify(manifest)}\n`;

const getManifestUserIds = (manifest) => {
  if (!manifest || typeof manifest !== "object" || !manifest.users) {
    throw new Error("Fixture manifest must contain users.");
  }

  const userIds = USER_KEYS.map((key) => {
    const id = String(manifest.users[key]?.id || "").trim();
    if (!id) {
      throw new Error(`Fixture manifest is missing users.${key}.id.`);
    }
    return id;
  });

  if (new Set(userIds).size !== userIds.length) {
    throw new Error("Fixture manifest user IDs must be unique.");
  }

  return userIds;
};

const buildCleanupWhere = (manifest) => {
  const userIds = getManifestUserIds(manifest);
  const userIdFilter = { in: userIds };
  return {
    userIds,
    oauthAccount: { userId: userIdFilter },
    session: { userId: userIdFilter },
    user: { id: userIdFilter },
  };
};

const configureRuntimeEnvironment = ({
  databaseUrl,
  directUrl,
  sessionCookieName,
}) => {
  process.env.QUEST_DISABLE_DOTENV = "true";
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;
  process.env.SESSION_COOKIE_NAME = sessionCookieName;
};

const loadRuntimeDependencies = () => ({
  prisma: require("../src/lib/prisma").prisma,
  createSession: require("../src/modules/auth/session.service").createSession,
});

const getMigrationInvocation = () => {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    command,
    args: ["prisma", "migrate", "deploy"],
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
  };
};

const runMigrations = ({ databaseUrl, directUrl }) => {
  const invocation = getMigrationInvocation();
  const result = spawnSync(
    invocation.command,
    invocation.args,
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: directUrl,
        NODE_ENV: "test",
        QUEST_DISABLE_DOTENV: "true",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: invocation.shell,
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error("Prisma migrate deploy failed for the OAuth E2E database.");
  }
};

const createUsersAndOAuthAccount = async ({
  prisma,
  seed,
  verifiedAt,
}) => {
  const createRows = async (transactionClient) => {
    for (const key of USER_KEYS) {
      const user = seed.users[key];
      const passwordHash = await bcrypt.hash(user.password, 10);
      await transactionClient.user.create({
        data: buildUserCreateData({ user, passwordHash, verifiedAt, key }),
      });
    }

    await transactionClient.oAuthAccount.create({
      data: {
        id: crypto.randomUUID(),
        userId: seed.users.lastMethod.id,
        provider: "google",
        providerUserId: seed.lastMethodProviderUserId,
        email: seed.users.lastMethod.email,
      },
    });
  };

  if (typeof prisma.$transaction === "function") {
    await prisma.$transaction(createRows);
  } else {
    await createRows(prisma);
  }
};

const clearStaleRateLimitBuckets = async (prisma, environment = process.env) => {
  assertTestEnvironment(environment);
  const rateLimitBucket = prisma?.rateLimitBucket;
  if (typeof rateLimitBucket?.deleteMany !== "function") return;
  await rateLimitBucket.deleteMany({});
};

const buildSeedCleanupManifest = (seed) => ({
  users: Object.fromEntries(
    USER_KEYS.map((key) => [key, { id: seed.users[key].id }])
  ),
});

const markRollbackFailure = (error, rollbackError) => {
  try {
    error.oauthE2ERollbackError = rollbackError;
  } catch {
    // The original failure remains the authoritative error even if it cannot
    // carry rollback metadata.
  }
  return error;
};

const prepareFixtures = async ({
  environment = process.env,
  dependencies,
  migrate = runMigrations,
  now = new Date(),
  randomUUID,
  randomBytes,
  disconnectRuntime,
} = {}) => {
  const configuration = getPrepareConfiguration(environment);
  const seed = createFixtureSeed({
    runId: configuration.runId,
    randomUUID,
    randomBytes,
  });
  const verifiedAt = now instanceof Date ? now : new Date(now);

  configureRuntimeEnvironment(configuration);
  let runtime = dependencies;
  const ownsRuntime = !runtime || typeof disconnectRuntime === "function";
  let primaryError;
  let manifest;
  let rowsMayExist = false;
  let rollbackAttempted = false;

  const rollbackRows = async () => {
    if (rollbackAttempted || !rowsMayExist) return null;
    rollbackAttempted = true;
    if (!runtime?.prisma) {
      return new Error("Generated-row rollback was unavailable.");
    }
    try {
      await deleteFixtureRows(runtime.prisma, buildSeedCleanupManifest(seed));
      return null;
    } catch (error) {
      return error;
    }
  };

  try {
    await migrate(configuration);
    runtime = runtime || loadRuntimeDependencies();
    // This runs only after the test-mode and disposable-database guards above.
    // Injected Prisma seams may omit the optional model.
    await clearStaleRateLimitBuckets(runtime.prisma, environment);
    rowsMayExist = true;

    await createUsersAndOAuthAccount({
      prisma: runtime.prisma,
      seed,
      verifiedAt,
    });
    const session = await runtime.createSession({
      userId: seed.users.lastMethod.id,
      rememberMe: true,
      userAgent: "oauth-e2e-fixture",
    });

    manifest = buildManifest({
      runId: seed.runId,
      sessionCookieName: configuration.sessionCookieName,
      users: seed.users,
      collisionProviderUserId: seed.collisionProviderUserId,
      lastMethodCookie: `${configuration.sessionCookieName}=${encodeURIComponent(
        session.token
      )}`,
    });
  } catch (error) {
    primaryError = error;
    const rollbackError = await rollbackRows();
    if (rollbackError) markRollbackFailure(primaryError, rollbackError);
  }

  if (ownsRuntime && runtime?.prisma) {
    const disconnect = disconnectRuntime || runtime.prisma.$disconnect?.bind(runtime.prisma);
    if (disconnect) {
      try {
        await disconnect();
      } catch (error) {
        if (!primaryError) primaryError = error;
        if (!rollbackAttempted) {
          const rollbackError = await rollbackRows();
          if (rollbackError) markRollbackFailure(primaryError, rollbackError);
        }
      }
    }
  }

  if (primaryError) throw primaryError;
  return manifest;
};

const deleteFixtureRows = async (prisma, manifest) => {
  const where = buildCleanupWhere(manifest);
  const deleteRows = async (transactionClient) => {
    await transactionClient.oAuthAccount.deleteMany({
      where: where.oauthAccount,
    });
    await transactionClient.session.deleteMany({ where: where.session });
    await transactionClient.user.deleteMany({ where: where.user });
  };

  if (typeof prisma.$transaction === "function") {
    await prisma.$transaction(deleteRows);
  } else {
    await deleteRows(prisma);
  }
};

const cleanupFixtures = async ({
  manifest,
  environment = process.env,
  prisma: providedPrisma,
} = {}) => {
  const configuration = getCleanupConfiguration(environment, manifest);
  configureRuntimeEnvironment(configuration);
  const prisma = providedPrisma || require("../src/lib/prisma").prisma;
  try {
    await deleteFixtureRows(prisma, manifest);
  } finally {
    if (!providedPrisma && prisma?.$disconnect) {
      await prisma.$disconnect();
    }
  }
};

const readManifest = (manifestPath) => {
  let contents;
  try {
    contents = fs.readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error("Could not read the OAuth E2E fixture manifest.");
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("OAuth E2E fixture manifest is not valid JSON.");
  }
};

const writeManifest = (manifestPath, manifest) => {
  let descriptor = null;
  let created = false;
  try {
    descriptor = fs.openSync(manifestPath, "wx", 0o600);
    created = true;
    fs.writeSync(descriptor, serializeManifest(manifest), 0, "utf8");
    fs.fchmodSync(descriptor, 0o600);
  } catch {
    if (created) {
      try {
        fs.unlinkSync(manifestPath);
      } catch {
        // Preserve the manifest-write failure without exposing its contents.
      }
    }
    throw new Error("Could not write the OAuth E2E fixture manifest.");
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The write result is already represented by the primary error.
      }
    }
  }
};

const writeManifestWithRollback = async ({
  manifestPath,
  manifest,
  cleanup = cleanupFixtures,
  write = writeManifest,
}) => {
  try {
    write(manifestPath, manifest);
  } catch (error) {
    try {
      await cleanup({ manifest });
    } catch (rollbackError) {
      markRollbackFailure(error, rollbackError);
    }
    throw error;
  }
};

const PREPARE_SUCCESS_MARKER = "OAuth E2E fixture prepare succeeded.";

const parseArguments = (argumentsList) => {
  const [command, ...rest] = argumentsList;
  if (
    (command === "prepare" || command === "cleanup") &&
    rest.length === 2 &&
    rest[0] === "--manifest" &&
    rest[1]
  ) {
    return { command, manifestPath: path.resolve(rest[1]) };
  }
  throw new Error(
    "Usage: node scripts/oauth-e2e-fixtures.js prepare --manifest <path> | cleanup --manifest <path>"
  );
};

const sanitizeError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1[redacted]")
    .replace(/password[^\s]*/gi, "password [redacted]");
};

const main = async (argumentsList) => {
  try {
    const argumentsValue = parseArguments(argumentsList);
    if (argumentsValue.command === "prepare") {
      const manifest = await prepareFixtures();
      await writeManifestWithRollback({
        manifestPath: argumentsValue.manifestPath,
        manifest,
      });
      return;
    }

    const manifest = readManifest(argumentsValue.manifestPath);
    await cleanupFixtures({ manifest });
  } catch (error) {
    const rollbackNote = error?.oauthE2ERollbackError
      ? " Generated-row cleanup could not be verified."
      : "";
    console.error(
      `OAuth E2E fixture ${argumentsList[0] || "command"} failed: ${sanitizeError(error)}${rollbackNote}`,
    );
    process.exitCode = 1;
  }
};

module.exports = {
  USER_KEYS,
  PASSWORD_USER_KEYS,
  assertTestEnvironment,
  validateDisposableDatabaseUrl,
  getPrepareConfiguration,
  getCleanupConfiguration,
  createFixtureSeed,
  buildUserCreateData,
  getMigrationInvocation,
  buildManifest,
  serializeManifest,
  writeManifest,
  writeManifestWithRollback,
  PREPARE_SUCCESS_MARKER,
  getManifestUserIds,
  buildCleanupWhere,
  clearStaleRateLimitBuckets,
  prepareFixtures,
  cleanupFixtures,
  deleteFixtureRows,
  parseArguments,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
