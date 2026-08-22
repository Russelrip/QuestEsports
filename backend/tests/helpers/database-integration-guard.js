// The database integration suites write to whatever DATABASE_URL points at:
// they create and delete users, sessions, background jobs, tournaments,
// registrations, and saved teams. Pointing them at a shared or production
// database mutates real data and lets a live job worker race the assertions,
// so a remote host must be opted into deliberately rather than by default.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

const DISABLED_REASON =
  "set RUN_DATABASE_INTEGRATION_TESTS=true with an isolated migrated database";

const hostFromDatabaseUrl = (databaseUrl) => {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
};

const resolveDatabaseIntegrationTarget = ({
  flag = process.env.RUN_DATABASE_INTEGRATION_TESTS,
  databaseUrl = process.env.DATABASE_URL,
  allowRemote = process.env.ALLOW_REMOTE_INTEGRATION_DB,
} = {}) => {
  if (flag !== "true") {
    return { run: false, host: null, reason: DISABLED_REASON };
  }

  const host = hostFromDatabaseUrl(databaseUrl);
  if (!host) {
    return {
      run: false,
      host: null,
      reason: "DATABASE_URL is missing or unreadable; refusing to guess a database target",
    };
  }

  if (LOOPBACK_HOSTS.has(host) || allowRemote === "true") {
    return { run: true, host, reason: null };
  }

  // Name the host so the refusal is actionable, but never echo the URL itself:
  // it carries the database password.
  return {
    run: false,
    host,
    reason:
      `DATABASE_URL points at the non-local host ${host}. These tests write real rows, ` +
      "so point DATABASE_URL at a local test database, or set " +
      "ALLOW_REMOTE_INTEGRATION_DB=true if that host really is disposable.",
  };
};

module.exports = { resolveDatabaseIntegrationTarget };
