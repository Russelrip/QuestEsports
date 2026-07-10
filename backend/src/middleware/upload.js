const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { HttpError } = require("../lib/http-error");

const uploadRoot = path.join(__dirname, "../../uploads");
const teamLogoDirectory = path.join(uploadRoot, "team-logos");
const tournamentBannerDirectory = path.join(uploadRoot, "tournament-banners");
const posterImageDirectory = path.join(uploadRoot, "poster-images");
const tournamentScheduleDirectory = path.join(uploadRoot, "tournament-schedules");
const TEAM_LOGO_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ADMIN_UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_FIELD_LIMITS = {
  fieldNameSize: 80,
  fieldSize: 64 * 1024,
  fieldNestingDepth: 3,
  headerPairs: 100,
};
const ALLOWED_UPLOAD_TYPES = {
  jpeg: {
    extensions: new Set([".jpg", ".jpeg"]),
    contentType: "image/jpeg",
  },
  png: {
    extensions: new Set([".png"]),
    contentType: "image/png",
  },
  webp: {
    extensions: new Set([".webp"]),
    contentType: "image/webp",
  },
};

const ensureUploadDirectories = async () => {
  await fs.mkdir(teamLogoDirectory, { recursive: true });
  await fs.mkdir(tournamentBannerDirectory, { recursive: true });
  await fs.mkdir(posterImageDirectory, { recursive: true });
  await fs.mkdir(tournamentScheduleDirectory, { recursive: true });
};

const detectImageType = (buffer) => {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
};

const getExtensionForImageType = (imageType) => {
  switch (imageType) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    default:
      return null;
  }
};

const validateImageUpload = ({ file, invalidMessage }) => {
  const detectedType = detectImageType(file.buffer);
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (!detectedType) {
    throw new HttpError(400, invalidMessage);
  }

  const allowedType = ALLOWED_UPLOAD_TYPES[detectedType];
  if (!allowedType || !allowedType.extensions.has(extension)) {
    throw new HttpError(400, invalidMessage);
  }

  return {
    detectedType,
    contentType: allowedType.contentType,
    extension: getExtensionForImageType(detectedType),
  };
};

const buildSafeUploadFilename = (extension) =>
  `${Date.now()}-${crypto.randomUUID()}${extension}`;

const isPathInsideDirectory = (directory, targetPath) => {
  const relativePath = path.relative(path.resolve(directory), path.resolve(targetPath));
  return (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const removeUploadFile = async ({ directory, filename }) => {
  if (!directory || !filename) {
    return;
  }

  const filePath = path.join(directory, filename);

  if (!isPathInsideDirectory(directory, filePath)) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
};

const removeUploadFiles = async (uploads) => {
  const results = await Promise.allSettled(
    uploads
      .filter((upload) => upload?.directory && upload?.filename)
      .map((upload) => removeUploadFile(upload))
  );
  const rejected = results.find((result) => result.status === "rejected");

  if (rejected) {
    throw rejected.reason;
  }
};

const buildUploadLimits = ({ fileSize, files = 1, fields = 40, parts } = {}) => ({
  ...DEFAULT_FIELD_LIMITS,
  fileSize,
  files,
  fields,
  parts: parts || files + fields,
});

const isAllowedImageMimeType = (mimetype) =>
  mimetype === "image/jpeg" ||
  mimetype === "image/png" ||
  mimetype === "image/webp";

const createImageUpload = (invalidMessage, fileSize) =>
  multer({
    storage: multer.memoryStorage(),
    limits: buildUploadLimits({
      fileSize,
      fields: 60,
    }),
    fileFilter: (req, file, callback) => {
      if (isAllowedImageMimeType(file.mimetype)) {
        callback(null, true);
        return;
      }

      callback(new HttpError(400, invalidMessage));
    },
  });

const imageUpload = createImageUpload(
  "Only image files are allowed for team logos.",
  TEAM_LOGO_MAX_FILE_SIZE
);

const tournamentBannerUpload = createImageUpload(
  "Only image files are allowed for tournament banners.",
  ADMIN_UPLOAD_MAX_FILE_SIZE
);

const dbImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: buildUploadLimits({
    fileSize: ADMIN_UPLOAD_MAX_FILE_SIZE,
    files: 10,
    fields: 20,
  }),
  fileFilter: (req, file, callback) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(400, "Only JPEG, PNG, and WebP images are allowed."));
  },
});

const adminTournamentAssetsUpload = multer({
  storage: multer.memoryStorage(),
  limits: buildUploadLimits({
    fileSize: ADMIN_UPLOAD_MAX_FILE_SIZE,
    files: 6,
    fields: 60,
  }),
  fileFilter: (req, file, callback) => {
    if (
      file.fieldname === "scheduleFile" &&
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "application/csv",
        "text/plain",
      ].includes(file.mimetype)
    ) {
      callback(null, true);
      return;
    }

    if (isAllowedImageMimeType(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(400, "Only supported image or spreadsheet files are allowed."));
  },
});

const persistValidatedUpload = async ({ file, directory, invalidMessage }) => {
  if (!file?.buffer) {
    return null;
  }

  const { contentType, extension } = validateImageUpload({
    file,
    invalidMessage,
  });
  const filename = buildSafeUploadFilename(extension);
  const filePath = path.join(directory, filename);

  await fs.writeFile(filePath, file.buffer);

  return {
    filename,
    contentType,
  };
};

const persistTeamLogoUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: teamLogoDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP team logos are allowed.",
  });

const persistTournamentBannerUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: tournamentBannerDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP tournament banners are allowed.",
  });

const persistPosterImageUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: posterImageDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP poster images are allowed.",
  });

const persistTournamentScheduleUpload = async (file) => {
  if (!file?.buffer) {
    return null;
  }

  const extension = path.extname(file.originalname || "").toLowerCase();

  if (![".xlsx", ".csv"].includes(extension)) {
    throw new HttpError(400, "Only XLSX and CSV schedule files are allowed.");
  }

  const filename = buildSafeUploadFilename(extension);
  const filePath = path.join(tournamentScheduleDirectory, filename);
  await fs.writeFile(filePath, file.buffer);

  return {
    filename,
    extension,
  };
};

module.exports = {
  ADMIN_UPLOAD_MAX_FILE_SIZE,
  ALLOWED_UPLOAD_TYPES,
  TEAM_LOGO_MAX_FILE_SIZE,
  detectImageType,
  ensureUploadDirectories,
  imageUpload,
  tournamentBannerUpload,
  adminTournamentAssetsUpload,
  dbImageUpload,
  persistTeamLogoUpload,
  persistTournamentBannerUpload,
  persistPosterImageUpload,
  persistTournamentScheduleUpload,
  removeUploadFile,
  removeUploadFiles,
  teamLogoDirectory,
  tournamentBannerDirectory,
  posterImageDirectory,
  tournamentScheduleDirectory,
};
