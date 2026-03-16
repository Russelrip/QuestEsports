const express = require("express");
const { imageUpload } = require("../../middleware/upload");
const { attachSession } = require("../auth/auth.middleware");
const {
  getTournamentRegistrationStatus,
  submitTournamentRegistration,
} = require("./tournament.controller");

const router = express.Router();

router.use(attachSession);
router.get(
  "/tournament-registration/status/:slug",
  getTournamentRegistrationStatus
);
router.post(
  "/tournament-registration",
  imageUpload.single("teamLogo"),
  submitTournamentRegistration
);

module.exports = router;
