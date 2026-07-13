const { env } = require("../config/env");
const { logger } = require("./logger");
const {
  expireStaleCommerceReservations,
} = require("../modules/payments/payment.service");
const {
  cleanupRetainedBankTransferProofs,
} = require("../modules/payments/bank-transfer.service");

const MAINTENANCE_INTERVAL_MS = 60 * 1000;
let interval = null;
let running = false;

const runCommerceMaintenance = async () => {
  if (running) return;
  running = true;
  try {
    const result = await expireStaleCommerceReservations();
    const deletedBankTransferProofs = await cleanupRetainedBankTransferProofs();
    if (result.expiredOrders || result.expiredRegistrations) {
      logger.info("Expired commerce reservations released", result);
    }
    if (deletedBankTransferProofs) {
      logger.info("Expired bank-transfer proof files deleted", { deletedBankTransferProofs });
    }
  } catch (error) {
    logger.error("Commerce reservation maintenance failed", { error });
  } finally {
    running = false;
  }
};

const startCommerceMaintenance = () => {
  if (!env.COMMERCE_MAINTENANCE_ENABLED || interval) return false;
  interval = setInterval(() => void runCommerceMaintenance(), MAINTENANCE_INTERVAL_MS);
  interval.unref?.();
  void runCommerceMaintenance();
  return true;
};

const stopCommerceMaintenance = () => {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
};

module.exports = {
  runCommerceMaintenance,
  startCommerceMaintenance,
  stopCommerceMaintenance,
};
