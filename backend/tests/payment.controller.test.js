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

test("privileged payment mutations record request context with minimal sanitized audit metadata", async () => {
  const serviceCalls = [];
  const payment = (status) => ({ id: "payment-1", status });
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: {
      processPayHereNotification: async () => ({}),
      getPaymentStatus: async () => ({}),
      listPaymentTransactions: async () => ({ items: [], pagination: {} }),
      getAdminPaymentTransaction: async () => ({}),
      reconcilePayHerePayment: async (input) => {
        serviceCalls.push(["payhere", input]);
        return payment("refunded");
      },
      reconcileCashTicketPayment: async (input) => {
        serviceCalls.push(["cash", input]);
        return payment("cancelled");
      },
      reopenExpiredTournamentPayment: async (input) => {
        serviceCalls.push(["reopen", input]);
        return payment("pending");
      },
    },
    [bankTransferPath]: {
      submitBankTransferProof: async () => ({}),
      getBankTransferProofFile: async () => ({ buffer: Buffer.from("proof"), contentType: "image/png", originalFilename: "proof.png" }),
      reviewBankTransfer: async (input) => {
        serviceCalls.push(["bank", input]);
        return payment("paid");
      },
    },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [auditPath]: {
      recordAudit: async () => undefined,
      requestAuditContext: () => ({ actorUserId: "admin-1", requestId: "request-1", ipAddress: "198.51.100.7" }),
    },
  });

  try {
    const baseRequest = {
      params: { transactionId: "payment-1" },
      user: { id: "admin-1", email: "admin@example.test" },
      body: {
        decision: "approve",
        reason: "Approved after checking buyer@example.test against provider-secret.",
        note: "Accepted with signature-secret and provider-ref-123.",
        providerRefundId: "provider-secret",
        signature: "signature-secret",
        rawProof: "proof-bytes",
        email: "buyer@example.test",
      },
    };
    const res = response();

    await controller.reviewBankTransferPayment(baseRequest, res);
    await controller.reconcilePayHerePayment({ ...baseRequest, body: { ...baseRequest.body, decision: "mark_refunded" } }, res);
    await controller.reconcileCashTicketPayment({ ...baseRequest, body: { ...baseRequest.body, decision: "cancel" } }, res);
    await controller.reopenExpiredPayment(baseRequest, res);

    assert.deepEqual(serviceCalls.map(([name, input]) => ({ name, audit: input.audit })), [
      {
        name: "bank",
        audit: { action: "payment.bank_transfer.reviewed", decision: "approve", reasonCode: "approved", actorUserId: "admin-1", requestId: "request-1", ipAddress: "198.51.100.7" },
      },
      {
        name: "payhere",
        audit: { action: "payment.payhere.reconciled", decision: "mark_refunded", reasonCode: "refunded", actorUserId: "admin-1", requestId: "request-1", ipAddress: "198.51.100.7" },
      },
      {
        name: "cash",
        audit: { action: "payment.cash.reconciled", decision: "cancel", reasonCode: "cancelled", actorUserId: "admin-1", requestId: "request-1", ipAddress: "198.51.100.7" },
      },
      {
        name: "reopen",
        audit: { action: "payment.reopened", decision: "reopen", reasonCode: "expired_payment_reopened", actorUserId: "admin-1", requestId: "request-1", ipAddress: "198.51.100.7" },
      },
    ]);
    const serializedAudit = JSON.stringify(serviceCalls.map(([, input]) => input.audit));
    for (const forbidden of ["providerRefundId", "provider-secret", "signature-secret", "rawProof", "proof-bytes", "buyer@example.test"]) {
      assert.equal(serializedAudit.includes(forbidden), false, `audit must omit ${forbidden}`);
    }
    assert.equal(serviceCalls[1][1].providerRefundId, "provider-secret");
  } finally {
    restore();
  }
});
