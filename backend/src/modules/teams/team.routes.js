const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
  requireAuth,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
const {
  getProfileTeams,
  createProfileTeam,
  updateProfileTeam,
  deleteProfileTeam,
  resendProfileTeamInvite,
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
const manageTeamRateLimiter = createRateLimiter({
  name: "manage-team",
  windowMs: 60 * 60 * 1000,
  maxRequests: 60,
  message: "Too many team changes. Please try again later.",
});
const resendTeamInviteRateLimiter = createRateLimiter({
  name: "resend-team-invite",
  windowMs: 60 * 60 * 1000,
  maxRequests: 30,
  message: "Too many team invitation emails. Please try again later.",
});

router.get("/teams/profile", requireAuth, getProfileTeams);
router.post(
  "/teams",
  requireAuth,
  requireVerifiedEmail,
  createTeamRateLimiter,
  imageUpload.single("teamLogo"),
  createProfileTeam
);
router.patch(
  "/teams/:teamId",
  requireAuth,
  requireVerifiedEmail,
  manageTeamRateLimiter,
  imageUpload.single("teamLogo"),
  updateProfileTeam
);
router.delete(
  "/teams/:teamId",
  requireAuth,
  requireVerifiedEmail,
  manageTeamRateLimiter,
  deleteProfileTeam
);
router.post(
  "/teams/:teamId/members/:memberId/resend-invite",
  requireAuth,
  requireVerifiedEmail,
  resendTeamInviteRateLimiter,
  resendProfileTeamInvite
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
