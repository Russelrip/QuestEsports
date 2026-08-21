const express = require("express");
const {
  requireAdmin,
} = require("../auth/auth.middleware");
const { paymentProofUpload } = require("../../middleware/upload");
const {
  notifyPayHere,
  readPaymentStatus,
  getAdminPayments,
  getAdminPayment,
  uploadBankTransferProof,
  downloadBankTransferProof,
  reviewBankTransferPayment,
  reconcilePayHerePayment,
  reconcileCashTicketPayment,
  reopenExpiredPayment,
} = require("./payment.controller");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { invalidateCache } = require("../../middleware/response-cache");

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
const invalidatePaymentProjectionCache = invalidateCache((_req, res) => res.locals?.cacheTags || []);

router.post("/payments/payhere/notify", notificationLimiter, invalidatePaymentProjectionCache, notifyPayHere);
router.get("/payments/:orderId", invalidatePaymentProjectionCache, readPaymentStatus);
router.post(
  "/payments/:orderId/bank-transfer-proof",
  proofUploadLimiter,
  invalidatePaymentProjectionCache,
  paymentProofUpload.single("proof"),
  uploadBankTransferProof
);
router.get("/admin/payments", requireAdmin, getAdminPayments);
router.get("/admin/payments/:transactionId", requireAdmin, getAdminPayment);
router.get(
  "/admin/payments/:transactionId/bank-transfer-proof",
  requireAdmin,
  downloadBankTransferProof
);
router.patch(
  "/admin/payments/:transactionId/bank-transfer-review",
  requireAdmin,
  invalidatePaymentProjectionCache,
  express.json(),
  reviewBankTransferPayment
);
router.post(
  "/admin/payments/:transactionId/reopen",
  requireAdmin,
  invalidatePaymentProjectionCache,
  reopenExpiredPayment
);
router.patch(
  "/admin/payments/:transactionId/payhere-reconciliation",
  requireAdmin,
  invalidatePaymentProjectionCache,
  express.json(),
  reconcilePayHerePayment
);
router.patch(
  "/admin/payments/:transactionId/cash-reconciliation",
  requireAdmin,
  express.json(),
  reconcileCashTicketPayment
);

module.exports = router;
