const express = require("express");
const { imageUpload } = require("../../middleware/upload");
const { submitTournamentRegistration } = require("./tournament.controller");

const router = express.Router();

router.post(
  "/tournament-registration",
  imageUpload.single("teamLogo"),
  submitTournamentRegistration
);

module.exports = router;
