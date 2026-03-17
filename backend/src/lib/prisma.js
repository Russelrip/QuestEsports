const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis;

// Reuse the Prisma client in development to avoid exhausting connections
// during hot reloads or repeated module evaluation.
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

module.exports = { prisma };
