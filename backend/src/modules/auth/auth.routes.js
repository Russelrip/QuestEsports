const express = require("express");
const {
  signup,
  startGoogleAuth,
  startDiscordAuth,
  startProviderLink,
  startMobileGoogleAuth,
  startMobileDiscordAuth,
  googleCallback,
  discordCallback,
  providerLinkCallback,
  login,
  mobileLogin,
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
  getSessions,
  revokeSession,
  revokeOtherSessions,
  getLinkedProviders,
  unlinkProvider,
} = require("./auth.controller");
const { requireAuth } = require("./auth.middleware");
const { createRateLimiter, getClientIp } = require("../../middleware/rate-limit");
const { normalizeEmail, normalizeUsername } = require("../../lib/validation");

const router = express.Router();
const oauthLinkRoutes = express.Router();
const passwordLoginIpRateLimiter = createRateLimiter({
  name: "auth-login-password-ip",
  windowMs: 15 * 60 * 1000,
  maxRequests: 50,
  message: "Too many login attempts from this network. Please try again in 15 minutes.",
});
const passwordLoginIdentityRateLimiter = createRateLimiter({
  name: "auth-login-password-identity",
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many login attempts. Please try again in 15 minutes.",
  keyGenerator: (req) => {
    const identity = normalizeEmail(req.body?.emailOrUsername) ||
      normalizeUsername(req.body?.emailOrUsername) ||
      "unknown";
    return `${getClientIp(req)}:${identity}`;
  },
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
const registerOAuthLinkRoutes = (targetRouter) => {
  targetRouter.get("/auth/oauth/providers", requireAuth, getLinkedProviders);
  targetRouter.get(
    "/auth/oauth/:provider/link",
    requireAuth,
    startProviderLink
  );
  targetRouter.get(
    "/auth/oauth/:provider/link/callback",
    requireAuth,
    providerLinkCallback
  );
  targetRouter.delete(
    "/auth/oauth/:provider",
    requireAuth,
    unlinkProvider
  );
};
router.get("/auth/google/start", startGoogleAuth);
router.get("/auth/google/callback", googleCallback);
router.get("/auth/discord/start", startDiscordAuth);
router.get("/auth/discord/callback", discordCallback);
registerOAuthLinkRoutes(router);
registerOAuthLinkRoutes(oauthLinkRoutes);
router.get("/mobile/auth/oauth/google/start", startMobileGoogleAuth);
router.get("/mobile/auth/oauth/discord/start", startMobileDiscordAuth);
router.post("/signup", signupRateLimiter, signup);
router.post("/login", passwordLoginIpRateLimiter, passwordLoginIdentityRateLimiter, login);
router.post(
  "/mobile/auth/login",
  passwordLoginIpRateLimiter,
  passwordLoginIdentityRateLimiter,
  mobileLogin
);
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
router.get("/sessions", requireAuth, getSessions);
router.delete("/sessions/:sessionId", requireAuth, revokeSession);
router.post("/sessions/revoke-others", requireAuth, revokeOtherSessions);
router.post("/change-password", requireAuth, changePassword);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
module.exports.oauthLinkRoutes = oauthLinkRoutes;
