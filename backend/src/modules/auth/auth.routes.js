const express = require("express");
const {
  signup,
  startGoogleAuth,
  startDiscordAuth,
  googleCallback,
  discordCallback,
  login,
  verifyMfaLogin,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
  changePassword,
  verifyEmail,
  resendVerification,
  requestEmailChange,
  confirmEmailChange,
  forgotPassword,
  resetPassword,
  getMfaSetup,
  verifyMfaSetup,
  disableMfa,
  regenerateBackupCodes,
  getSessions,
  revokeSession,
  revokeOtherSessions,
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
const emailChangeRateLimiter = createRateLimiter({
  name: "auth-email-change",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many email change requests. Please try again later.",
});
const resetPasswordRateLimiter = createRateLimiter({
  name: "auth-reset-password",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many password reset attempts. Please try again later.",
});

router.use(attachSession);
router.get("/auth/google/start", startGoogleAuth);
router.get("/auth/google/callback", googleCallback);
router.get("/auth/discord/start", startDiscordAuth);
router.get("/auth/discord/callback", discordCallback);
router.post("/signup", signupRateLimiter, signup);
router.post("/login", authRateLimiter, login);
router.post("/login/mfa", authRateLimiter, verifyMfaLogin);
router.post("/logout", logout);
router.get("/me", getCurrentSession);
router.get("/email-verification/verify", verifyEmail);
router.get("/email-change/confirm", confirmEmailChange);
router.post(
  "/email-verification/resend",
  resendVerificationRateLimiter,
  resendVerification
);
router.post(
  "/email-change/request",
  emailChangeRateLimiter,
  requireAuth,
  requestEmailChange
);
router.post("/forgot-password", forgotPasswordRateLimiter, forgotPassword);
router.post("/reset-password", resetPasswordRateLimiter, resetPassword);
router.get("/mfa/setup", requireAuth, getMfaSetup);
router.post("/mfa/verify-setup", requireAuth, verifyMfaSetup);
router.post("/mfa/disable", requireAuth, disableMfa);
router.post("/mfa/backup-codes/regenerate", requireAuth, regenerateBackupCodes);
router.get("/sessions", requireAuth, getSessions);
router.delete("/sessions/:sessionId", requireAuth, revokeSession);
router.post("/sessions/revoke-others", requireAuth, revokeOtherSessions);
router.post("/change-password", requireAuth, changePassword);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
