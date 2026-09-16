const express = require("express");
const { requireStaffPermission } = require("../permissions/permission.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");
const controller = require("./shop.controller");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { env } = require("../../config/env");

const router = express.Router();
const orderLimiter = createRateLimiter({ name: "shop-order", windowMs: 60 * 60 * 1000, maxRequests: 20, message: "Too many checkout attempts. Please try again later." });
router.get("/products", cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["products"] }), controller.getProducts);
router.get("/commerce/capabilities", controller.getCapabilities);
router.get("/products/:slug", cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["products"] }), controller.getProduct);
router.get("/products/:productId/images/:imageId", controller.streamProductImage);
router.post("/orders", orderLimiter, controller.createOrder);
router.post("/orders/quote", orderLimiter, controller.quoteOrder);
router.get("/orders/status", controller.getOrder);
router.get("/admin/products", requireStaffPermission("shop"), controller.getAdminProducts);
router.post("/admin/products", requireStaffPermission("shop"), invalidateCache("products"), controller.createProduct);
router.patch("/admin/products/:productId", requireStaffPermission("shop"), invalidateCache("products"), controller.updateProduct);
router.delete("/admin/products/:productId", requireStaffPermission("shop"), invalidateCache("products"), controller.deleteProduct);
router.get("/admin/orders", requireStaffPermission("shop"), controller.getAdminOrders);
router.patch("/admin/orders/:orderId", requireStaffPermission("shop"), controller.updateOrder);

module.exports = router;
