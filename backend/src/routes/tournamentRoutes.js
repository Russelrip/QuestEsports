const express = require("express");
const multer = require("multer");
const path = require("path");
const { submitTournamentRegistration } = require("../controllers/tournamentController");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/team-logos");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

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

router.post("/tournament-registration", upload.single("teamLogo"), submitTournamentRegistration);

module.exports = router;