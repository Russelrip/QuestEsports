const fs = require("fs/promises");
const path = require("path");
const { HttpError } = require("../../lib/http-error");
const {
  detectImageType,
  teamLogoDirectory,
  tournamentBannerDirectory,
  posterImageDirectory,
} = require("../../middleware/upload");

const UPLOAD_DIRECTORIES = {
  "team-logos": teamLogoDirectory,
  "tournament-banners": tournamentBannerDirectory,
  "poster-images": posterImageDirectory,
};

const CONTENT_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const SAFE_FILENAME_PATTERN =
  /^[a-zA-Z0-9-]+\.(jpg|png|webp)$/;

const isPathInsideDirectory = (directory, targetPath) => {
  const relativePath = path.relative(path.resolve(directory), path.resolve(targetPath));
  return (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const streamUpload = async (directoryKey, filename) => {
  const directory = UPLOAD_DIRECTORIES[directoryKey];

  if (!directory || !SAFE_FILENAME_PATTERN.test(String(filename || ""))) {
    throw new HttpError(404, "File not found.");
  }

  const filePath = path.join(directory, filename);

  if (!isPathInsideDirectory(directory, filePath)) {
    throw new HttpError(404, "File not found.");
  }

  let data;
  try {
    data = await fs.readFile(path.resolve(filePath));
  } catch {
    throw new HttpError(404, "File not found.");
  }

  const detectedType = detectImageType(data);
  if (!detectedType || !CONTENT_TYPES[detectedType]) {
    throw new HttpError(404, "File not found.");
  }

  return {
    data,
    size: data.length,
    contentType: CONTENT_TYPES[detectedType],
  };
};

module.exports = {
  streamUpload,
};
