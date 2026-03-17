require("dotenv").config();
const app = require("./app");
const { initializeDatabase, closeDatabase } = require("./lib/database");
const { logger } = require("./lib/logger");
const { env } = require("./config/env");
const { ensureUploadDirectories } = require("./middleware/upload");

const start = async () => {
  await ensureUploadDirectories();
  await initializeDatabase();

  const server = app.listen(env.PORT, () => {
    logger.info("Quest Esports API started", {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
    });
  });

  const shutdown = async (signal) => {
    logger.info("Shutting down Quest Esports API", { signal });
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start().catch(async (error) => {
  logger.error("Failed to start Quest Esports API", { error });
  await closeDatabase();
  process.exit(1);
});
