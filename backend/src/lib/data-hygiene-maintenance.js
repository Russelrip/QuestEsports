const { env } = require("../config/env");
const { logger } = require("./logger");
const { applyDataHygiene } = require("./data-hygiene");

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 6 * 60 * 60 * 1000;
let interval = null;
let initialTimer = null;
let running = false;
let activeRun = null;

const runDataHygieneMaintenance = async () => {
  if (running) return null;
  running = true;
  activeRun = (async () => {
    try {
      const changed = await applyDataHygiene();
      if (Object.values(changed).some(Boolean)) logger.info("Database hygiene completed", changed);
      return changed;
    } catch (error) {
      logger.error("Database hygiene failed", { error });
      return null;
    } finally {
      running = false;
      activeRun = null;
    }
  })();
  return activeRun;
};

const startDataHygieneMaintenance = () => {
  if (!env.DATA_HYGIENE_MAINTENANCE_ENABLED || interval || initialTimer) return false;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runDataHygieneMaintenance();
    interval = setInterval(() => void runDataHygieneMaintenance(), INTERVAL_MS);
    interval.unref?.();
  }, INITIAL_DELAY_MS);
  initialTimer.unref?.();
  return true;
};

const stopDataHygieneMaintenance = async () => {
  if (initialTimer) clearTimeout(initialTimer);
  if (interval) clearInterval(interval);
  initialTimer = null;
  interval = null;
  if (activeRun) await activeRun;
};

module.exports = { runDataHygieneMaintenance, startDataHygieneMaintenance, stopDataHygieneMaintenance };
