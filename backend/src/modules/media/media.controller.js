const { asyncHandler } = require("../../lib/async-handler");
const {
  createImageAssets,
  listImageAssets,
  getImageAssetById,
  getImageAssetMetadata,
  getPosterImageAssetByPosterId,
  createPoster,
  listPosters,
  getPosterById,
  deletePosterById,
} = require("./media.service");

const sendImageBuffer = (res, image, cacheControl) => {
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", image.data.length);
  res.setHeader("Cache-Control", cacheControl);
  res.status(200).send(image.data);
};

const uploadImages = asyncHandler(async (req, res) => {
  const assets = await createImageAssets({
    body: req.body,
    files: req.files,
  });

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

const getImage = asyncHandler(async (req, res) => {
  const image = await getImageAssetMetadata(req.params.imageId);

  res.status(200).json({
    success: true,
    image,
  });
});

const streamImage = asyncHandler(async (req, res) => {
  const image = await getImageAssetById(req.params.imageId);

  sendImageBuffer(res, image, "private, no-store");
});

const streamPosterImage = asyncHandler(async (req, res) => {
  const image = await getPosterImageAssetByPosterId(req.params.posterId);

  sendImageBuffer(res, image, "public, max-age=31536000, immutable");
});

const createPosterEntry = asyncHandler(async (req, res) => {
  const poster = await createPoster({ body: req.body });

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

  res.status(200).json({
    success: true,
    message: "Poster deleted successfully.",
  });
});

module.exports = {
  uploadImages,
  getImages,
  getImage,
  streamImage,
  streamPosterImage,
  createPosterEntry,
  getPosters,
  getPoster,
  deletePoster,
};
