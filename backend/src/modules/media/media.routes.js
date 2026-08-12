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
  updatePoster,
  streamPosterImage,
  deletePoster,
  deleteImage,
} = require("./media.controller");
const {
  getEventAlbums,
  getEventAlbum,
  streamEventAlbumPhoto,
  getAdminEventAlbums,
  getAdminEventAlbum,
  createAdminEventAlbum,
  updateAdminEventAlbum,
  deleteAdminEventAlbum,
  uploadAdminEventAlbumPhotos,
  reorderAdminEventAlbumPhotos,
  deleteAdminEventAlbumPhoto,
} = require("./event-album.controller");

const router = express.Router();

router.get("/posters", getPosters);
router.get("/posters/:posterId", getPoster);
router.get("/posters/:posterId/image", streamPosterImage);
router.get("/event-albums", getEventAlbums);
router.get("/event-albums/:slug/photos/:photoId/image", streamEventAlbumPhoto);
router.get("/event-albums/:slug", getEventAlbum);

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
router.patch("/posters/:posterId", requireAdmin, updatePoster);
router.delete("/posters/:posterId", requireAdmin, deletePoster);

router.get("/admin/event-albums", requireAdmin, getAdminEventAlbums);
router.get("/admin/event-albums/:albumId", requireAdmin, getAdminEventAlbum);
router.post("/admin/event-albums", requireAdmin, createAdminEventAlbum);
router.patch("/admin/event-albums/:albumId", requireAdmin, updateAdminEventAlbum);
router.delete("/admin/event-albums/:albumId", requireAdmin, deleteAdminEventAlbum);
router.post(
  "/admin/event-albums/:albumId/photos",
  requireAdmin,
  createUploadRequestSizeGuard(100 * 1024 * 1024),
  dbImageUpload.array("photos", 10),
  uploadAdminEventAlbumPhotos
);
router.patch(
  "/admin/event-albums/:albumId/photos/reorder",
  requireAdmin,
  reorderAdminEventAlbumPhotos
);
router.delete(
  "/admin/event-albums/:albumId/photos/:photoId",
  requireAdmin,
  deleteAdminEventAlbumPhoto
);

module.exports = router;
