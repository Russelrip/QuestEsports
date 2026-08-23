const { asyncHandler } = require("../../lib/async-handler");
const { streamFileToResponse } = require("../../lib/stream-response");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { listPublicUploads } = require("../uploads/upload.service");
const {
  createImageAssets,
  listImageAssets,
  getImageAssetById,
  getImageAssetMetadata,
  getPosterImageAssetByPosterId,
  createPoster,
  listPosters,
  getPosterById,
  updatePosterById,
  deletePosterById,
  deleteUnusedImageAsset,
} = require("./media.service");

const sendImage = async (res, image, cacheControl) => {
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", image.size ?? image.data.length);
  res.setHeader("Cache-Control", cacheControl);
  res.status(200);
  if (image.path) {
    await streamFileToResponse(image.path, res);
    return;
  }
  res.send(image.data);
};

const uploadImages = asyncHandler(async (req, res) => {
  const assets = await createImageAssets({
    body: req.body,
    files: req.files,
  });
  await recordAudit({ ...requestAuditContext(req), action: "media.images.uploaded", targetType: "ImageAsset", afterData: { count: assets.length } });

  res.status(201).json({
    success: true,
    message: "Images uploaded successfully.",
    images: assets,
  });
});

const getImages = asyncHandler(async (req, res) => {
  const result = await listImageAssets(req.query);

  res.status(200).json({
    success: true,
    images: result.items,
    pagination: result.pagination,
  });
});

const getPublicUploadFiles = asyncHandler(async (req, res) => {
  const result = await listPublicUploads(req.query);
  res.status(200).json({
    success: true,
    files: result.items,
    directories: result.directories,
    totalBytes: result.totalBytes,
    pagination: result.pagination,
  });
});

const getImage = asyncHandler(async (req, res) => {
  const image = await getImageAssetMetadata(req.params.imageId);

  res.status(200).json({
    success: true,
    image,
  });
});

const streamImage = asyncHandler(async (req, res) => {
  const image = await getImageAssetById(req.params.imageId);

  await sendImage(res, image, "private, no-store");
});

const streamPosterImage = asyncHandler(async (req, res) => {
  const image = await getPosterImageAssetByPosterId(req.params.posterId);

  await sendImage(res, image, "public, max-age=31536000, immutable");
});

const createPosterEntry = asyncHandler(async (req, res) => {
  const poster = await createPoster({ body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "media.poster.created", targetType: "Poster", targetId: poster.id, afterData: { tournamentId: poster.tournamentId } });

  res.status(201).json({
    success: true,
    message: "Poster created successfully.",
    poster,
  });
});

const getPosters = asyncHandler(async (req, res) => {
  const result = await listPosters(req.query);

  res.status(200).json({
    success: true,
    posters: result.items,
    pagination: result.pagination,
  });
});

const getPoster = asyncHandler(async (req, res) => {
  const poster = await getPosterById(req.params.posterId);

  res.status(200).json({
    success: true,
    poster,
  });
});

const deletePoster = asyncHandler(async (req, res) => {
  await deletePosterById(req.params.posterId);
  await recordAudit({ ...requestAuditContext(req), action: "media.poster.deleted", targetType: "Poster", targetId: req.params.posterId });

  res.status(200).json({
    success: true,
    message: "Poster deleted successfully.",
  });
});

const updatePoster = asyncHandler(async (req, res) => {
  const poster = await updatePosterById(req.params.posterId, req.body);
  await recordAudit({ ...requestAuditContext(req), action: "media.poster.updated", targetType: "Poster", targetId: poster.id, afterData: { tournamentId: poster.tournamentId } });
  res.status(200).json({ success: true, message: "Tournament media updated.", poster });
});

const deleteImage = asyncHandler(async (req, res) => {
  await deleteUnusedImageAsset(req.params.imageId);
  await recordAudit({ ...requestAuditContext(req), action: "media.image.deleted", targetType: "ImageAsset", targetId: req.params.imageId });
  res.status(200).json({ success: true, message: "Unused image removed." });
});

module.exports = {
  uploadImages,
  getImages,
  getPublicUploadFiles,
  getImage,
  streamImage,
  streamPosterImage,
  createPosterEntry,
  getPosters,
  getPoster,
  updatePoster,
  deletePoster,
  deleteImage,
};
