// Grant or revoke super admin, the owner tier above admin.
//
//   node scripts/set-super-admin.js --email owner@example.com
//   node scripts/set-super-admin.js --email owner@example.com --revoke
//
// Deliberately a server-side script and not a dashboard control: whoever can
// make a super admin can hand out every kind of access, so it takes shell access
// to the host, not a stolen admin session. In production, run it inside the
// backend container, which already carries DATABASE_URL:
//
//   docker exec quest-prod-backend-1 node scripts/set-super-admin.js --email ...
//
// The account must already be an admin. The change is written to the audit log
// with source `system`. Revoking the last super admin is refused, because no one
// could then manage admins or staff roles from the dashboard.

require("dotenv").config({ quiet: true });

const { prisma } = require("../src/lib/prisma");
const { closeDatabase } = require("../src/lib/database");
const { recordAuditInTransaction } = require("../src/lib/audit");

const parseArguments = (argv) => {
  const options = { email: null, revoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--revoke") {
      options.revoke = true;
    } else if (argument === "--email") {
      options.email = argv[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--email=")) {
      options.email = argument.slice("--email=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.email = String(options.email || "").trim().toLowerCase();
  if (!options.email) throw new Error("Usage: node scripts/set-super-admin.js --email <email> [--revoke]");
  return options;
};

const setSuperAdmin = async ({ email, revoke }, database = prisma) => {
  const user = await database.user.findUnique({
    where: { emailNormalized: email },
    select: { id: true, username: true, role: true, isSuperAdmin: true },
  });
  if (!user) throw new Error(`No account uses ${email}.`);
  if (user.role !== "admin") {
    throw new Error(`@${user.username} is not an admin. Make them an admin first; a super admin is always an admin.`);
  }

  const next = !revoke;
  if (user.isSuperAdmin === next) {
    return { changed: false, user: { ...user, isSuperAdmin: next } };
  }

  return database.$transaction(async (tx) => {
    if (revoke) {
      const others = await tx.user.count({ where: { isSuperAdmin: true, id: { not: user.id } } });
      if (others === 0) {
        throw new Error(`@${user.username} is the last super admin. Make someone else a super admin before revoking.`);
      }
    }
    await tx.user.update({ where: { id: user.id }, data: { isSuperAdmin: next } });
    await recordAuditInTransaction(tx, {
      action: next ? "admin.user.super_admin.granted" : "admin.user.super_admin.revoked",
      targetType: "User",
      targetId: user.id,
      beforeData: { isSuperAdmin: user.isSuperAdmin },
      afterData: { isSuperAdmin: next },
      source: "system",
    });
    return { changed: true, user: { ...user, isSuperAdmin: next } };
  });
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const result = await setSuperAdmin(options);
  const state = result.user.isSuperAdmin ? "a super admin" : "not a super admin";
  process.stdout.write(
    result.changed
      ? `@${result.user.username} is now ${state}.\n`
      : `@${result.user.username} was already ${state}; nothing changed.\n`,
  );
};

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}

module.exports = { parseArguments, setSuperAdmin };
