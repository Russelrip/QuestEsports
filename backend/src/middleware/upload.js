const fs = require("fs/promises");
const path = require("path");
const multer = require("multer");
const { HttpError } = require("../lib/http-error");

const uploadRoot = path.join(__dirname, "../../uploads");
const teamLogoDirectory = path.join(uploadRoot, "team-logos");

const ensureUploadDirectories = async () => {
  await fs.mkdir(teamLogoDirectory, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, teamLogoDirectory);
  },
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const safeBaseName = path
      .basename(file.originalname || "team-logo", extension)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .slice(0, 50);

    callback(
      null,
      `${Date.now()}-${safeBaseName || "team-logo"}${extension || ".png"}`
    );
  },
});

const imageUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }

    callback(new HttpError(400, "Only image files are allowed for team logos."));
  },
});

module.exports = {
  ensureUploadDirectories,
  imageUpload,
};
