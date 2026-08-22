const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  processPayHereNotification,
  getPaymentStatus,
  listPaymentTransactions,
  getAdminPaymentTransaction,
  reconcilePayHerePayment,
  reconcileCashTicketPayment,
  reopenExpiredTournamentPayment,
} = require("./payment.service");
const {
  submitBankTransferProof,
  getBankTransferProofFile,
  reviewBankTransfer,
} = require("./bank-transfer.service");

const markTournamentPaymentCache = (res, payment) => {
  if (payment?.__tournamentProjectionChanged === true) {
    res.locals.cacheTags = ["tournaments", "foundation"];
  }
};

const paymentAudit = (req, action, decision, reasonCode) => ({
  ...requestAuditContext(req),
  action,
  decision,
  reasonCode,
});

const normalizedDecision = (value) => String(value || "").trim().toLowerCase();

const notifyPayHere = asyncHandler(async (req, res) => {
  const payment = await processPayHereNotification(req.body);
  markTournamentPaymentCache(res, payment);
  res.status(200).send("OK");
});

const readPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await getPaymentStatus({
    providerOrderId: req.params.orderId,
    userId: req.user?.id,
    publicToken: req.get("x-order-token"),
  });
  markTournamentPaymentCache(res, payment);
  res.status(200).json({ success: true, payment });
});

const getAdminPayments = asyncHandler(async (req, res) => {
  const result = await listPaymentTransactions(req.query);
  res.status(200).json({
    success: true,
    payments: result.items,
    pagination: result.pagination,
  });
});

const getAdminPayment = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    payment: await getAdminPaymentTransaction(req.params.transactionId),
  });
});

const uploadBankTransferProof = asyncHandler(async (req, res) => {
  const result = await submitBankTransferProof({
    providerOrderId: req.params.orderId,
    user: req.user,
    publicToken: req.get("x-order-token"),
    file: req.file,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "bank_transfer_proof.submitted",
    targetType: "PaymentTransaction",
    targetId: result.id || req.params.orderId,
    afterData: {
      status: result.status || "review_required",
      reviewUntil: result.reviewUntil || null,
      contentType: req.file?.mimetype || null,
      byteSize: req.file?.size || null,
    },
  });
  markTournamentPaymentCache(res, result);
  res.status(201).json({
    success: true,
    message: "Payment proof submitted for verification.",
    reviewUntil: result.reviewUntil,
  });
});

const downloadBankTransferProof = asyncHandler(async (req, res) => {
  const proof = await getBankTransferProofFile(req.params.transactionId);
  await recordAudit({
    ...requestAuditContext(req),
    action: "bank_transfer_proof.downloaded",
    targetType: "PaymentTransaction",
    targetId: req.params.transactionId,
    afterData: { contentType: proof.contentType, byteSize: proof.buffer.length },
  });
  const safeName = proof.originalFilename.replace(/["\r\n]/g, "_");
  res.setHeader("Content-Type", proof.contentType);
  res.setHeader("Content-Length", proof.buffer.length);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.status(200).send(proof.buffer);
});

const reviewBankTransferPayment = asyncHandler(async (req, res) => {
  const payment = await reviewBankTransfer({
    transactionId: req.params.transactionId,
    decision: req.body.decision,
    reason: req.body.reason,
    admin: req.user,
    audit: paymentAudit(req, "payment.bank_transfer.reviewed", normalizedDecision(req.body.decision), normalizedDecision(req.body.decision) === "approve" ? "approved" : "rejected"),
  });
  markTournamentPaymentCache(res, payment);
  res.status(200).json({
    success: true,
    message:
      payment.status === "paid"
        ? "Bank transfer approved and payment confirmed."
        : "Bank transfer rejected and the reservation released.",
    payment: { id: payment.id, status: payment.status },
  });
});

const reconcilePayHerePaymentController = asyncHandler(async (req, res) => {
  const payment = await reconcilePayHerePayment({
    transactionId: req.params.transactionId,
    decision: req.body.decision,
    note: req.body.note,
    providerRefundId: req.body.providerRefundId,
    admin: req.user,
    audit: paymentAudit(req, "payment.payhere.reconciled", normalizedDecision(req.body.decision), normalizedDecision(req.body.decision) === "accept" ? "accepted" : "refunded"),
  });
  markTournamentPaymentCache(res, payment);
  res.status(200).json({
    success: true,
    message: payment.status === "paid"
      ? "PayHere payment accepted and the purchase confirmed."
      : "External PayHere refund recorded.",
    payment: { id: payment.id, status: payment.status },
  });
});

const reconcileCashTicketPaymentController = asyncHandler(async (req, res) => {
  const payment = await reconcileCashTicketPayment({
    transactionId: req.params.transactionId,
    decision: req.body.decision,
    note: req.body.note,
    admin: req.user,
    audit: paymentAudit(req, "payment.cash.reconciled", normalizedDecision(req.body.decision), normalizedDecision(req.body.decision) === "confirm" ? "confirmed" : "cancelled"),
  });
  res.status(200).json({
    success: true,
    message:
      payment.status === "paid"
        ? "Cash collected and entrance tickets activated."
        : "Cash order cancelled and capacity released.",
    payment: { id: payment.id, status: payment.status },
  });
});

const reopenExpiredPayment = asyncHandler(async (req, res) => {
  const payment = await reopenExpiredTournamentPayment({
    transactionId: req.params.transactionId,
    admin: req.user,
    audit: paymentAudit(req, "payment.reopened", "reopen", "expired_payment_reopened"),
  });
  res.locals.cacheTags = ["tournaments", "foundation"];
  res.status(200).json({
    success: true,
    message: "Expired payment reopened and its slot reserved.",
    payment: { id: payment.id, status: payment.status },
  });
});

module.exports = {
  notifyPayHere,
  readPaymentStatus,
  getAdminPayments,
  getAdminPayment,
  uploadBankTransferProof,
  downloadBankTransferProof,
  reviewBankTransferPayment,
  reconcilePayHerePayment: reconcilePayHerePaymentController,
  reconcileCashTicketPayment: reconcileCashTicketPaymentController,
  reopenExpiredPayment,
};
