const { Prisma } = require("../generated/prisma");
const { prisma } = require("./prisma");
const { logger } = require("./logger");

const STARTUP_CONNECT_ATTEMPTS = 3;
const STARTUP_CONNECT_DELAY_MS = 1500;
// The schema changes only when a migration runs, and the Compose healthcheck
// asks every ten seconds, so a passing schema probe is reused for this long.
const SCHEMA_PROBE_MAX_AGE_MS = 5 * 60 * 1000;
let schemaProbePassedAt = 0;

const wait = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const summarizeDatabaseTarget = () => {
  try {
    const parsed = new URL(process.env.DATABASE_URL);
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, "") || null,
    };
  } catch {
    return {
      host: null,
      database: null,
    };
  }
};

const initializeDatabase = async () => {
  const target = summarizeDatabaseTarget();
  let lastError = null;

  for (let attempt = 1; attempt <= STARTUP_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$connect();

      logger.info("Database connection established", {
        ...target,
        attempt,
      });
      return;
    } catch (error) {
      lastError = error;

      logger.warn("Database connection attempt failed", {
        ...target,
        attempt,
        remainingAttempts: STARTUP_CONNECT_ATTEMPTS - attempt,
        error,
      });

      if (attempt < STARTUP_CONNECT_ATTEMPTS) {
        await wait(STARTUP_CONNECT_DELAY_MS);
      }
    }
  }

  throw lastError;
};

const closeDatabase = async () => {
  try {
    await prisma.$disconnect();
    logger.info("Database connection closed");
  } catch (error) {
    logger.warn("Database disconnect encountered an error", {
      error,
    });
  }
};

const quoteIdentifier = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Prisma qualifies every table with the connection URL's `schema` parameter.
const databaseSchemaName = () => {
  try {
    return new URL(process.env.DATABASE_URL).searchParams.get("schema") || "public";
  } catch {
    return "public";
  }
};

// One statement naming every table and column the generated client can query,
// reading no rows. Postgres resolves each name while planning, so a missing
// table or column fails the statement and names what is missing.
const buildSchemaProbeSql = (models, schema = "public") =>
  models
    .map((model) => {
      const columns = model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => quoteIdentifier(field.dbName || field.name));
      const table = `${quoteIdentifier(schema)}.${quoteIdentifier(model.dbName || model.name)}`;
      return `SELECT 1 FROM (SELECT ${columns.join(", ")} FROM ${table} LIMIT 0) AS probe`;
    })
    .join(" UNION ALL ");

// `SELECT 1` proves the database answers, not that it has the schema this build
// queries. A release whose migration never ran (#128) read as ready while every
// query on the new column failed, so readiness also checks the schema.
const probeDatabase = async ({ now, schemaProbeMaxAgeMs }) => {
  if (schemaProbePassedAt && now - schemaProbePassedAt < schemaProbeMaxAgeMs) {
    await prisma.$queryRaw`SELECT 1`;
    return;
  }
  await prisma.$queryRawUnsafe(buildSchemaProbeSql(Prisma.dmmf.datamodel.models, databaseSchemaName()));
  schemaProbePassedAt = now;
};

const checkDatabaseReadiness = async ({
  timeoutMs = 3000,
  schemaProbeMaxAgeMs = SCHEMA_PROBE_MAX_AGE_MS,
  now = Date.now(),
} = {}) => {
  let timeout;
  try {
    await Promise.race([
      probeDatabase({ now, schemaProbeMaxAgeMs }),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database readiness check timed out.")),
          timeoutMs
        );
      }),
    ]);
    return true;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

module.exports = {
  buildSchemaProbeSql,
  initializeDatabase,
  closeDatabase,
  checkDatabaseReadiness,
};
