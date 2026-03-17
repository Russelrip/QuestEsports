const express = require("express");
const { submitContact } = require("./contact.controller");
const { createRateLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const contactRateLimiter = createRateLimiter({
  name: "contact-submit",
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: "Too many contact submissions. Please try again later.",
});

router.post("/contact", contactRateLimiter, submitContact);

module.exports = router;
