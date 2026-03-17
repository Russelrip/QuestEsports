const { env } = require("../../config/env");
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
  mapUserForResponse,
} = require("./auth.service");

const signup = asyncHandler(async (req, res) => {
  await createSignup({
    body: req.body,
    adminEmails: env.ADMIN_EMAILS,
  });

  res.status(201).json({
    success: true,
    message: "Signup successful.",
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

module.exports = {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
};
