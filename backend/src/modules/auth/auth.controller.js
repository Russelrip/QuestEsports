const { asyncHandler } = require("../../lib/async-handler");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  buildExpiredOAuthFlowCookie,
  buildExpiredOAuthLinkFlowCookie,
  createOAuthAuthorization,
  createOAuthLinkAuthorization,
  getOAuthFlowToken,
  getOAuthLinkFlowToken,
  handleOAuthCallback,
  handleOAuthLinkCallback,
  listLinkedOAuthProviders,
  unlinkOAuthProvider,
} = require("./oauth.service");
const {
  createSession,
  deleteSessionByToken,
  setSessionCookie,
  clearSessionCookie,
  listUserSessions,
  deleteSessionById,
  deleteOtherSessions,
} = require("./session.service");
const {
  createSignup,
  authenticateUser,
  markUserLoginSucceeded,
  getUserProfile,
  updateUserProfile,
  createMobileOAuthGrant,
  consumeMobileOAuthGrant,
  verifyEmailAddress,
  resendVerificationEmail,
  requestEmailChange,
  confirmEmailChange,
  requestPasswordReset,
  resetPassword,
  changePassword,
  mapUserForResponse,
} = require("./auth.service");

const MOBILE_ADMIN_OAUTH_REDIRECT = "/mobile-admin-oauth";
const OAUTH_LINK_PROFILE_REDIRECT = "/profile?tab=account";
const SUPPORTED_OAUTH_PROVIDERS = new Set(["google", "discord"]);

const getAppRedirectUrl = (destination) => {
  const appUrl = String(env.APP_URL || "").trim();

  if (!appUrl) {
    throw new HttpError(503, "APP_URL must be configured for OAuth redirects.");
  }

  return new URL(destination, appUrl).toString();
};

const assertSupportedOAuthProvider = (provider) => {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (!SUPPORTED_OAUTH_PROVIDERS.has(normalizedProvider)) {
    throw new HttpError(400, "Unsupported OAuth provider.");
  }
  return normalizedProvider;
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

  return responseUser
    ? {
        ...responseUser,
        ...refreshedUser,
      }
    : refreshedUser;
};

const assertMobileAdmin = (user) => {
  if (!user || user.role !== "admin") {
    throw new HttpError(403, "Admin access is required for the mobile app.");
  }
};

const completeMobileAuthenticatedLogin = async ({
  userId,
  rememberMe,
  req,
  responseUser,
}) => {
  assertMobileAdmin(responseUser);
  const { token, expiresAt, sessionId } = await createSession({
    userId,
    rememberMe,
    userAgent: `Quest Admin Android | ${req.headers["user-agent"] || "unknown"}`,
    ipAddress: req.ip || null,
  });
  const refreshedUser = await markUserLoginSucceeded({ userId });

  logger.info("Mobile admin login succeeded", {
    userId,
    sessionId,
    ip: req.ip,
  });

  return {
    token,
    expiresAt,
    user: { ...responseUser, ...refreshedUser },
  };
};

const signup = asyncHandler(async (req, res) => {
  await createSignup({ body: req.body });

  res.status(201).json({
    success: true,
    message: "Signup successful. Check your email to verify your account.",
  });
});

const startOAuth = ({ provider, req, res }) => {
  const { authorizationUrl, flowCookie } = createOAuthAuthorization({
    provider,
    redirectTo: req.query.redirect,
  });

  res.setHeader("Set-Cookie", flowCookie);
  res.redirect(authorizationUrl);
};

const startGoogleAuth = asyncHandler(async (req, res) => {
  startOAuth({ provider: "google", req, res });
});

const startDiscordAuth = asyncHandler(async (req, res) => {
  startOAuth({ provider: "discord", req, res });
});

const startMobileOAuth = ({ provider, req, res }) => {
  const mobileCodeChallenge = String(req.query.code_challenge || "").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(mobileCodeChallenge)) {
    throw new HttpError(400, "A valid mobile OAuth code challenge is required.");
  }
  const { authorizationUrl, flowCookie } = createOAuthAuthorization({
    provider,
    redirectTo: MOBILE_ADMIN_OAUTH_REDIRECT,
    mobileCodeChallenge,
  });

  res.setHeader("Set-Cookie", flowCookie);
  res.redirect(authorizationUrl);
};

const startMobileGoogleAuth = asyncHandler(async (req, res) => {
  startMobileOAuth({ provider: "google", req, res });
});

const startMobileDiscordAuth = asyncHandler(async (req, res) => {
  startMobileOAuth({ provider: "discord", req, res });
});

const login = asyncHandler(async (req, res) => {
  const authResult = await authenticateUser({
    body: req.body,
    requestMeta: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

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

const mobileLogin = asyncHandler(async (req, res) => {
  const authResult = await authenticateUser({
    body: { ...req.body, remember: true },
    requestMeta: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      client: "quest-admin-android",
    },
  });

  assertMobileAdmin(authResult.user);

  const session = await completeMobileAuthenticatedLogin({
    userId: authResult.userId,
    rememberMe: true,
    req,
    responseUser: authResult.user,
  });

  res.status(200).json({
    success: true,
    message: "Login successful.",
    ...session,
  });
});

const exchangeMobileOAuthGrant = asyncHandler(async (req, res) => {
  const result = await consumeMobileOAuthGrant({
    token: req.body.grantToken,
    codeVerifier: req.body.codeVerifier,
  });
  const session = await completeMobileAuthenticatedLogin({
    userId: result.user.id,
    rememberMe: true,
    req,
    responseUser: result.user,
  });

  res.status(200).json({
    success: true,
    message: `Signed in with ${result.provider}.`,
    ...session,
  });
});

const mobileLogout = asyncHandler(async (req, res) => {
  if (req.session?.source === "bearer" && req.session.token) {
    await deleteSessionByToken(req.session.token);
  }

  res.status(200).json({
    success: true,
    message: "Mobile session ended.",
  });
});

const completeOAuthLogin = async ({ provider, req, res }) => {
  const { redirectTo, mobileCodeChallenge, user } = await handleOAuthCallback({
    provider,
    code: String(req.query.code || ""),
    state: String(req.query.state || ""),
    flowToken: getOAuthFlowToken({
      provider,
      cookieHeader: req.headers.cookie,
    }),
  });

  if (redirectTo === MOBILE_ADMIN_OAUTH_REDIRECT) {
    assertMobileAdmin(user);
    const grant = await createMobileOAuthGrant({
      userId: user.id,
      provider,
      codeChallenge: mobileCodeChallenge,
    });
    const appRedirectUrl = new URL(env.MOBILE_ADMIN_OAUTH_REDIRECT_URL);
    appRedirectUrl.searchParams.set("grant", grant.token);
    appRedirectUrl.searchParams.set("provider", provider);
    res.setHeader("Set-Cookie", buildExpiredOAuthFlowCookie(provider));
    res.redirect(appRedirectUrl.toString());
    return;
  }

  const refreshedUser = await completeAuthenticatedLogin({
    userId: user.id,
    rememberMe: true,
    req,
    res,
    responseUser: user,
  });

  const destination = redirectTo || (refreshedUser.role === "admin" ? "/admin" : "/profile");
  const appRedirectUrl = getAppRedirectUrl(destination);
  const sessionCookie = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [
    ...(Array.isArray(sessionCookie) ? sessionCookie : [sessionCookie].filter(Boolean)),
    buildExpiredOAuthFlowCookie(provider),
  ]);
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

const startOAuthLink = async ({ provider, req, res }) => {
  const { authorizationUrl, flowCookie } = await createOAuthLinkAuthorization({
    provider,
    userId: req.user.id,
    redirectTo: OAUTH_LINK_PROFILE_REDIRECT,
  });

  res.setHeader("Set-Cookie", flowCookie);
  res.redirect(authorizationUrl);
};

const startGoogleLink = async (req, res) => {
  await startOAuthLink({ provider: "google", req, res });
};

const startDiscordLink = async (req, res) => {
  await startOAuthLink({ provider: "discord", req, res });
};

const startProviderLinkHandlers = {
  google: startGoogleLink,
  discord: startDiscordLink,
};

const startProviderLink = asyncHandler(async (req, res) => {
  const provider = assertSupportedOAuthProvider(req.params.provider);
  await startProviderLinkHandlers[provider](req, res);
});

const getOAuthLinkRedirect = (marker) =>
  getAppRedirectUrl(`${OAUTH_LINK_PROFILE_REDIRECT}&oauth=${marker}`);

const recordOptionalSecurityAudit = async (entry) => {
  try {
    await recordAudit(entry);
  } catch (error) {
    logger.warn?.("Optional OAuth audit persistence failed.", { action: entry.action, error });
  }
};

const completeOAuthLink = async ({ provider, req, res }) => {
  try {
    const result = await handleOAuthLinkCallback({
      provider,
      code: String(req.query.code || ""),
      state: String(req.query.state || ""),
      flowToken: getOAuthLinkFlowToken({
        provider,
        cookieHeader: req.headers.cookie,
      }),
      userId: req.user.id,
    });

    await recordOptionalSecurityAudit({
      ...requestAuditContext(req),
      action: "oauth.account.linked",
      targetType: "OAuthAccount",
      afterData: { provider, linked: true, providers: result?.providers || null },
    });

    res.setHeader("Set-Cookie", buildExpiredOAuthLinkFlowCookie(provider));
    res.redirect(getOAuthLinkRedirect("linked"));
  } catch (error) {
    logger.error("OAuth account link callback failed.", {
      provider,
      statusCode: error?.statusCode || 500,
      code: error?.code || null,
    });
    res.setHeader("Set-Cookie", buildExpiredOAuthLinkFlowCookie(provider));
    res.redirect(getOAuthLinkRedirect("error"));
  }
};

const googleLinkCallback = async (req, res) => {
  await completeOAuthLink({ provider: "google", req, res });
};

const discordLinkCallback = async (req, res) => {
  await completeOAuthLink({ provider: "discord", req, res });
};

const providerLinkCallbackHandlers = {
  google: googleLinkCallback,
  discord: discordLinkCallback,
};

const providerLinkCallback = asyncHandler(async (req, res) => {
  const provider = assertSupportedOAuthProvider(req.params.provider);
  await providerLinkCallbackHandlers[provider](req, res);
});

const getLinkedProviders = asyncHandler(async (req, res) => {
  const providers = await listLinkedOAuthProviders(req.user.id);
  res.status(200).json({
    success: true,
    providers,
  });
});

const unlinkProvider = asyncHandler(async (req, res) => {
  const provider = assertSupportedOAuthProvider(req.params.provider);
  const providers = await unlinkOAuthProvider({
    userId: req.user.id,
    provider,
  });
  await recordOptionalSecurityAudit({
    ...requestAuditContext(req),
    action: "oauth.account.unlinked",
    targetType: "OAuthAccount",
    targetId: `${req.user.id}:${provider}`,
    afterData: { provider, linked: false, providers },
  });

  res.status(200).json({
    success: true,
    providers,
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
  startMobileGoogleAuth,
  startMobileDiscordAuth,
  googleCallback,
  discordCallback,
  startGoogleLink,
  startDiscordLink,
  startProviderLink,
  googleLinkCallback,
  discordLinkCallback,
  providerLinkCallback,
  getLinkedProviders,
  unlinkProvider,
  login,
  mobileLogin,
  exchangeMobileOAuthGrant,
  mobileLogout,
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
  getSessions: getSessionsController,
  revokeSession: revokeSessionController,
  revokeOtherSessions: revokeOtherSessionsController,
};
