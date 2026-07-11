const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
  attachSession,
  requireAuth,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
const {
  getProfileTeams,
  createProfileTeam,
  previewTeamInvite,
  respondTeamInvite,
} = require("./team.controller");
const { imageUpload } = require("../../middleware/upload");

const router = express.Router();
const teamInviteRateLimiter = createRateLimiter({
  name: "team-invite-response",
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: "Too many invite responses. Please try again later.",
});
const createTeamRateLimiter = createRateLimiter({
  name: "create-team",
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: "Too many teams created. Please try again later.",
});

router.use(attachSession);

router.get("/teams/profile", requireAuth, getProfileTeams);
router.post(
  "/teams",
  requireAuth,
  requireVerifiedEmail,
  createTeamRateLimiter,
  imageUpload.single("teamLogo"),
  createProfileTeam
);
router.get("/team-invite", previewTeamInvite);
router.post(
  "/team-invite/respond",
  requireAuth,
  requireVerifiedEmail,
  teamInviteRateLimiter,
  respondTeamInvite
);

module.exports = router;
