const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { attachSession, requireAuth } = require("../auth/auth.middleware");
const {
  getProfileTeams,
  previewTeamInvite,
  respondTeamInvite,
} = require("./team.controller");

const router = express.Router();
const teamInviteRateLimiter = createRateLimiter({
  name: "team-invite-response",
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: "Too many invite responses. Please try again later.",
});

router.use(attachSession);

router.get("/teams/profile", requireAuth, getProfileTeams);
router.get("/team-invite", previewTeamInvite);
router.post("/team-invite/respond", teamInviteRateLimiter, respondTeamInvite);

module.exports = router;
