// Duplicate-player census (identity plan Section 8 / V2-A-004).
//
// Read-only. There is deliberately no --apply path: this script exists to SIZE
// the merge risk before anyone designs a backfill, and a script that can both
// measure and mutate invites running the mutation by accident.
//
// Run it against a restored production backup or an isolated database. It only
// reads, but a long scan against the live primary is still a cost the
// production database should not pay for a planning exercise.

require("dotenv").config({ quiet: true });

const { closeDatabase } = require("../src/lib/database");
const { previewPlayerIdentityCensus } = require("../src/lib/player-identity-census");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

const hostFromDatabaseUrl = (databaseUrl) => {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
};

const assertSafeTarget = () => {
  const host = hostFromDatabaseUrl(process.env.DATABASE_URL);
  if (!host) {
    throw new Error("DATABASE_URL is missing or unreadable; refusing to guess a database target.");
  }
  if (LOOPBACK_HOSTS.has(host) || process.env.ALLOW_REMOTE_CENSUS === "true") {
    return host;
  }
  // Name the host so the refusal is actionable, but never echo the URL: it
  // carries the database password.
  throw new Error(
    `Refusing to scan remote database host "${host}". Restore a backup locally, ` +
      "or set ALLOW_REMOTE_CENSUS=true if you have accepted the load on that host.",
  );
};

const main = async () => {
  const host = assertSafeTarget();
  const report = await previewPlayerIdentityCensus();
  process.stdout.write(`${JSON.stringify({ host, mode: "preview", report }, null, 2)}\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
