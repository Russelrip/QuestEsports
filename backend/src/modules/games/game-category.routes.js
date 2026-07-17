const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { dbImageUpload, createUploadRequestSizeGuard } = require("../../middleware/upload");
const controller = require("./game-category.controller");

const router = express.Router();
const categoryUpload = dbImageUpload.fields([
  { name: "artwork", maxCount: 1 },
  { name: "logo", maxCount: 1 },
]);
const categoryUploadSizeGuard = createUploadRequestSizeGuard(22 * 1024 * 1024);
router.get("/game-categories", controller.getPublicCategories);
router.get("/admin/game-categories", requireAdmin, controller.getAdminCategories);
router.post("/admin/game-categories", requireAdmin, categoryUploadSizeGuard, categoryUpload, controller.createCategory);
router.patch("/admin/game-categories/:categoryId", requireAdmin, categoryUploadSizeGuard, categoryUpload, controller.updateCategory);
router.delete("/admin/game-categories/:categoryId", requireAdmin, controller.deleteCategory);

module.exports = router;
