const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/payments/payment.controller.js");
const servicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bankTransferPath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");
const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const response = () => ({
  locals: {},
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  send() { return this; },
  json() { return this; },
});

test("payment controllers mark only changed tournament registration projections for cache invalidation", async () => {
  let notificationResult = { registrationId: "registration-1", __tournamentProjectionChanged: true };
  let bankReviewResult = { registrationId: "registration-1", __tournamentProjectionChanged: true };
  let proofResult = { __tournamentProjectionChanged: true };
  let statusResult = { status: "expired", __tournamentProjectionChanged: true };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: {
      processPayHereNotification: async () => notificationResult,
      getPaymentStatus: async () => statusResult,
      listPaymentTransactions: async () => ({ items: [], pagination: {} }),
      getAdminPaymentTransaction: async () => ({}),
      reconcilePayHerePayment: async () => notificationResult,
      reconcileCashTicketPayment: async () => ({ status: "paid" }),
      reopenExpiredTournamentPayment: async () => notificationResult,
    },
    [bankTransferPath]: {
      submitBankTransferProof: async () => proofResult,
      getBankTransferProofFile: async () => ({ buffer: Buffer.from("proof"), contentType: "image/png", originalFilename: "proof.png" }),
      reviewBankTransfer: async () => bankReviewResult,
    },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
  });

  try {
    let res = response();
    await controller.notifyPayHere({ body: {} }, res);
    assert.deepEqual(res.locals.cacheTags, ["tournaments", "foundation"]);

    notificationResult = { registrationId: null, __tournamentProjectionChanged: false };
    res = response();
    await controller.notifyPayHere({ body: {} }, res);
    assert.equal(res.locals.cacheTags, undefined);

    notificationResult = { registrationId: "registration-1", __tournamentProjectionChanged: false };
    res = response();
    await controller.notifyPayHere({ body: {} }, res);
    assert.equal(res.locals.cacheTags, undefined);

    res = response();
    await controller.reviewBankTransferPayment({ params: { transactionId: "payment-1" }, body: {}, user: {} }, res);
    assert.deepEqual(res.locals.cacheTags, ["tournaments", "foundation"]);

    bankReviewResult = { registrationId: null, __tournamentProjectionChanged: false };
    res = response();
    await controller.reviewBankTransferPayment({ params: { transactionId: "payment-1" }, body: {}, user: {} }, res);
    assert.equal(res.locals.cacheTags, undefined);

    proofResult = { __tournamentProjectionChanged: false };
    res = response();
    await controller.uploadBankTransferProof({ params: {}, body: {}, file: {}, user: {}, get: () => undefined }, res);
    assert.equal(res.locals.cacheTags, undefined);

    res = response();
    await controller.readPaymentStatus({ params: { orderId: "order-1" }, user: { id: "user-1" }, get: () => undefined }, res);
    assert.deepEqual(res.locals.cacheTags, ["tournaments", "foundation"]);

    statusResult = { status: "pending", __tournamentProjectionChanged: false };
    res = response();
    await controller.readPaymentStatus({ params: { orderId: "order-1" }, user: { id: "user-1" }, get: () => undefined }, res);
    assert.equal(res.locals.cacheTags, undefined);

    res = response();
    await controller.reconcileCashTicketPayment({ params: {}, body: {}, user: {} }, res);
    assert.equal(res.locals.cacheTags, undefined);
  } finally {
    restore();
  }
});
