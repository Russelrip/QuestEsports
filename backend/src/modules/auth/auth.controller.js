const { asyncHandler } = require("../../lib/async-handler");
const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { sendSecurityEventEmail } = require("../../lib/mail/sendSecurityEventEmail");
const { buildAuthorizationUrl, handleOAuthCallback } = require("./oauth.service");
const {
  createSession,
  deleteSessionByToken,
  setSessionCookie,
  clearSessionCookie,
  listUserSessions,
  deleteSessionById,
  deleteOtherSessions,
  hasSessionFingerprint,
} = require("./session.service");
const {
  createSignup,
  authenticateUser,
  markUserLoginSucceeded,
  getUserProfile,
  updateUserProfile,
  completeMfaLogin,
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
  regenerateBackupCodes,
  verifyEmailAddress,
  resendVerificationEmail,
  requestEmailChange,
  confirmEmailChange,
  requestPasswordReset,
  resetPassword,
  changePassword,
  mapUserForResponse,
} = require("./auth.service");

const notifyNewSignIn = async (user) => {
  try {
    await sendSecurityEventEmail({
      email: user.email,
      firstName: user.firstName,
      subject: "Quest Esports new sign-in detected",
      title: "New sign-in detected",
      message:
        "we noticed a sign-in to your Quest Esports account from a new device or location.",
      outro:
        "If this was you, no action is needed. If not, reset your password immediately.",
    });
  } catch (error) {
    logger.error("Failed to send new sign-in security email.", {
      userId: user.id,
      email: user.email,
      error,
    });
  }
};

const completeAuthenticatedLogin = async ({
  userId,
  rememberMe,
  req,
  res,
  responseUser,
}) => {
  const userAgent = req.headers["user-agent"] || null;
  const ipAddress = req.ip || null;
  const knownDevice = await hasSessionFingerprint({
    userId,
    userAgent,
    ipAddress,
  });
  const { token, expiresAt } = await createSession({
    userId,
    rememberMe,
    userAgent,
    ipAddress,
  });
  const refreshedUser = await markUserLoginSucceeded({ userId });

  setSessionCookie(res, token, expiresAt);

  logger.info("User login succeeded", {
    userId,
    rememberMe,
    ip: req.ip,
  });

  if (!knownDevice) {
    await notifyNewSignIn(refreshedUser);
  }

  return responseUser
    ? {
        ...responseUser,
        ...refreshedUser,
      }
    : refreshedUser;
};

const signup = asyncHandler(async (req, res) => {
  await createSignup({ body: req.body });

  res.status(201).json({
    success: true,
    message: "Signup successful. Check your email to verify your account.",
  });
});

const startGoogleAuth = asyncHandler(async (req, res) => {
  res.redirect(buildAuthorizationUrl({
    provider: "google",
    redirectTo: req.query.redirect,
  }));
});

const startDiscordAuth = asyncHandler(async (req, res) => {
  res.redirect(buildAuthorizationUrl({
    provider: "discord",
    redirectTo: req.query.redirect,
  }));
});

const login = asyncHandler(async (req, res) => {
  const authResult = await authenticateUser({
    body: req.body,
    requestMeta: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

  if (authResult.requiresMfa) {
    res.status(200).json({
      success: true,
      message: "Verification code required.",
      ...authResult,
    });
    return;
  }

  const { userId, rememberMe } = authResult;
  const user = await completeAuthenticatedLogin({
    userId,
    rememberMe,
    req,
    res,
  });

  res.status(200).json({
    success: true,
    message: "Login successful.",
    user,
  });
});

const verifyMfaLogin = asyncHandler(async (req, res) => {
  const { userId, rememberMe, user, usedRecoveryCode } = await completeMfaLogin({
    body: req.body,
  });

  const authenticatedUser = await completeAuthenticatedLogin({
    userId,
    rememberMe,
    req,
    res,
    responseUser: user,
  });

  res.status(200).json({
    success: true,
    message: usedRecoveryCode
      ? "Login successful. Your backup code was used."
      : "Login successful.",
    user: authenticatedUser,
  });
});

const completeOAuthLogin = async ({ provider, req, res }) => {
  const { redirectTo, user } = await handleOAuthCallback({
    provider,
    code: String(req.query.code || ""),
    state: String(req.query.state || ""),
  });

  const refreshedUser = await completeAuthenticatedLogin({
    userId: user.id,
    rememberMe: true,
    req,
    res,
    responseUser: user,
  });

  const destination = redirectTo || (refreshedUser.role === "admin" ? "/admin" : "/profile");
  const appRedirectUrl = new URL(destination, env.APP_URL).toString();
  res.redirect(appRedirectUrl);
};

const googleCallback = asyncHandler(async (req, res) => {
  await completeOAuthLogin({
    provider: "google",
    req,
    res,
  });
});

const discordCallback = asyncHandler(async (req, res) => {
  await completeOAuthLogin({
    provider: "discord",
    req,
    res,
  });
});

const logout = asyncHandler(async (req, res) => {
  if (req.session?.token) {
    await deleteSessionByToken(req.session.token);
  }

  clearSessionCookie(res);

  logger.info("User logout completed", {
    userId: req.user?.id || null,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
});

const getCurrentSession = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user ? mapUserForResponse(req.user) : null,
  });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await getUserProfile({
    requestedUserId: req.params.userId,
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    user,
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await updateUserProfile({
    requestedUserId: req.params.userId,
    currentUser: req.user,
    body: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    user,
  });
});

const changePasswordController = asyncHandler(async (req, res) => {
  const user = await changePassword({
    currentUser: req.user,
    body: req.body,
    currentSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    message: "Password updated successfully. Other sessions were signed out.",
    user,
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const token = String(req.query.token || "").trim();

  if (!token) {
    res.status(400).json({
      success: false,
      message: "Verification token is required.",
    });
    return;
  }

  const user = await verifyEmailAddress({ token });

  res.status(200).json({
    success: true,
    message: "Your email has been verified successfully.",
    user,
  });
});

const resendVerification = asyncHandler(async (req, res) => {
  await resendVerificationEmail({ body: req.body });

  res.status(200).json({
    success: true,
    message: "If that account exists and is not yet verified, a new verification email has been sent.",
  });
});

const requestEmailChangeController = asyncHandler(async (req, res) => {
  const user = await requestEmailChange({
    currentUser: req.user,
    body: req.body,
  });

  res.status(200).json({
    success: true,
    message:
      "We sent a confirmation link to your new email address. Your current email will stay active until you confirm the change.",
    user,
  });
});

const confirmEmailChangeController = asyncHandler(async (req, res) => {
  const token = String(req.query.token || "").trim();

  if (!token) {
    res.status(400).json({
      success: false,
      message: "Email change token is required.",
    });
    return;
  }

  const user = await confirmEmailChange({ token });

  res.status(200).json({
    success: true,
    message: "Your email address has been updated successfully.",
    user,
  });
});

const forgotPassword = asyncHandler(async (req, res) => {
  await requestPasswordReset({ body: req.body });

  res.status(200).json({
    success: true,
    message: "If that email is registered, you will receive password reset instructions shortly.",
  });
});

const resetPasswordController = asyncHandler(async (req, res) => {
  await resetPassword({ body: req.body });

  res.status(200).json({
    success: true,
    message: "Your password has been reset successfully. Please sign in again.",
  });
});

const getMfaSetup = asyncHandler(async (req, res) => {
  const setup = await beginMfaSetup({
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    message: "Authenticator setup created.",
    ...setup,
  });
});

const verifyMfaSetup = asyncHandler(async (req, res) => {
  const result = await confirmMfaSetup({
    currentUser: req.user,
    body: req.body,
  });

  await deleteOtherSessions({
    userId: req.user.id,
    excludeSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    message: "Multi-factor authentication enabled successfully.",
    user: result.user,
    backupCodes: result.backupCodes,
  });
});

const disableMfaController = asyncHandler(async (req, res) => {
  const user = await disableMfa({
    currentUser: req.user,
    body: req.body,
  });

  await deleteOtherSessions({
    userId: req.user.id,
    excludeSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    message: "Multi-factor authentication disabled.",
    user,
  });
});

const regenerateBackupCodesController = asyncHandler(async (req, res) => {
  const backupCodes = await regenerateBackupCodes({
    currentUser: req.user,
    body: req.body,
  });

  await deleteOtherSessions({
    userId: req.user.id,
    excludeSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    message: "Backup codes regenerated successfully.",
    backupCodes,
  });
});

const getSessionsController = asyncHandler(async (req, res) => {
  const sessions = await listUserSessions({
    userId: req.user.id,
    currentSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    sessions,
  });
});

const revokeSessionController = asyncHandler(async (req, res) => {
  await deleteSessionById({
    userId: req.user.id,
    sessionId: req.params.sessionId,
  });

  res.status(200).json({
    success: true,
    message: "Session revoked successfully.",
  });
});

const revokeOtherSessionsController = asyncHandler(async (req, res) => {
  await deleteOtherSessions({
    userId: req.user.id,
    excludeSessionId: req.session?.sessionId || null,
  });

  res.status(200).json({
    success: true,
    message: "Other active sessions were revoked.",
  });
});

module.exports = {
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
  changePassword: changePasswordController,
  verifyEmail,
  resendVerification,
  requestEmailChange: requestEmailChangeController,
  confirmEmailChange: confirmEmailChangeController,
  forgotPassword,
  resetPassword: resetPasswordController,
  getMfaSetup,
  verifyMfaSetup,
  disableMfa: disableMfaController,
  regenerateBackupCodes: regenerateBackupCodesController,
  getSessions: getSessionsController,
  revokeSession: revokeSessionController,
  revokeOtherSessions: revokeOtherSessionsController,
};
