const express = require("express");
const {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
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
const forgotPasswordRateLimiter = createRateLimiter({
  name: "auth-forgot-password",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many password reset attempts. Please try again later.",
});
const resendVerificationRateLimiter = createRateLimiter({
  name: "auth-resend-verification",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many verification email requests. Please try again later.",
});
const resetPasswordRateLimiter = createRateLimiter({
  name: "auth-reset-password",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many password reset attempts. Please try again later.",
});

router.use(attachSession);
router.post("/signup", signupRateLimiter, signup);
router.post("/login", authRateLimiter, login);
router.post("/logout", logout);
router.get("/me", getCurrentSession);
router.get("/email-verification/verify", verifyEmail);
router.post(
  "/email-verification/resend",
  resendVerificationRateLimiter,
  resendVerification
);
router.post("/forgot-password", forgotPasswordRateLimiter, forgotPassword);
router.post("/reset-password", resetPasswordRateLimiter, resetPassword);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
