const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const routesPath = path.join(__dirname, "../src/modules/auth/auth.routes.js");
const controllerPath = path.join(__dirname, "../src/modules/auth/auth.controller.js");
const middlewarePath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const validationPath = path.join(__dirname, "../src/lib/validation.js");

const noopHandler = (req, res, next) => next?.();

const controllerExports = {
  signup: noopHandler,
  startGoogleAuth: noopHandler,
  startDiscordAuth: noopHandler,
  startMobileGoogleAuth: noopHandler,
  startMobileDiscordAuth: noopHandler,
  googleCallback: noopHandler,
  discordCallback: noopHandler,
  login: noopHandler,
  mobileLogin: noopHandler,
  exchangeMobileOAuthGrant: noopHandler,
  mobileLogout: noopHandler,
  logout: noopHandler,
  getCurrentSession: noopHandler,
  getProfile: noopHandler,
  updateProfile: noopHandler,
  changePassword: noopHandler,
  verifyEmail: noopHandler,
  resendVerification: noopHandler,
  requestEmailChange: noopHandler,
  confirmEmailChange: noopHandler,
  forgotPassword: noopHandler,
  resetPassword: noopHandler,
  getSessions: noopHandler,
  revokeSession: noopHandler,
  revokeOtherSessions: noopHandler,
  startProviderLink: noopHandler,
  providerLinkCallback: noopHandler,
  getLinkedProviders: noopHandler,
  unlinkProvider: noopHandler,
};

test("every OAuth account-link route requires the current session", () => {
  const requireAuth = function requireAuthMarker() {};
  const { module: routes, restore } = loadModuleWithMocks(routesPath, {
    [controllerPath]: controllerExports,
    [middlewarePath]: { requireAuth },
    [rateLimitPath]: {
      createRateLimiter: () => noopHandler,
      getClientIp: () => "127.0.0.1",
    },
    [validationPath]: {
      normalizeEmail: (value) => value,
      normalizeUsername: (value) => value,
    },
  });

  try {
    const linkRoutes = routes.stack
      .filter((layer) => layer.route)
      .filter((layer) => String(layer.route.path).startsWith("/auth/oauth/"))
      .map((layer) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
        handlers: layer.route.stack.map((entry) => entry.handle),
      }));

    assert.deepEqual(
      linkRoutes.map(({ path: routePath, method }) => `${method} ${routePath}`),
      [
        "get /auth/oauth/providers",
        "get /auth/oauth/:provider/link",
        "get /auth/oauth/:provider/link/callback",
        "delete /auth/oauth/:provider",
      ]
    );
    for (const route of linkRoutes) {
      assert.ok(
        route.handlers.includes(requireAuth),
        `${route.method.toUpperCase()} ${route.path} must require authentication`
      );
    }
  } finally {
    restore();
  }
});
