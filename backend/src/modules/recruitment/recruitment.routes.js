const express = require("express");
const { requireVerifiedEmail } = require("../auth/auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { submitRecruitmentApplication } = require("./recruitment.controller");

const router = express.Router();
const recruitmentRateLimiter = createRateLimiter({
  name: "recruitment-submit",
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: "Too many recruitment applications. Please try again later.",
});

router.post(
  "/recruitment-applications",
  requireVerifiedEmail,
  recruitmentRateLimiter,
  submitRecruitmentApplication
);

module.exports = router;
