const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const connectionString = process.env.DIRECT_DATABASE_URL;

const pool = new Pool({
  connectionString,
});

// Prisma uses the pg adapter here instead of the default engine-managed connection layer.
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
});

module.exports = prisma;
