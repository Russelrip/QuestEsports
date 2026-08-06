const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");
const controller = require("./ticket.controller");

const router = express.Router();
const checkoutLimiter = createRateLimiter({
  name: "ticket-checkout",
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  message: "Too many ticket checkout attempts. Please try again later.",
});
const scanLimiter = createRateLimiter({
  name: "ticket-scan",
  windowMs: 60 * 1000,
  maxRequests: 180,
  message: "Ticket scanning is temporarily rate limited.",
});

router.get("/ticket-events", controller.listEvents);
router.get("/ticket-events/:slug", controller.getEvent);
router.post(
  "/ticket-events/:slug/quote",
  checkoutLimiter,
  controller.quoteOrder,
);
router.post(
  "/ticket-events/:slug/orders",
  checkoutLimiter,
  controller.createOrder,
);
router.get("/ticket-orders/status", controller.getOrder);

router.get("/admin/ticket-events", requireAdmin, controller.getAdminEvents);
router.post("/admin/ticket-events", requireAdmin, controller.createAdminEvent);
router.get(
  "/admin/ticket-events/:eventId",
  requireAdmin,
  controller.getAdminEvent,
);
router.patch(
  "/admin/ticket-events/:eventId",
  requireAdmin,
  controller.updateAdminEvent,
);
router.get(
  "/admin/ticket-events/:eventId/orders",
  requireAdmin,
  controller.getAdminOrders,
);
router.get(
  "/admin/ticket-events/:eventId/tickets",
  requireAdmin,
  controller.getAdminTickets,
);
router.get(
  "/admin/ticket-events/:eventId/report",
  requireAdmin,
  controller.exportReport,
);
router.post(
  "/admin/ticket-events/:eventId/scan",
  requireAdmin,
  scanLimiter,
  controller.scanTicket,
);
router.post(
  "/admin/ticket-events/:eventId/tickets/:ticketId/check-in",
  requireAdmin,
  scanLimiter,
  controller.checkInTicket,
);
router.post(
  "/admin/tickets/:ticketId/reissue",
  requireAdmin,
  controller.reissueTicket,
);
router.patch("/admin/tickets/:ticketId", requireAdmin, controller.updateTicket);

module.exports = router;
