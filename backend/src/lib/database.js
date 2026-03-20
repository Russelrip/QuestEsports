const { prisma } = require("./prisma");
const { logger } = require("./logger");

const STARTUP_CONNECT_ATTEMPTS = 3;
const STARTUP_CONNECT_DELAY_MS = 1500;

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

module.exports = {
  initializeDatabase,
  closeDatabase,
};
