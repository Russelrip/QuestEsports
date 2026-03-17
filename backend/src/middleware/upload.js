const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { HttpError } = require("../lib/http-error");

const uploadRoot = path.join(__dirname, "../../uploads");
const teamLogoDirectory = path.join(uploadRoot, "team-logos");
const tournamentBannerDirectory = path.join(uploadRoot, "tournament-banners");
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

const createImageUpload = (directory, invalidMessage) =>
  multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, callback) => {
      if (
        file.mimetype === "image/jpeg" ||
        file.mimetype === "image/png" ||
        file.mimetype === "image/webp"
      ) {
        callback(null, true);
        return;
      }

      callback(new HttpError(400, invalidMessage));
    },
  });

const imageUpload = createImageUpload(
  teamLogoDirectory,
  "Only image files are allowed for team logos."
);

const tournamentBannerUpload = createImageUpload(
  tournamentBannerDirectory,
  "Only image files are allowed for tournament banners."
);

const dbImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (req, file, callback) => {
    if (
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/webp"
    ) {
      callback(null, true);
      return;
    }

    callback(new HttpError(400, "Only JPEG, PNG, and WebP images are allowed."));
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

module.exports = {
  ALLOWED_UPLOAD_TYPES,
  detectImageType,
  ensureUploadDirectories,
  imageUpload,
  tournamentBannerUpload,
  dbImageUpload,
  persistTeamLogoUpload,
  persistTournamentBannerUpload,
  teamLogoDirectory,
  tournamentBannerDirectory,
};
