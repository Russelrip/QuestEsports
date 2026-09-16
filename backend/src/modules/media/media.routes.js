const express = require("express");
const { requireStaffPermission } = require("../permissions/permission.middleware");
const { dbImageUpload, createUploadRequestSizeGuard } = require("../../middleware/upload");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { cachePublicData } = require("../../middleware/cache-control");
const { env } = require("../../config/env");
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
  streamAdminEventAlbumPhoto,
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
const eventAlbumCache = cacheJson({
  ttlSeconds: env.CACHE_TTL_SECONDS,
  tags: ["event-albums", "tournaments", "foundation"],
  allowCookies: true,
});
const eventAlbumPublicCache = cachePublicData({ browserSeconds: 60, sharedSeconds: 300 });

router.get("/posters", getPosters);
router.get("/posters/:posterId", getPoster);
router.get("/posters/:posterId/image", streamPosterImage);
router.get("/event-albums", eventAlbumPublicCache, eventAlbumCache, getEventAlbums);
router.get("/event-albums/:slug/photos/:photoId/image", streamEventAlbumPhoto);
router.get("/event-albums/:slug", eventAlbumPublicCache, eventAlbumCache, getEventAlbum);

router.get("/images", requireStaffPermission("media", "shop"), getImages);
router.get("/admin/media/files", requireStaffPermission("media"), getPublicUploadFiles);
router.get("/images/:imageId", requireStaffPermission("media", "shop"), getImage);
router.get("/images/:imageId/binary", requireStaffPermission("media", "shop"), streamImage);
router.post(
  "/images",
  requireStaffPermission("media", "shop"),
  createUploadRequestSizeGuard(35 * 1024 * 1024),
  dbImageUpload.array("images", 10),
  uploadImages
);
router.delete("/images/:imageId", requireStaffPermission("media", "shop"), deleteImage);
router.post("/posters", requireStaffPermission("media"), invalidateCache("tournaments", "foundation"), createPosterEntry);
router.patch("/posters/:posterId", requireStaffPermission("media"), invalidateCache("tournaments", "foundation"), updatePoster);
router.delete("/posters/:posterId", requireStaffPermission("media"), invalidateCache("tournaments", "foundation"), deletePoster);

router.get("/admin/event-albums", requireStaffPermission("media"), getAdminEventAlbums);
router.get(
  "/admin/event-albums/:albumId/photos/:photoId/image",
  requireStaffPermission("media"),
  streamAdminEventAlbumPhoto
);
router.get("/admin/event-albums/:albumId", requireStaffPermission("media"), getAdminEventAlbum);
router.post(
  "/admin/event-albums",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  createAdminEventAlbum
);
router.patch(
  "/admin/event-albums/:albumId",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  updateAdminEventAlbum
);
router.delete(
  "/admin/event-albums/:albumId",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  deleteAdminEventAlbum
);
router.post(
  "/admin/event-albums/:albumId/photos",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  createUploadRequestSizeGuard(25 * 1024 * 1024),
  dbImageUpload.array("photos", 10),
  uploadAdminEventAlbumPhotos
);
router.patch(
  "/admin/event-albums/:albumId/photos/reorder",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  reorderAdminEventAlbumPhotos
);
router.delete(
  "/admin/event-albums/:albumId/photos/:photoId",
  requireStaffPermission("media"),
  invalidateCache("event-albums", "tournaments", "foundation"),
  deleteAdminEventAlbumPhoto
);

module.exports = router;
