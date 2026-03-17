const express = require("express");
const {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
} = require("./auth.controller");
const { attachSession, requireAuth } = require("./auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const authRateLimiter = createRateLimiter({
  name: "auth-login",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many login attempts. Please try again in 15 minutes.",
});
const signupRateLimiter = createRateLimiter({
  name: "auth-signup",
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: "Too many signup attempts. Please try again in an hour.",
});

router.use(attachSession);
router.post("/signup", signupRateLimiter, signup);
router.post("/login", authRateLimiter, login);
router.post("/logout", logout);
router.get("/me", getCurrentSession);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
