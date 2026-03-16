const express = require("express");
const multer = require("multer");
const path = require("path");
const { submitTournamentRegistration } = require("../controllers/tournamentController");

const router = express.Router();

// Multer stores uploaded team logos on disk with unique filenames to avoid collisions.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/team-logos");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Restrict uploads to images because the registration form only accepts team logo files.
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed."), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// The controller receives both text fields and the optional uploaded file from this route.
router.post("/tournament-registration", upload.single("teamLogo"), submitTournamentRegistration);

module.exports = router;
