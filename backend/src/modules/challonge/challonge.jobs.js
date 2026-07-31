const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { enqueueJob, CHALLONGE_SYNC_JOB_NAME } = require("../../lib/jobs");
const {
  syncChallongeIntegration,
  claimDueIntegrationsForQueue,
} = require("./challonge.service");

let schedulerInterval = null;
let schedulerRunning = false;

const processChallongeSyncJob = async (payload = {}) => {
  if (!payload.integrationId) throw new Error("Challonge sync job is missing integrationId.");
  return syncChallongeIntegration({
    integrationId: payload.integrationId,
    trigger: "scheduled",
    requestId: payload.requestId || null,
  });
};

const runChallongeSchedulerTick = async () => {
  if (schedulerRunning || !env.CHALLONGE_ENABLED) return;
  schedulerRunning = true;
  try {
    const integrationIds = await claimDueIntegrationsForQueue();
    for (const integrationId of integrationIds) {
      await enqueueJob(CHALLONGE_SYNC_JOB_NAME, { integrationId }, { maxAttempts: 3 });
    }
  } catch (error) {
    logger.error("Challonge scheduler tick failed", { error });
  } finally {
    schedulerRunning = false;
  }
};

const startChallongeScheduler = () => {
  if (!env.CHALLONGE_ENABLED || schedulerInterval) return;
  void runChallongeSchedulerTick();
  schedulerInterval = setInterval(() => void runChallongeSchedulerTick(), 30_000);
  schedulerInterval.unref?.();
  logger.info("Challonge scheduler started");
};

const stopChallongeScheduler = async () => {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = null;
  while (schedulerRunning) await new Promise((resolve) => setTimeout(resolve, 25));
};

module.exports = {
  CHALLONGE_SYNC_JOB_NAME,
  processChallongeSyncJob,
  runChallongeSchedulerTick,
  startChallongeScheduler,
  stopChallongeScheduler,
};
