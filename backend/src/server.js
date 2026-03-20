require("dotenv").config();
const app = require("./app");
const { initializeDatabase, closeDatabase } = require("./lib/database");
const { logger } = require("./lib/logger");
const { env } = require("./config/env");
const { ensureUploadDirectories } = require("./middleware/upload");

let isShuttingDown = false;
let server = null;
let isServerListening = false;

const registerProcessDiagnostics = () => {
  process.on("beforeExit", (code) => {
    logger.warn("Node process beforeExit triggered", { code });
  });

  process.on("exit", (code) => {
    logger.warn("Node process exit triggered", { code });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception crashed Quest Esports API", { error });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection detected", { reason });
  });
};

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down Quest Esports API", { signal });

  if (!server || !isServerListening || !server.listening) {
    await closeDatabase();
    process.exit(0);
    return;
  }

  server.close(async (error) => {
    if (error) {
      logger.error("HTTP server closed with an error", { error, signal });
      await closeDatabase();
      process.exit(1);
      return;
    }

    logger.info("HTTP server closed", { signal });
    await closeDatabase();
    process.exit(0);
  });
};

const start = async () => {
  registerProcessDiagnostics();
  await ensureUploadDirectories();
  await initializeDatabase();

  server = app.listen(env.PORT);

  server.on("listening", () => {
    isServerListening = true;
    logger.info("Quest Esports API started", {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
    });
  });

  server.on("close", () => {
    isServerListening = false;
    logger.info("HTTP server emitted close event");
  });

  server.on("error", async (error) => {
    logger.error("HTTP server encountered an error", { error });

    if (!isServerListening || error?.code === "EADDRINUSE") {
      await closeDatabase();
      process.exit(1);
      return;
    }

    await shutdown("SERVER_ERROR");
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start().catch(async (error) => {
  logger.error("Failed to start Quest Esports API", { error });
  await closeDatabase();
  process.exit(1);
});
