const { asyncHandler } = require("../../lib/async-handler");
const { processPayHereNotification, getPaymentStatus } = require("./payment.service");
const { listPaymentTransactions } = require("./payment.service");
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
    publicToken: req.query.token,
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

const uploadBankTransferProof = asyncHandler(async (req, res) => {
  const result = await submitBankTransferProof({
    providerOrderId: req.params.orderId,
    user: req.user,
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
        ? "Bank transfer approved and registration confirmed."
        : "Bank transfer rejected and the slot released.",
    payment: { id: payment.id, status: payment.status },
  });
});

module.exports = {
  notifyPayHere,
  readPaymentStatus,
  getAdminPayments,
  uploadBankTransferProof,
  downloadBankTransferProof,
  reviewBankTransferPayment,
};
