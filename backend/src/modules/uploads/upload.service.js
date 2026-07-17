const fs = require("fs/promises");
const path = require("path");
const { HttpError } = require("../../lib/http-error");
const {
  detectImageType,
  teamLogoDirectory,
  tournamentBannerDirectory,
  posterImageDirectory,
  avatarDirectory,
  gameAssetDirectory,
  sponsorLogoDirectory,
} = require("../../middleware/upload");

const UPLOAD_DIRECTORIES = {
  "team-logos": teamLogoDirectory,
  "tournament-banners": tournamentBannerDirectory,
  "poster-images": posterImageDirectory,
  avatars: avatarDirectory,
  "game-assets": gameAssetDirectory,
  "sponsor-logos": sponsorLogoDirectory,
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

  let handle;
  try {
    handle = await fs.open(path.resolve(filePath), "r");
    const header = Buffer.alloc(12);
    const [{ bytesRead }, stats] = await Promise.all([
      handle.read(header, 0, header.length, 0),
      handle.stat(),
    ]);
    const detectedType = detectImageType(header.subarray(0, bytesRead));
    if (!detectedType || !CONTENT_TYPES[detectedType] || !stats.isFile()) {
      throw new HttpError(404, "File not found.");
    }

    return {
      path: path.resolve(filePath),
      size: stats.size,
      contentType: CONTENT_TYPES[detectedType],
    };
  } catch {
    throw new HttpError(404, "File not found.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

module.exports = {
  streamUpload,
};
