const express = require("express");
const {
  attachSession,
  requireAuth,
  requireAdmin,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
const { paymentProofUpload } = require("../../middleware/upload");
const {
  notifyPayHere,
  readPaymentStatus,
  getAdminPayments,
  uploadBankTransferProof,
  downloadBankTransferProof,
  reviewBankTransferPayment,
} = require("./payment.controller");
const { createRateLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const notificationLimiter = createRateLimiter({
  name: "payhere-notification",
  windowMs: 60 * 60 * 1000,
  maxRequests: 600,
  message: "Too many payment notifications.",
});
const proofUploadLimiter = createRateLimiter({
  name: "bank-transfer-proof-upload",
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: "Too many payment proof uploads. Please try again later.",
});
router.use(attachSession);
router.post("/payments/payhere/notify", notificationLimiter, notifyPayHere);
router.get("/payments/:orderId", readPaymentStatus);
router.post(
  "/payments/:orderId/bank-transfer-proof",
  requireAuth,
  requireVerifiedEmail,
  proofUploadLimiter,
  paymentProofUpload.single("proof"),
  uploadBankTransferProof
);
router.get("/admin/payments", requireAdmin, getAdminPayments);
router.get(
  "/admin/payments/:transactionId/bank-transfer-proof",
  requireAdmin,
  downloadBankTransferProof
);
router.patch(
  "/admin/payments/:transactionId/bank-transfer-review",
  requireAdmin,
  express.json(),
  reviewBankTransferPayment
);

module.exports = router;
