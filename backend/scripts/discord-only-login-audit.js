// Who loses access if Discord becomes the only way to sign in?
//
// READ-ONLY. Every statement is a SELECT; there is no apply path. Run this
// BEFORE removing Google or password login, because the answer decides whether
// that change is a quiet switch or a support incident.
//
// A user is safe only if they have a linked Discord OAuth account. A password
// and a linked Google account both stop being doors the moment Discord is the
// only login method.
//
// Uses raw SQL rather than the Prisma client so it still runs against a
// database that is behind on migrations — which is exactly the situation where
// you most want an accurate answer.
//
//   cd backend && npm run audit:discord-login
//   cd backend && npm run audit:discord-login -- --list
//
// The summary is safe to paste anywhere. --list prints usernames and email
// addresses so you can actually contact these people, so treat that output as
// personal data.

require("dotenv").config({ quiet: true });

const { PrismaClient } = require("../src/generated/prisma");
const { buildRuntimeDatabaseUrl } = require("../src/lib/database-url");

const showList = process.argv.includes("--list");

// A trailing "$" has been seen on a hand-edited DATABASE_URL. It is never valid
// at the end of a connection string, so trim it rather than failing with
// Prisma's opaque "provided database string is invalid".
const connectionString = () => {
  const raw = String(process.env.DATABASE_URL || "").trim().replace(/\$+$/, "");
  if (!raw) throw new Error("DATABASE_URL is not set.");
  return buildRuntimeDatabaseUrl(raw);
};

const prisma = new PrismaClient({ datasourceUrl: connectionString() });

const hasColumn = async (table, column) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return rows.length > 0;
};

const main = async () => {
  const [{ count: totalUsers }] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM users",
  );

  if (totalUsers === 0) {
    console.log(
      "\nThis database has no users. It is a scratch or test database, not " +
        "production — point DATABASE_URL at the real database before trusting " +
        "any answer from this script.\n",
    );
    return;
  }

  // `password_set_at` marks a password the user actually chose. OAuth-only
  // accounts carry a random hash that was never a usable login, so counting
  // `password_hash` would badly overstate how many people have a password.
  const hasPasswordMarker = await hasColumn("users", "password_set_at");
  const realPassword = hasPasswordMarker
    ? "u.password_set_at IS NOT NULL"
    : "FALSE";

  const [summary] = await prisma.$queryRawUnsafe(`
    WITH flags AS (
      SELECT
        u.id,
        u.role::text AS role,
        u.last_login_at,
        ${realPassword} AS has_password,
        EXISTS (SELECT 1 FROM oauth_accounts o
                WHERE o.user_id = u.id AND o.provider::text = 'discord') AS has_discord,
        EXISTS (SELECT 1 FROM oauth_accounts o
                WHERE o.user_id = u.id AND o.provider::text = 'google') AS has_google
      FROM users u
    )
    SELECT
      COUNT(*)::int                                              AS "totalUsers",
      COUNT(*) FILTER (WHERE has_discord)::int                   AS "safeWithDiscord",
      COUNT(*) FILTER (WHERE NOT has_discord)::int               AS "lockedOut",
      COUNT(*) FILTER (WHERE NOT has_discord AND role = 'admin')::int
                                                                 AS "lockedOutAdmins",
      COUNT(*) FILTER (WHERE NOT has_discord AND has_password AND NOT has_google)::int
                                                                 AS "passwordOnly",
      COUNT(*) FILTER (WHERE NOT has_discord AND has_google AND NOT has_password)::int
                                                                 AS "googleOnly",
      COUNT(*) FILTER (WHERE NOT has_discord AND has_google AND has_password)::int
                                                                 AS "passwordAndGoogle",
      COUNT(*) FILTER (WHERE NOT has_discord AND NOT has_google AND NOT has_password)::int
                                                                 AS "noKnownLoginMethod",
      COUNT(*) FILTER (WHERE NOT has_discord AND last_login_at IS NULL)::int
                                                                 AS "lockedOutNeverLoggedIn",
      COUNT(*) FILTER (WHERE NOT has_discord AND last_login_at > NOW() - INTERVAL '90 days')::int
                                                                 AS "lockedOutActiveLast90Days"
    FROM flags
  `);

  console.log("\n=== IF DISCORD BECOMES THE ONLY LOGIN ===");
  console.log(JSON.stringify(summary, null, 2));

  if (!hasPasswordMarker) {
    console.log(
      "\nNote: this database predates users.password_set_at, so password " +
        "counts are reported as zero. The locked-out TOTAL is still correct — " +
        "it only depends on Discord being linked.",
    );
  }

  const share = ((summary.lockedOut / summary.totalUsers) * 100).toFixed(1);
  console.log(
    `\n${summary.lockedOut} of ${summary.totalUsers} users (${share}%) would lose access.`,
  );
  if (summary.lockedOutAdmins > 0) {
    console.log(
      `WARNING: ${summary.lockedOutAdmins} of them are admins. Link their ` +
        "Discord accounts before changing anything.",
    );
  }

  if (!showList) {
    console.log("\nRe-run with --list to print who they are.\n");
    return;
  }

  // Ordered by consequence: admins first, then people with real activity to
  // lose, then everyone else.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      u.username,
      u.email,
      u.role::text AS role,
      CASE
        WHEN ${realPassword} AND EXISTS (SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id AND o.provider::text = 'google')
          THEN 'password + google'
        WHEN ${realPassword} THEN 'password'
        WHEN EXISTS (SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id AND o.provider::text = 'google')
          THEN 'google'
        ELSE 'none'
      END AS "currentLogin",
      (SELECT COUNT(*)::int FROM saved_teams t WHERE t.captain_user_id = u.id)        AS teams,
      (SELECT COUNT(*)::int FROM team_registrations r WHERE r.user_id = u.id)         AS registrations,
      (SELECT COUNT(*)::int FROM ticket_orders o WHERE o.user_id = u.id)              AS tickets,
      COALESCE(u.last_login_at::date::text, 'never')                                  AS "lastLogin"
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id AND o.provider::text = 'discord'
    )
    ORDER BY
      (u.role::text = 'admin') DESC,
      ((SELECT COUNT(*) FROM saved_teams t WHERE t.captain_user_id = u.id)
       + (SELECT COUNT(*) FROM team_registrations r WHERE r.user_id = u.id)
       + (SELECT COUNT(*) FROM ticket_orders o WHERE o.user_id = u.id)) DESC,
      u.created_at ASC
  `);

  console.log("\n=== LOCKED OUT (no Discord linked) ===");
  console.table(rows);
  console.log(
    `\n${rows.length} users. Contact them before removing Google or password ` +
      "login, or migrate them by asking for a Discord link at next sign-in.\n",
  );
};

main()
  .catch((error) => {
    // Never echo the connection string: it carries the database password.
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
