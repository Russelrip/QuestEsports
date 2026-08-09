const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { dbImageUpload, createUploadRequestSizeGuard } = require("../../middleware/upload");
const {
  uploadImages,
  getImages,
  getPublicUploadFiles,
  getImage,
  streamImage,
  createPosterEntry,
  getPosters,
  getPoster,
  streamPosterImage,
  deletePoster,
  deleteImage,
} = require("./media.controller");

const router = express.Router();

router.get("/posters", getPosters);
router.get("/posters/:posterId", getPoster);
router.get("/posters/:posterId/image", streamPosterImage);

router.get("/images", requireAdmin, getImages);
router.get("/admin/media/files", requireAdmin, getPublicUploadFiles);
router.get("/images/:imageId", requireAdmin, getImage);
router.get("/images/:imageId/binary", requireAdmin, streamImage);
router.post(
  "/images",
  requireAdmin,
  createUploadRequestSizeGuard(35 * 1024 * 1024),
  dbImageUpload.array("images", 10),
  uploadImages
);
router.delete("/images/:imageId", requireAdmin, deleteImage);
router.post("/posters", requireAdmin, createPosterEntry);
router.delete("/posters/:posterId", requireAdmin, deletePoster);

module.exports = router;
