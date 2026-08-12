const path = require("path");
const { createReadStream } = require("fs");
const { pipeline } = require("stream/promises");
const { asyncHandler } = require("../../lib/async-handler");
const {
  listPublicEventAlbums,
  listAdminEventAlbums,
  getPublicEventAlbumBySlug,
  getAdminEventAlbumById,
  createEventAlbum,
  updateEventAlbum,
  deleteEventAlbum,
  uploadEventAlbumPhotos,
  reorderEventAlbumPhotos,
  deleteEventAlbumPhoto,
  getPublicEventAlbumPhoto,
} = require("./event-album.service");

const safeDownloadName = (value) =>
  path.basename(String(value || "event-photo.jpg")).replace(/[\r\n"\\]/g, "-");

const getEventAlbums = asyncHandler(async (req, res) => {
  const result = await listPublicEventAlbums(req.query);
  res.status(200).json({
    success: true,
    albums: result.items,
    pagination: result.pagination,
    totalPhotos: result.totalPhotos,
  });
});

const getEventAlbum = asyncHandler(async (req, res) => {
  const album = await getPublicEventAlbumBySlug(req.params.slug);
  res.status(200).json({ success: true, album });
});

const streamEventAlbumPhoto = asyncHandler(async (req, res) => {
  const image = await getPublicEventAlbumPhoto({
    slug: req.params.slug,
    photoId: req.params.photoId,
  });
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", image.size ?? image.data.length);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (req.query.download === "1" && image.allowDownloads) {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeDownloadName(image.originalName)}"`
    );
  }
  res.status(200);
  if (image.path) {
    await pipeline(createReadStream(image.path), res);
    return;
  }
  res.send(image.data);
});

const getAdminEventAlbums = asyncHandler(async (req, res) => {
  const result = await listAdminEventAlbums(req.query);
  res.status(200).json({ success: true, albums: result.items, pagination: result.pagination });
});

const getAdminEventAlbum = asyncHandler(async (req, res) => {
  const album = await getAdminEventAlbumById(req.params.albumId);
  res.status(200).json({ success: true, album });
});

const createAdminEventAlbum = asyncHandler(async (req, res) => {
  const album = await createEventAlbum(req.body);
  res.status(201).json({ success: true, message: "Event album created.", album });
});

const updateAdminEventAlbum = asyncHandler(async (req, res) => {
  const album = await updateEventAlbum(req.params.albumId, req.body);
  res.status(200).json({ success: true, message: "Event album updated.", album });
});

const deleteAdminEventAlbum = asyncHandler(async (req, res) => {
  await deleteEventAlbum(req.params.albumId);
  res.status(200).json({ success: true, message: "Event album deleted." });
});

const uploadAdminEventAlbumPhotos = asyncHandler(async (req, res) => {
  const album = await uploadEventAlbumPhotos({
    albumId: req.params.albumId,
    body: req.body,
    files: req.files,
  });
  res.status(201).json({ success: true, message: "Album photos uploaded.", album });
});

const reorderAdminEventAlbumPhotos = asyncHandler(async (req, res) => {
  const album = await reorderEventAlbumPhotos(req.params.albumId, req.body.photoIds);
  res.status(200).json({ success: true, message: "Photo order updated.", album });
});

const deleteAdminEventAlbumPhoto = asyncHandler(async (req, res) => {
  await deleteEventAlbumPhoto(req.params.albumId, req.params.photoId);
  res.status(200).json({ success: true, message: "Album photo deleted." });
});

module.exports = {
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
};
