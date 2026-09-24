const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const backendRoot = path.join(__dirname, "..");
const serverPath = path.join(backendRoot, "src/server.js");
const appPath = path.join(backendRoot, "src/app.js");
const databasePath = path.join(backendRoot, "src/lib/database.js");
const jobsPath = path.join(backendRoot, "src/lib/jobs.js");
const commerceMaintenancePath = path.join(backendRoot, "src/lib/commerce-maintenance.js");
const loggerPath = path.join(backendRoot, "src/lib/logger.js");
const observabilityTransportPath = path.join(backendRoot, "src/lib/observability-transport.js");
const uploadPath = path.join(backendRoot, "src/middleware/upload.js");
const challongeJobsPath = path.join(backendRoot, "src/modules/challonge/challonge.jobs.js");
const rankingJobsPath = path.join(backendRoot, "src/modules/players/ranking.jobs.js");
const realtimeServicePath = path.join(backendRoot, "src/modules/realtime/realtime.service.js");
const realtimeControllerPath = path.join(backendRoot, "src/modules/realtime/realtime.controller.js");
const envPath = path.join(backendRoot, "src/config/env.js");

test("shutdown labels a failed ranking scheduler drain correctly", async () => {
  const errors = [];
  const loaded = loadModuleWithMocks(serverPath, {
    [appPath]: {},
    [databasePath]: { initializeDatabase() {}, closeDatabase: async () => {} },
    [jobsPath]: { startJobWorker() {}, stopJobWorker: async () => {} },
    [commerceMaintenancePath]: {
      startCommerceMaintenance() {},
      stopCommerceMaintenance: async () => {},
    },
    [loggerPath]: {
      logger: {
        info() {},
        warn() {},
        error(message, details) {
          errors.push({ message, details });
        },
      },
    },
    [observabilityTransportPath]: { flushObservabilityTransport: async () => {} },
    [uploadPath]: { ensureUploadDirectories() {} },
    [challongeJobsPath]: {
      startChallongeScheduler() {},
      stopChallongeScheduler: async () => {},
    },
    [rankingJobsPath]: {
      startRankingScheduler() {},
      stopRankingScheduler: async () => {
        throw new Error("ranking scheduler failed");
      },
    },
    [realtimeServicePath]: {
      startRealtimeTransport() {},
      stopRealtimeTransport: async () => {},
    },
    [realtimeControllerPath]: { drainRealtimeConnections() {} },
    [envPath]: { env: {} },
  });
  const originalExit = process.exit;
  process.exit = () => {};

  try {
    await loaded.module.shutdown("SIGTERM");
    const failedDrain = errors.find(({ message }) => message === "Shutdown drain task failed");
    assert.equal(failedDrain.details.task, "ranking_scheduler");
  } finally {
    process.exit = originalExit;
    loaded.restore();
  }
});
