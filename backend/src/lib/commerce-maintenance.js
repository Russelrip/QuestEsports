const { env } = require("../config/env");
const { logger } = require("./logger");
const {
  expireStaleCommerceReservations,
  reconcileTicketOrderConfirmations,
} = require("../modules/payments/payment.service");
const {
  cleanupRetainedBankTransferProofs,
} = require("../modules/payments/bank-transfer.service");

const MAINTENANCE_INTERVAL_MS = 60 * 1000;
let interval = null;
let running = false;
let activeRun = null;
let stopping = false;

const runCommerceMaintenance = async () => {
  if (running || stopping) return;
  running = true;
  activeRun = (async () => {
    try {
      const result = await expireStaleCommerceReservations();
      const queuedTicketConfirmations =
        await reconcileTicketOrderConfirmations();
      const deletedBankTransferProofs =
        await cleanupRetainedBankTransferProofs();
      if (
        result.expiredOrders ||
        result.expiredRegistrations ||
        result.expiredTicketOrders
      ) {
        logger.info("Expired commerce reservations released", result);
      }
      if (deletedBankTransferProofs) {
        logger.info("Expired bank-transfer proof files deleted", {
          deletedBankTransferProofs,
        });
      }
      if (queuedTicketConfirmations) {
        logger.info("Missing paid ticket confirmations queued", {
          queuedTicketConfirmations,
        });
      }
    } catch (error) {
      logger.error("Commerce reservation maintenance failed", { error });
    } finally {
      running = false;
      activeRun = null;
    }
  })();
  await activeRun;
};

const startCommerceMaintenance = () => {
  if (!env.COMMERCE_MAINTENANCE_ENABLED || interval) return false;
  stopping = false;
  interval = setInterval(
    () => void runCommerceMaintenance(),
    MAINTENANCE_INTERVAL_MS,
  );
  interval.unref?.();
  void runCommerceMaintenance();
  return true;
};

const stopCommerceMaintenance = async ({ timeoutMs = 15000 } = {}) => {
  stopping = true;
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (activeRun) {
    let timeout;
    await Promise.race([
      activeRun,
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          logger.warn("Commerce maintenance drain timed out", { timeoutMs });
          resolve();
        }, timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
};

module.exports = {
  runCommerceMaintenance,
  startCommerceMaintenance,
  stopCommerceMaintenance,
};
