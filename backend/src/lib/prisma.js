const fs = require("node:fs");
const { PrismaClient } = require("../generated/prisma");
const { buildRuntimeDatabaseUrl } = require("./database-url");
const { logger } = require("./logger");

const globalForPrisma = globalThis;
// The release host runs this verifier from a container that cannot read the
// root-only URL file, so the credential may arrive directly. Mirror the
// precedence used by scripts/verify-database-security.js.
const securityDatabaseUrl =
  process.env.SECURITY_VERIFY_DATABASE_URL ||
  (process.env.SECURITY_VERIFY_DATABASE_URL_FILE &&
    fs.readFileSync(process.env.SECURITY_VERIFY_DATABASE_URL_FILE, "utf8").trim());
const prismaLogConfig =
  process.env.NODE_ENV === "development"
    ? [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ]
    : [{ emit: "event", level: "error" }];

// Reuse the Prisma client in development to avoid exhausting connections
// during hot reloads or repeated module evaluation.
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: buildRuntimeDatabaseUrl(securityDatabaseUrl || process.env.DATABASE_URL),
    log: prismaLogConfig,
  });

prisma.$on("warn", (event) => {
  logger.warn("Prisma warning", {
    target: event.target,
    message: event.message,
  });
});

prisma.$on("error", (event) => {
  logger.error("Prisma error", {
    target: event.target,
    message: event.message,
  });
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

module.exports = { prisma };
