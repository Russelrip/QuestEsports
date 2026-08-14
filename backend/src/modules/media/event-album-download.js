const path = require("path");
const sharp = require("sharp");

const CONTENT_TYPE_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const EXTENSION_BY_CONTENT_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const normalizeContentType = (value) => String(value || "")
  .split(";", 1)[0]
  .trim()
  .toLowerCase();

const getDownloadContentType = (originalName, fallbackContentType) => {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension]
    || normalizeContentType(fallbackContentType)
    || "image/jpeg";
};

const safeDownloadName = (value, contentType) => {
  const parsed = path.parse(path.basename(String(value || "event-photo")));
  const extension = EXTENSION_BY_CONTENT_TYPE[normalizeContentType(contentType)] || ".jpg";
  const baseName = (parsed.name || "event-photo")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/[\r\n"\\]/g, "-")
    .trim() || "event-photo";
  return `${baseName}${extension}`;
};

const transcodeImage = async (image, contentType) => {
  const input = image.path || image.data;
  let pipeline = sharp(input, { failOn: "warning" });

  if (contentType === "image/jpeg") {
    pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  } else if (contentType === "image/png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else {
    pipeline = pipeline.webp({ quality: 95, effort: 5 });
  }

  return pipeline.toBuffer();
};

const prepareEventAlbumPhotoDownload = async (image) => {
  const contentType = getDownloadContentType(image.originalName, image.contentType);
  const filename = safeDownloadName(image.originalName, contentType);

  if (normalizeContentType(image.contentType) === contentType) {
    return { ...image, contentType, filename };
  }

  const data = await transcodeImage(image, contentType);
  return {
    contentType,
    data,
    size: data.length,
    filename,
  };
};

module.exports = {
  getDownloadContentType,
  normalizeContentType,
  prepareEventAlbumPhotoDownload,
  safeDownloadName,
};
