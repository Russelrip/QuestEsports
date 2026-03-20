const { PrismaClient } = require("../generated/prisma");
const { logger } = require("./logger");

const globalForPrisma = globalThis;
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
