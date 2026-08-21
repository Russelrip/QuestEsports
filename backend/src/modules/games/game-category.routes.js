const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { dbImageUpload, createUploadRequestSizeGuard } = require("../../middleware/upload");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { env } = require("../../config/env");
const controller = require("./game-category.controller");

const router = express.Router();
const categoryUpload = dbImageUpload.fields([
  { name: "artwork", maxCount: 1 },
  { name: "logo", maxCount: 1 },
]);
const categoryUploadSizeGuard = createUploadRequestSizeGuard(22 * 1024 * 1024);
const publicCategoryCache = cachePublicData({ browserSeconds: 30, sharedSeconds: 60 });
router.get("/game-categories", publicCategoryCache, cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["game-categories"] }), controller.getPublicCategories);
router.get("/admin/game-categories", requireAdmin, controller.getAdminCategories);
router.post("/admin/game-categories", requireAdmin, invalidateCache("game-categories", "tournaments", "foundation"), categoryUploadSizeGuard, categoryUpload, controller.createCategory);
router.patch("/admin/game-categories/:categoryId", requireAdmin, invalidateCache("game-categories", "tournaments", "foundation"), categoryUploadSizeGuard, categoryUpload, controller.updateCategory);
router.delete("/admin/game-categories/:categoryId", requireAdmin, invalidateCache("game-categories", "tournaments", "foundation"), controller.deleteCategory);

module.exports = router;
