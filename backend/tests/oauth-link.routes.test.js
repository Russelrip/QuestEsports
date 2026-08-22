const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const routesPath = path.join(__dirname, "../src/modules/auth/auth.routes.js");
const controllerPath = path.join(__dirname, "../src/modules/auth/auth.controller.js");
const middlewarePath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const validationPath = path.join(__dirname, "../src/lib/validation.js");
const oauthPath = path.join(__dirname, "../src/modules/auth/oauth.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const sessionPath = path.join(__dirname, "../src/modules/auth/session.service.js");
const authServicePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const errorHandlerPath = path.join(__dirname, "../src/middleware/error-handler.js");
const monitoringPath = path.join(__dirname, "../src/lib/monitoring.js");
const prismaErrorsPath = path.join(__dirname, "../src/lib/prisma-errors.js");
const { HttpError } = require("../src/lib/http-error");

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
    assert.equal(
      routes.stack.filter(
        (layer) => layer.route && String(layer.route.path).startsWith("/auth/oauth/")
      ).length,
      0,
      "OAuth link routes must not be registered on the unversioned auth router"
    );
    const linkRoutes = routes.oauthLinkRoutes.stack
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

const buildMountedV1App = ({ unlinkError = null } = {}) => {
  const linkNonceCreates = [];
  let sessionsCreated = 0;
  const { module: oauthService, restore: restoreOAuth } = loadModuleWithMocks(oauthPath, {
    [prismaPath]: {
      prisma: {
        oAuthLinkNonce: {
          create: async ({ data }) => {
            linkNonceCreates.push(data);
            return data;
          },
        },
      },
    },
    [envPath]: {
      env: {
        AUTH_ENCRYPTION_KEY: "oauth-route-test-key",
        SESSION_COOKIE_NAME: "quest_test_session",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GOOGLE_CALLBACK_URL: "https://api.example.test/legacy/google/callback",
        DISCORD_CLIENT_ID: "discord-client-id",
        DISCORD_CLIENT_SECRET: "discord-client-secret",
        DISCORD_CALLBACK_URL: "https://api.example.test/legacy/discord/callback",
      },
    },
    [loggerPath]: { logger: { error: () => {} } },
    [authServicePath]: {
      PUBLIC_USER_SELECT: { id: true },
      mapUserForResponse: (user) => user,
    },
  });

  oauthService.handleOAuthLinkCallback = async () => ({
    providers: [{ provider: "google", linked: true }],
  });
  if (unlinkError) {
    oauthService.unlinkOAuthProvider = async () => {
      throw unlinkError;
    };
  }

  const requireAuth = (req, res, next) => {
    if (!req.user) {
      next(new HttpError(401, "Authentication is required."));
      return;
    }
    next();
  };
  const { module: controller, restore: restoreController } = loadModuleWithMocks(
    controllerPath,
    {
      [oauthPath]: oauthService,
      [envPath]: { env: { APP_URL: "https://app.example.test" } },
      [loggerPath]: { logger: { info: () => {}, error: () => {} } },
      [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
      [sessionPath]: {
        createSession: async () => {
          sessionsCreated += 1;
          return {};
        },
      },
      [authServicePath]: {},
    }
  );
  const { module: routes, restore: restoreRoutes } = loadModuleWithMocks(routesPath, {
    [controllerPath]: controller,
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
  const { module: errorMiddleware, restore: restoreErrorMiddleware } = loadModuleWithMocks(
    errorHandlerPath,
    {
      [loggerPath]: { logger: { error: () => {} } },
      [monitoringPath]: { captureException: () => {} },
      [prismaErrorsPath]: { mapPrismaError: (error) => error },
    }
  );

  const app = express();
  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) {
      req.user = { id: req.headers["x-test-user"] };
    }
    next();
  });
  app.use("/api/v1", routes.oauthLinkRoutes);
  app.use(errorMiddleware.errorHandler);

  return {
    app,
    linkNonceCreates,
    getSessionsCreated: () => sessionsCreated,
    restore: () => {
      restoreRoutes();
      restoreErrorMiddleware();
      restoreController();
      restoreOAuth();
    },
  };
};

const withMountedServer = async (app, callback) => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

test("mounted v1 OAuth link routes use canonical callback URLs and link-only cookies", async () => {
  const lastLoginMethod = new HttpError(
    400,
    "You must keep a verified password or another linked OAuth provider."
  );
  lastLoginMethod.code = "OAUTH_LAST_LOGIN_METHOD";
  const mounted = buildMountedV1App({ unlinkError: lastLoginMethod });
  try {
    await withMountedServer(mounted.app, async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/api/v1/auth/oauth/google/link`);
      assert.equal(unauthenticated.status, 401);
      assert.equal((await unauthenticated.json()).error.code, "authentication_required");

      const unsupported = await fetch(`${baseUrl}/api/v1/auth/oauth/twitch/link`, {
        headers: { "x-test-user": "user-1" },
      });
      assert.equal(unsupported.status, 400);
      assert.equal((await unsupported.json()).error.code, "invalid_request");

      const start = await fetch(`${baseUrl}/api/v1/auth/oauth/google/link`, {
        headers: { "x-test-user": "user-1" },
        redirect: "manual",
      });
      assert.equal(start.status, 302);
      const authorizationUrl = new URL(start.headers.get("location"));
      assert.equal(
        authorizationUrl.searchParams.get("redirect_uri"),
        "https://api.example.test/api/v1/auth/oauth/google/link/callback"
      );
      assert.match(start.headers.get("set-cookie"), /Path=\/api\/v1\/auth/);
      assert.equal(mounted.linkNonceCreates.length, 1);

      const callback = await fetch(
        `${baseUrl}/api/v1/auth/oauth/google/link/callback?code=code&state=state`,
        {
          headers: {
            "x-test-user": "user-1",
            cookie: start.headers.get("set-cookie").split(";")[0],
          },
          redirect: "manual",
        }
      );
      assert.equal(callback.status, 302);
      assert.equal(
        callback.headers.get("location"),
        "https://app.example.test/profile?tab=account&oauth=linked"
      );
      assert.match(callback.headers.get("set-cookie"), /Path=\/api\/v1\/auth/);
      assert.equal(mounted.getSessionsCreated(), 0);

      const unlink = await fetch(`${baseUrl}/api/v1/auth/oauth/google`, {
        method: "DELETE",
        headers: { "x-test-user": "user-1" },
      });
      assert.equal(unlink.status, 400);
      const unlinkBody = await unlink.json();
      assert.equal(unlinkBody.error.code, "OAUTH_LAST_LOGIN_METHOD");
      assert.equal(unlinkBody.message, lastLoginMethod.message);
      assert.equal(unlinkBody.error.message.includes("provider token"), false);
    });
  } finally {
    mounted.restore();
  }
});
