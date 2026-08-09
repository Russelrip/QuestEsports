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
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

const normalizePageNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const contentTypeFromFilename = (filename) => {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
};

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

const listPublicUploads = async (query = {}) => {
  const requestedDirectory = String(query.directory || "").trim();
  const directoryKeys = requestedDirectory && UPLOAD_DIRECTORIES[requestedDirectory]
    ? [requestedDirectory]
    : Object.keys(UPLOAD_DIRECTORIES);
  const search = String(query.search || "").trim().toLowerCase();
  const page = normalizePageNumber(query.page, 1);
  const pageSize = Math.min(normalizePageNumber(query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  const groups = await Promise.all(
    directoryKeys.map(async (directoryKey) => {
      const directory = UPLOAD_DIRECTORIES[directoryKey];
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }

      const filenames = entries
        .filter((entry) => entry.isFile() && SAFE_FILENAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .filter((filename) => !search || filename.toLowerCase().includes(search));

      return Promise.all(
        filenames.map(async (filename) => {
          const stats = await fs.stat(path.join(directory, filename));
          return {
            directory: directoryKey,
            filename,
            contentType: contentTypeFromFilename(filename),
            byteSize: stats.size,
            modifiedAt: stats.mtime,
            imageUrl: `/api/uploads/${directoryKey}/${filename}`,
          };
        })
      );
    })
  );

  const files = groups
    .flat()
    .sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
  const total = files.length;

  return {
    items: files.slice((page - 1) * pageSize, page * pageSize),
    directories: Object.keys(UPLOAD_DIRECTORIES),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
};

module.exports = {
  streamUpload,
  listPublicUploads,
};
