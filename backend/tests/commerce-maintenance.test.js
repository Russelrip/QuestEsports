const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const maintenancePath = path.join(__dirname, "../src/lib/commerce-maintenance.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const paymentPath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bankTransferPath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");
const cachePath = path.join(__dirname, "../src/lib/cache.js");

test("commerce maintenance invalidates public tournament caches when registrations expire", async () => {
  const invalidated = [];
  const loaded = loadModuleWithMocks(maintenancePath, {
    [envPath]: { env: { COMMERCE_MAINTENANCE_ENABLED: false } },
    [loggerPath]: { logger: { info: () => undefined, error: () => undefined, warn: () => undefined } },
    [paymentPath]: {
      expireStaleCommerceReservations: async () => ({
        expiredOrders: 0,
        expiredRegistrations: 1,
        expiredTicketOrders: 0,
        __tournamentProjectionChanged: true,
      }),
      reconcileTicketOrderConfirmations: async () => 0,
    },
    [bankTransferPath]: { cleanupRetainedBankTransferProofs: async () => 0 },
    [cachePath]: { invalidateTags: async (tags) => invalidated.push(tags) },
  });
  try {
    await loaded.module.runCommerceMaintenance();
    assert.deepEqual(invalidated, [["tournaments", "foundation"]]);
  } finally {
    loaded.restore();
  }
});

test("commerce maintenance does not invalidate tournament caches for ticket-only expiry", async () => {
  const invalidated = [];
  const loaded = loadModuleWithMocks(maintenancePath, {
    [envPath]: { env: { COMMERCE_MAINTENANCE_ENABLED: false } },
    [loggerPath]: { logger: { info: () => undefined, error: () => undefined, warn: () => undefined } },
    [paymentPath]: {
      expireStaleCommerceReservations: async () => ({
        expiredOrders: 0,
        expiredRegistrations: 0,
        expiredTicketOrders: 1,
        __tournamentProjectionChanged: false,
      }),
      reconcileTicketOrderConfirmations: async () => 0,
    },
    [bankTransferPath]: { cleanupRetainedBankTransferProofs: async () => 0 },
    [cachePath]: { invalidateTags: async (tags) => invalidated.push(tags) },
  });
  try {
    await loaded.module.runCommerceMaintenance();
    assert.deepEqual(invalidated, []);
  } finally {
    loaded.restore();
  }
});
