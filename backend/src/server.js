const app = require("./app");
const { initializeDatabase, closeDatabase } = require("./lib/database");
const { startJobWorker, stopJobWorker } = require("./lib/jobs");
const {
  startCommerceMaintenance,
  stopCommerceMaintenance,
} = require("./lib/commerce-maintenance");
const { logger } = require("./lib/logger");
const { flushObservabilityTransport } = require("./lib/observability-transport");
const { startDataHygieneMaintenance, stopDataHygieneMaintenance } = require("./lib/data-hygiene-maintenance");
const { env } = require("./config/env");
const { ensureUploadDirectories } = require("./middleware/upload");
const {
  startChallongeScheduler,
  stopChallongeScheduler,
} = require("./modules/challonge/challonge.jobs");
const {
  startRankingScheduler,
  stopRankingScheduler,
} = require("./modules/players/ranking.jobs");
const {
  startRealtimeTransport,
  stopRealtimeTransport,
} = require("./modules/realtime/realtime.service");
const { drainRealtimeConnections } = require("./modules/realtime/realtime.controller");

let isShuttingDown = false;
let server = null;
let isServerListening = false;
const SHUTDOWN_DEADLINE_MS = 30 * 1000;

const registerProcessDiagnostics = () => {
  process.on("beforeExit", (code) => {
    logger.warn("Node process beforeExit triggered", { code });
  });

  process.on("exit", (code) => {
    logger.warn("Node process exit triggered", { code });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception crashed Quest E-sports API", { error });
    void shutdown("UNCAUGHT_EXCEPTION", 1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection detected", { reason });
    void shutdown("UNHANDLED_REJECTION", 1);
  });
};

const shutdown = async (signal, exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down Quest E-sports API", { signal });
  const deadline = setTimeout(() => {
    logger.error("Graceful shutdown deadline exceeded", {
      signal,
      timeoutMs: SHUTDOWN_DEADLINE_MS,
    });
    server?.closeAllConnections?.();
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  let httpCloseError = null;
  let shutdownFailed = false;
  try {
    drainRealtimeConnections();
    const closeHttp = !server || !isServerListening || !server.listening
      ? Promise.resolve()
      : new Promise((resolve) => {
          server.close((error) => {
            httpCloseError = error || null;
            resolve();
          });
          server.closeIdleConnections?.();
        });

    const drainResults = await Promise.allSettled([
      closeHttp,
      stopJobWorker(),
      stopCommerceMaintenance(),
      stopChallongeScheduler(),
      stopRankingScheduler(),
      stopDataHygieneMaintenance(),
      stopRealtimeTransport(),
    ]);

    for (const [index, result] of drainResults.entries()) {
      if (result.status === "rejected") {
        shutdownFailed = true;
        logger.error("Shutdown drain task failed", {
          task: ["http", "job_worker", "commerce_maintenance", "challonge_scheduler", "data_hygiene", "realtime_transport"][index],
          error: result.reason,
          signal,
        });
      }
    }

    try {
      await closeDatabase();
    } catch (error) {
      shutdownFailed = true;
      logger.error("Database shutdown failed", { error, signal });
    }

    if (httpCloseError) {
      shutdownFailed = true;
      logger.error("HTTP server closed with an error", {
        error: httpCloseError,
        signal,
      });
    }

    if (!shutdownFailed) {
      logger.info("Graceful shutdown completed", { signal });
    }
    await flushObservabilityTransport({ timeoutMs: 3000 });
    process.exit(shutdownFailed ? 1 : exitCode);
  } finally {
    clearTimeout(deadline);
  }
};

const start = async () => {
  registerProcessDiagnostics();
  await ensureUploadDirectories();
  await initializeDatabase();
  await startRealtimeTransport();
  startJobWorker();
  startCommerceMaintenance();
  startChallongeScheduler();
  startRankingScheduler();
  startDataHygieneMaintenance();

  server = app.listen(env.PORT);

  server.on("listening", () => {
    isServerListening = true;
    logger.info("Quest E-sports API started", {
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

    await shutdown("SERVER_ERROR", 1);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start().catch(async (error) => {
  logger.error("Failed to start Quest E-sports API", { error });
  await closeDatabase();
  process.exit(1);
});
