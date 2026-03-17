const express = require("express");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
const { dbImageUpload } = require("../../middleware/upload");
const {
  uploadImages,
  getImages,
  getImage,
  streamImage,
  createPosterEntry,
  getPosters,
  getPoster,
  streamPosterImage,
  deletePoster,
} = require("./media.controller");

const router = express.Router();

router.get("/posters", getPosters);
router.get("/posters/:posterId", getPoster);
router.get("/posters/:posterId/image", streamPosterImage);

router.use(attachSession);
router.get("/images", requireAdmin, getImages);
router.get("/images/:imageId", requireAdmin, getImage);
router.get("/images/:imageId/binary", requireAdmin, streamImage);
router.post("/images", requireAdmin, dbImageUpload.array("images", 10), uploadImages);
router.post("/posters", requireAdmin, createPosterEntry);
router.delete("/posters/:posterId", requireAdmin, deletePoster);

module.exports = router;
