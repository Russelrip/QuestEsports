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
  deletePoster,
} = require("./media.controller");

const router = express.Router();

router.get("/images", getImages);
router.get("/images/:imageId", getImage);
router.get("/images/:imageId/binary", streamImage);
router.get("/posters", getPosters);
router.get("/posters/:posterId", getPoster);

router.use(attachSession);
router.post("/images", requireAdmin, dbImageUpload.array("images", 10), uploadImages);
router.post("/posters", requireAdmin, createPosterEntry);
router.delete("/posters/:posterId", requireAdmin, deletePoster);

module.exports = router;
