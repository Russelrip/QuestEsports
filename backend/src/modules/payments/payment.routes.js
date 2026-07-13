const express = require("express");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
const { notifyPayHere, readPaymentStatus, getAdminPayments } = require("./payment.controller");
const { createRateLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const notificationLimiter = createRateLimiter({
  name: "payhere-notification",
  windowMs: 60 * 60 * 1000,
  maxRequests: 600,
  message: "Too many payment notifications.",
});
router.use(attachSession);
router.post("/payments/payhere/notify", notificationLimiter, notifyPayHere);
router.get("/payments/:orderId", readPaymentStatus);
router.get("/admin/payments", requireAdmin, getAdminPayments);

module.exports = router;
