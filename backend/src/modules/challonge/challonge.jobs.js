const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { enqueueJob, CHALLONGE_SYNC_JOB_NAME } = require("../../lib/jobs");
const {
  claimDueIntegrationsForQueue,
  recordChallongeSkippedAttempt,
} = require("./challonge.service");

let schedulerInterval = null;
let schedulerRunning = false;

const runChallongeSchedulerTick = async () => {
  if (schedulerRunning || !env.CHALLONGE_ENABLED || !env.CHALLONGE_AUTOMATIC_SYNC_ENABLED) return;
  schedulerRunning = true;
  try {
    const integrationIds = await claimDueIntegrationsForQueue();
    for (const integrationId of integrationIds) {
      const queued = await enqueueJob(
        CHALLONGE_SYNC_JOB_NAME,
        { integrationId },
        { maxAttempts: 3, dedupeKey: `challonge.sync:${integrationId}` }
      );
      if (queued.duplicate) {
        await recordChallongeSkippedAttempt({
          integrationId,
          trigger: "scheduled",
          reason: "duplicate_job",
        });
      }
    }
  } catch (error) {
    logger.error("Challonge scheduler tick failed", { error });
  } finally {
    schedulerRunning = false;
  }
};

const startChallongeScheduler = () => {
  if (!env.CHALLONGE_ENABLED || !env.CHALLONGE_AUTOMATIC_SYNC_ENABLED || schedulerInterval) return;
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
  runChallongeSchedulerTick,
  startChallongeScheduler,
  stopChallongeScheduler,
};
