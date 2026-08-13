const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const { HttpError } = require("../lib/http-error");
const { env } = require("../config/env");

const uploadRoot = env.UPLOAD_ROOT
  ? path.resolve(env.UPLOAD_ROOT)
  : path.join(__dirname, "../../uploads");
const teamLogoDirectory = path.join(uploadRoot, "team-logos");
const tournamentBannerDirectory = path.join(uploadRoot, "tournament-banners");
const posterImageDirectory = path.join(uploadRoot, "poster-images");
const tournamentScheduleDirectory = path.join(uploadRoot, "tournament-schedules");
const avatarDirectory = path.join(uploadRoot, "avatars");
const gameAssetDirectory = path.join(uploadRoot, "game-assets");
const sponsorLogoDirectory = path.join(uploadRoot, "sponsor-logos");
const privateUploadRoot = env.PRIVATE_UPLOAD_ROOT
  ? path.resolve(env.PRIVATE_UPLOAD_ROOT)
  : path.resolve(uploadRoot, "../private");
const bankTransferProofDirectory = path.join(privateUploadRoot, "bank-transfer-proofs");
const TEAM_LOGO_MAX_FILE_SIZE = 5 * 1024 * 1024;
const PAYMENT_PROOF_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ADMIN_UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_FIELD_LIMITS = {
  fieldNameSize: 80,
  fieldSize: 64 * 1024,
  fieldNestingDepth: 3,
  headerPairs: 100,
};
const READINESS_CACHE_MS = 30 * 1000;
let uploadReadinessPromise = null;
let lastSuccessfulReadinessAt = 0;

const createUploadRequestSizeGuard = (maxBytes) => (req, res, next) => {
  const contentLength = Number.parseInt(req.headers["content-length"], 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    next(new HttpError(413, "The combined upload is too large."));
    return;
  }
  next();
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
  await fs.mkdir(avatarDirectory, { recursive: true });
  await fs.mkdir(gameAssetDirectory, { recursive: true });
  await fs.mkdir(sponsorLogoDirectory, { recursive: true });
  await fs.mkdir(bankTransferProofDirectory, { recursive: true, mode: 0o700 });
};

const checkUploadReadiness = async () => {
  if (Date.now() - lastSuccessfulReadinessAt < READINESS_CACHE_MS) {
    return true;
  }
  if (uploadReadinessPromise) {
    return uploadReadinessPromise;
  }

  uploadReadinessPromise = Promise.all(
    [uploadRoot, privateUploadRoot].map(async (directory) => {
      const probePath = path.join(
        directory,
        `.quest-readiness-${process.pid}-${crypto.randomUUID()}`
      );
      try {
        await fs.writeFile(probePath, "ready", { flag: "wx", mode: 0o600 });
        await fs.rm(probePath);
      } finally {
        await fs.rm(probePath, { force: true }).catch(() => undefined);
      }
    })
  )
    .then(() => {
      lastSuccessfulReadinessAt = Date.now();
      return true;
    })
    .finally(() => {
      uploadReadinessPromise = null;
    });

  return uploadReadinessPromise;
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

const normalizeImageUpload = async ({
  file,
  invalidMessage,
  maxDimension = 4096,
  outputFormat,
  quality = 88,
}) => {
  const validated = validateImageUpload({ file, invalidMessage });
  try {
    const pipeline = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: maxDimension * maxDimension * 4,
    })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    let buffer;
    if (outputFormat === "webp") {
      buffer = await pipeline.webp({ quality, effort: 5 }).toBuffer();
    } else if (validated.detectedType === "jpeg") {
      buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    } else if (validated.detectedType === "png") {
      buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    } else {
      buffer = await pipeline.webp({ quality }).toBuffer();
    }
    return outputFormat === "webp"
      ? { ...validated, contentType: "image/webp", extension: ".webp", buffer }
      : { ...validated, buffer };
  } catch {
    throw new HttpError(400, invalidMessage);
  }
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

const buildUploadLimits = ({ fileSize, files = 1, fields = 40, parts, fieldSize } = {}) => ({
  ...DEFAULT_FIELD_LIMITS,
  ...(fieldSize ? { fieldSize } : {}),
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

const avatarUpload = createImageUpload(
  "Only JPEG, PNG, and WebP profile pictures are allowed.",
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
    files: 7,
    fields: 60,
    fieldSize: 512 * 1024,
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

const paymentProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: buildUploadLimits({
    fileSize: PAYMENT_PROOF_MAX_FILE_SIZE,
    files: 1,
    fields: 5,
  }),
  fileFilter: (req, file, callback) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(400, "Only JPEG, PNG, or WebP payment proof screenshots are allowed."));
  },
});

const persistValidatedUpload = async ({
  file,
  directory,
  invalidMessage,
  maxDimension,
  outputFormat,
  quality,
}) => {
  if (!file?.buffer) {
    return null;
  }

  const { contentType, extension, buffer } = await normalizeImageUpload({
    file,
    invalidMessage,
    maxDimension,
    outputFormat,
    quality,
  });
  const filename = buildSafeUploadFilename(extension);
  const filePath = path.join(directory, filename);

  await fs.writeFile(filePath, buffer);

  return {
    filename,
    contentType,
    byteSize: buffer.length,
  };
};

const persistTeamLogoUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: teamLogoDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP team logos are allowed.",
    maxDimension: 2048,
  });

const persistAvatarUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: avatarDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP profile pictures are allowed.",
    maxDimension: 2048,
  });

const persistTournamentBannerUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: tournamentBannerDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP tournament banners are allowed.",
    maxDimension: 2400,
    outputFormat: "webp",
    quality: 82,
  });

const persistPosterImageUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: posterImageDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP poster images are allowed.",
  });

const persistGameAssetUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: gameAssetDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP game artwork is allowed.",
    maxDimension: 2400,
  });

const persistSponsorLogoUpload = (file) =>
  persistValidatedUpload({
    file,
    directory: sponsorLogoDirectory,
    invalidMessage: "Only JPEG, PNG, and WebP sponsor logos are allowed.",
    maxDimension: 2048,
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

const persistBankTransferProofUpload = async (file) => {
  if (!file?.buffer) {
    throw new HttpError(400, "Choose a payment receipt to upload.");
  }

  const normalized = await normalizeImageUpload({
    file,
    invalidMessage: "The uploaded payment proof is not a valid JPEG, PNG, or WebP image.",
    maxDimension: 4096,
  });
  const { buffer, contentType, extension } = normalized;

  const filename = buildSafeUploadFilename(extension);
  await fs.writeFile(path.join(bankTransferProofDirectory, filename), buffer, {
    mode: 0o600,
  });

  return {
    filename,
    originalFilename: path.basename(file.originalname || `receipt${extension}`).slice(0, 180),
    contentType,
    byteSize: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
};

module.exports = {
  ADMIN_UPLOAD_MAX_FILE_SIZE,
  ALLOWED_UPLOAD_TYPES,
  TEAM_LOGO_MAX_FILE_SIZE,
  PAYMENT_PROOF_MAX_FILE_SIZE,
  createUploadRequestSizeGuard,
  detectImageType,
  normalizeImageUpload,
  ensureUploadDirectories,
  checkUploadReadiness,
  imageUpload,
  avatarUpload,
  tournamentBannerUpload,
  adminTournamentAssetsUpload,
  dbImageUpload,
  paymentProofUpload,
  persistTeamLogoUpload,
  persistAvatarUpload,
  persistTournamentBannerUpload,
  persistPosterImageUpload,
  persistGameAssetUpload,
  persistSponsorLogoUpload,
  persistTournamentScheduleUpload,
  persistBankTransferProofUpload,
  removeUploadFile,
  removeUploadFiles,
  teamLogoDirectory,
  tournamentBannerDirectory,
  posterImageDirectory,
  tournamentScheduleDirectory,
  avatarDirectory,
  gameAssetDirectory,
  sponsorLogoDirectory,
  bankTransferProofDirectory,
};
