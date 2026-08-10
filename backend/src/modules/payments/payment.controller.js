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

const notifyPayHere = asyncHandler(async (req, res) => {
  await processPayHereNotification(req.body);
  res.status(200).send("OK");
});

const readPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await getPaymentStatus({
    providerOrderId: req.params.orderId,
    userId: req.user?.id,
    publicToken: req.get("x-order-token"),
  });
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
  });
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
  });
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
  });
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
