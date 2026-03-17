const fs = require("fs/promises");
const path = require("path");
const multer = require("multer");
const { HttpError } = require("../lib/http-error");

const uploadRoot = path.join(__dirname, "../../uploads");
const teamLogoDirectory = path.join(uploadRoot, "team-logos");
const tournamentBannerDirectory = path.join(uploadRoot, "tournament-banners");

const ensureUploadDirectories = async () => {
  await fs.mkdir(teamLogoDirectory, { recursive: true });
  await fs.mkdir(tournamentBannerDirectory, { recursive: true });
};

const createImageUpload = (directory, invalidMessage) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, file, callback) => {
        callback(null, directory);
      },
      filename: (req, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        const safeBaseName = path
          .basename(file.originalname || "image", extension)
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 50);

        callback(
          null,
          `${Date.now()}-${safeBaseName || "image"}${extension || ".png"}`
        );
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, callback) => {
      if (file.mimetype.startsWith("image/")) {
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

module.exports = {
  ensureUploadDirectories,
  imageUpload,
  tournamentBannerUpload,
};
