const express = require("express");
const {
  signup,
  startGoogleAuth,
  startDiscordAuth,
  startMobileGoogleAuth,
  startMobileDiscordAuth,
  googleCallback,
  discordCallback,
  login,
  verifyMfaLogin,
  mobileLogin,
  verifyMobileMfaLogin,
  exchangeMobileOAuthGrant,
  mobileLogout,
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
const { requireAuth } = require("./auth.middleware");
const { createRateLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const passwordLoginRateLimiter = createRateLimiter({
  name: "auth-login-password",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many login attempts. Please try again in 15 minutes.",
});
const mfaLoginRateLimiter = createRateLimiter({
  name: "auth-login-mfa",
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many verification attempts. Please try again in 15 minutes.",
});
const mobileOAuthExchangeRateLimiter = createRateLimiter({
  name: "auth-mobile-oauth-exchange",
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many mobile sign-in attempts. Please try again in 15 minutes.",
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
  windowMs: 60 * 1000,
  maxRequests: 1,
  message: "Please wait before requesting another verification email.",
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
const mfaSettingsRateLimiter = createRateLimiter({
  name: "mfa-settings",
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many MFA changes. Please try again later.",
});

router.get("/auth/google/start", startGoogleAuth);
router.get("/auth/google/callback", googleCallback);
router.get("/auth/discord/start", startDiscordAuth);
router.get("/auth/discord/callback", discordCallback);
router.get("/mobile/auth/oauth/google/start", startMobileGoogleAuth);
router.get("/mobile/auth/oauth/discord/start", startMobileDiscordAuth);
router.post("/signup", signupRateLimiter, signup);
router.post("/login", passwordLoginRateLimiter, login);
router.post("/login/mfa", mfaLoginRateLimiter, verifyMfaLogin);
router.post("/mobile/auth/login", passwordLoginRateLimiter, mobileLogin);
router.post("/mobile/auth/login/mfa", mfaLoginRateLimiter, verifyMobileMfaLogin);
router.post(
  "/mobile/auth/oauth/exchange",
  mobileOAuthExchangeRateLimiter,
  exchangeMobileOAuthGrant
);
router.post("/mobile/auth/logout", requireAuth, mobileLogout);
router.get("/mobile/auth/me", requireAuth, getCurrentSession);
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
router.post("/mfa/setup", mfaSettingsRateLimiter, requireAuth, getMfaSetup);
router.post("/mfa/verify-setup", mfaSettingsRateLimiter, requireAuth, verifyMfaSetup);
router.post("/mfa/disable", mfaSettingsRateLimiter, requireAuth, disableMfa);
router.post(
  "/mfa/backup-codes/regenerate",
  mfaSettingsRateLimiter,
  requireAuth,
  regenerateBackupCodes
);
router.get("/sessions", requireAuth, getSessions);
router.delete("/sessions/:sessionId", requireAuth, revokeSession);
router.post("/sessions/revoke-others", requireAuth, revokeOtherSessions);
router.post("/change-password", requireAuth, changePassword);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
