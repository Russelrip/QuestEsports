const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
  requireAuth,
  requireVerifiedEmail,
} = require("../auth/auth.middleware");
const {
  getProfileTeams,
  getMyInvitations,
  createProfileTeam,
  updateProfileTeam,
  deleteProfileTeam,
  nudgeProfileTeamInvite,
  respondToMyInvitation,
} = require("./team.controller");
const { imageUpload } = require("../../middleware/upload");
const { invalidateCache } = require("../../middleware/response-cache");

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
const nudgeTeamInviteRateLimiter = createRateLimiter({
  name: "nudge-team-invite",
  windowMs: 60 * 60 * 1000,
  maxRequests: 30,
  message: "Too many invitation reminders. Please try again later.",
});

router.get("/teams/profile", requireAuth, getProfileTeams);
router.get("/me/invitations", requireAuth, getMyInvitations);
router.post(
  "/teams",
  requireAuth,
  requireVerifiedEmail,
  createTeamRateLimiter,
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments", "foundation"),
  createProfileTeam
);
router.patch(
  "/teams/:teamId",
  requireAuth,
  requireVerifiedEmail,
  manageTeamRateLimiter,
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments", "foundation"),
  updateProfileTeam
);
router.delete(
  "/teams/:teamId",
  requireAuth,
  requireVerifiedEmail,
  manageTeamRateLimiter,
  invalidateCache("tournaments", "foundation"),
  deleteProfileTeam
);
router.post(
  "/teams/:teamId/members/:memberId/nudge",
  requireAuth,
  requireVerifiedEmail,
  nudgeTeamInviteRateLimiter,
  nudgeProfileTeamInvite
);
// Answered by the invitee's identity rather than by a token they were sent, so
// there is nothing to preview anonymously and nothing to present but a session.
router.post(
  "/me/invitations/:invitationId/respond",
  requireAuth,
  requireVerifiedEmail,
  teamInviteRateLimiter,
  invalidateCache("tournaments", "foundation"),
  respondToMyInvitation
);

module.exports = router;
