const { asyncHandler } = require("../../lib/async-handler");
const { logger } = require("../../lib/logger");
const {
  createSession,
  deleteSessionByToken,
  setSessionCookie,
  clearSessionCookie,
} = require("./session.service");
const {
  createSignup,
  authenticateUser,
  getUserProfile,
  updateUserProfile,
  verifyEmailAddress,
  resendVerificationEmail,
  requestPasswordReset,
  resetPassword,
  mapUserForResponse,
} = require("./auth.service");

const signup = asyncHandler(async (req, res) => {
  await createSignup({ body: req.body });

  res.status(201).json({
    success: true,
    message: "Signup successful. Check your email to verify your account.",
  });
});

const login = asyncHandler(async (req, res) => {
  const { userId, rememberMe, user } = await authenticateUser({
    body: req.body,
    requestMeta: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

  const { token, expiresAt } = await createSession({
    userId,
    rememberMe,
  });

  setSessionCookie(res, token, expiresAt);

  logger.info("User login succeeded", {
    userId,
    rememberMe,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Login successful.",
    user,
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

module.exports = {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword: resetPasswordController,
};
