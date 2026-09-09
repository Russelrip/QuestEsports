const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const http = require("node:http");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(
  __dirname,
  "../src/modules/auth/auth.controller.js"
);
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const oauthPath = path.join(
  __dirname,
  "../src/modules/auth/oauth.service.js"
);
const sessionPath = path.join(
  __dirname,
  "../src/modules/auth/session.service.js"
);
const authServicePath = path.join(
  __dirname,
  "../src/modules/auth/auth.service.js"
);
const authRoutesPath = path.join(
  __dirname,
  "../src/modules/auth/auth.routes.js"
);
const middlewarePath = path.join(
  __dirname,
  "../src/modules/auth/auth.middleware.js"
);
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const validationPath = path.join(__dirname, "../src/lib/validation.js");

const buildResponse = () => {
  const headers = new Map();

  return {
    headers,
    statusCode: null,
    body: null,
    getHeader: (name) => headers.get(name),
    setHeader: (name, value) => headers.set(name, value),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirectUrl: null,
    redirect(url) {
      this.redirectUrl = url;
    },
  };
};

const invoke = async (handler, req, res) => {
  let nextError = null;
  await handler(req, res, (error) => {
    nextError = error || null;
  });

  if (nextError) {
    throw nextError;
  }
};

test("OAuth controller binds callbacks to the browser flow cookie", async () => {
  const callbackCalls = [];
  const flowCookieCalls = [];
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: {
      env: {
        APP_URL: "https://app.example.com",
      },
    },
    [loggerPath]: {
      logger: {
        info: () => {},
        error: () => {},
      },
    },
    [oauthPath]: {
      buildExpiredOAuthFlowCookie: () => "oauth-flow=; Expires=expired",
      createOAuthAuthorization: ({ provider, redirectTo }) => ({
        authorizationUrl: `https://provider.example.com/${provider}?redirect=${redirectTo}`,
        flowCookie: "oauth-flow=signed-flow; HttpOnly",
      }),
      getOAuthFlowToken: (args) => {
        flowCookieCalls.push(args);
        return "signed-flow";
      },
      handleOAuthCallback: async (args) => {
        callbackCalls.push(args);
        return {
          redirectTo: "/profile",
          user: {
            id: "user-1",
            role: "user",
          },
        };
      },
    },
    [sessionPath]: {
      createSession: async () => ({
        token: "session-token",
        expiresAt: new Date(Date.now() + 60_000),
      }),
      setSessionCookie: (res) => {
        res.setHeader("Set-Cookie", "quest_session=session-token; HttpOnly");
      },
    },
    [authServicePath]: {
      markUserLoginSucceeded: async () => ({
        id: "user-1",
        role: "user",
      }),
    },
  });

  try {
    const startResponse = buildResponse();
    await invoke(
      controller.startGoogleAuth,
      {
        query: { redirect: "/profile" },
      },
      startResponse
    );

    assert.equal(
      startResponse.getHeader("Set-Cookie"),
      "oauth-flow=signed-flow; HttpOnly"
    );
    assert.equal(
      startResponse.redirectUrl,
      "https://provider.example.com/google?redirect=/profile"
    );

    const callbackResponse = buildResponse();
    await invoke(
      controller.googleCallback,
      {
        headers: {
          cookie: "oauth-flow=signed-flow",
          "user-agent": "test-agent",
        },
        ip: "127.0.0.1",
        query: {
          code: "oauth-code",
          state: "oauth-state",
        },
      },
      callbackResponse
    );

    assert.deepEqual(flowCookieCalls, [
      {
        provider: "google",
        cookieHeader: "oauth-flow=signed-flow",
      },
    ]);
    assert.deepEqual(callbackCalls, [
      {
        provider: "google",
        code: "oauth-code",
        state: "oauth-state",
        flowToken: "signed-flow",
      },
    ]);
    assert.deepEqual(callbackResponse.getHeader("Set-Cookie"), [
      "quest_session=session-token; HttpOnly",
      "oauth-flow=; Expires=expired",
    ]);
    assert.equal(callbackResponse.redirectUrl, "https://app.example.com/profile");
  } finally {
    restore();
  }
});

test("mobile admin password login issues a bearer session directly", async () => {
  const createSessionCalls = [];
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: {
      env: {
        APP_URL: "https://app.example.com",
        MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://api.example.com/mobile-admin-oauth",
      },
    },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [oauthPath]: {},
    [sessionPath]: {
      createSession: async (args) => {
        createSessionCalls.push(args);
        return {
          token: "a".repeat(96),
          expiresAt: "2026-09-03T01:00:00.000Z",
          sessionId: "session-1",
        };
      },
    },
    [authServicePath]: {
      authenticateUser: async () => ({
        userId: "admin-1",
        rememberMe: true,
        user: { id: "admin-1", role: "admin" },
      }),
      markUserLoginSucceeded: async () => ({ id: "admin-1", role: "admin" }),
    },
  });

  try {
    const response = buildResponse();
    await invoke(
      controller.mobileLogin,
      {
        body: { emailOrUsername: "admin", password: "secret" },
        headers: { "user-agent": "Quest Admin test" },
        ip: "127.0.0.1",
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.token, "a".repeat(96));
    assert.equal(response.body.user.role, "admin");
    assert.match(createSessionCalls[0].userAgent, /^Quest Admin Android/);
    assert.equal(response.getHeader("Set-Cookie"), undefined);
  } finally {
    restore();
  }
});

test("mobile Google OAuth returns a one-time app grant", async () => {
  const grantCalls = [];
  let sessionCreated = false;
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: {
      env: {
        APP_URL: "https://app.example.com",
        MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://api.example.com/mobile-admin-oauth",
      },
    },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [oauthPath]: {
      buildExpiredOAuthFlowCookie: () => "oauth-flow=; Expires=expired",
      createOAuthAuthorization: ({ provider, redirectTo }) => ({
        authorizationUrl: `https://provider.example.com/${provider}?redirect=${redirectTo}`,
        flowCookie: "oauth-flow=signed-flow; HttpOnly",
      }),
      getOAuthFlowToken: () => "signed-flow",
      handleOAuthCallback: async () => ({
        redirectTo: "/mobile-admin-oauth",
        mobileCodeChallenge: "c".repeat(43),
        user: { id: "admin-1", role: "admin" },
      }),
    },
    [sessionPath]: {
      createSession: async () => {
        sessionCreated = true;
        return {};
      },
    },
    [authServicePath]: {
      createMobileOAuthGrant: async (args) => {
        grantCalls.push(args);
        return { token: "mobile-grant", expiresAt: new Date() };
      },
    },
  });

  try {
    const startResponse = buildResponse();
    await invoke(
      controller.startMobileGoogleAuth,
      { query: { code_challenge: "c".repeat(43) } },
      startResponse
    );
    assert.equal(
      startResponse.redirectUrl,
      "https://provider.example.com/google?redirect=/mobile-admin-oauth"
    );

    const callbackResponse = buildResponse();
    await invoke(
      controller.googleCallback,
      {
        headers: { cookie: "oauth-flow=signed-flow", "user-agent": "Quest Admin" },
        ip: "127.0.0.1",
        query: { code: "oauth-code", state: "oauth-state" },
      },
      callbackResponse
    );

    assert.deepEqual(grantCalls, [{
      userId: "admin-1",
      provider: "google",
      codeChallenge: "c".repeat(43),
    }]);
    assert.equal(sessionCreated, false);
    assert.equal(callbackResponse.getHeader("Set-Cookie"), "oauth-flow=; Expires=expired");
    assert.equal(callbackResponse.redirectUrl, "https://api.example.com/mobile-admin-oauth?grant=mobile-grant&provider=google");
  } finally {
    restore();
  }
});

test("mobile OAuth start rejects requests without PKCE binding", async () => {
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [oauthPath]: { createOAuthAuthorization: () => assert.fail("OAuth must not start") },
    [sessionPath]: {},
    [authServicePath]: {},
  });

  try {
    await assert.rejects(
      invoke(controller.startMobileGoogleAuth, { query: {} }, buildResponse()),
      /valid mobile OAuth code challenge/,
    );
  } finally {
    restore();
  }
});

test("mobile OAuth grant exchange issues an admin bearer session", async () => {
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [oauthPath]: {},
    [sessionPath]: {
      createSession: async () => ({
        token: "b".repeat(96),
        expiresAt: "2026-09-03T01:00:00.000Z",
        sessionId: "session-oauth",
      }),
    },
    [authServicePath]: {
      consumeMobileOAuthGrant: async () => ({
        provider: "discord",
        user: { id: "admin-1", role: "admin" },
      }),
      markUserLoginSucceeded: async () => ({
        id: "admin-1",
        role: "admin",
      }),
    },
  });

  try {
    const response = buildResponse();
    await invoke(
      controller.exchangeMobileOAuthGrant,
      {
        body: { grantToken: "one-time-grant" },
        headers: { "user-agent": "Quest Admin test" },
        ip: "127.0.0.1",
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.token, "b".repeat(96));
    assert.equal(response.body.user.role, "admin");
    assert.equal(response.body.message, "Signed in with discord.");
  } finally {
    restore();
  }
});

test("OAuth account-link handlers use the authenticated user and default to the account tab", async () => {
  const linkAuthorizationCalls = [];
  const linkCallbackCalls = [];
  const providerListCalls = [];
  const unlinkCalls = [];
  let sessionsCreated = 0;
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [oauthPath]: {
      buildExpiredOAuthLinkFlowCookie: (provider) => `link-cookie-${provider}=; Expires=expired`,
      createOAuthLinkAuthorization: async (args) => {
        linkAuthorizationCalls.push(args);
        return {
          authorizationUrl: "https://provider.example.com/google",
          flowCookie: "quest_session_oauth_link_google=signed-link; HttpOnly",
        };
      },
      getOAuthLinkFlowToken: (args) => {
        linkCallbackCalls.push({ type: "flow-token", args });
        return "signed-link";
      },
      handleOAuthLinkCallback: async (args) => {
        linkCallbackCalls.push({ type: "callback", args });
        return { providers: [{ provider: "google", linked: true }] };
      },
      listLinkedOAuthProviders: async (userId) => {
        providerListCalls.push(userId);
        return [{ provider: "google", linked: true }];
      },
      unlinkOAuthProvider: async (args) => {
        unlinkCalls.push(args);
        return [{ provider: "google", linked: false }];
      },
    },
    [sessionPath]: {
      createSession: async () => {
        sessionsCreated += 1;
        return {};
      },
    },
    [authServicePath]: {},
  });

  try {
    const user = { id: "authenticated-user" };
    const startResponse = buildResponse();
    await invoke(controller.startGoogleLink, { user, params: {}, query: {} }, startResponse);
    assert.deepEqual(linkAuthorizationCalls, [{
      provider: "google",
      userId: "authenticated-user",
      redirectTo: "/profile?tab=account",
    }]);
    assert.equal(startResponse.getHeader("Set-Cookie"), "quest_session_oauth_link_google=signed-link; HttpOnly");

    const callbackResponse = buildResponse();
    await invoke(
      controller.googleLinkCallback,
      {
        user,
        headers: { cookie: "quest_session_oauth_link_google=signed-link" },
        params: {},
        query: { code: "oauth-code", state: "oauth-state" },
      },
      callbackResponse
    );
    assert.deepEqual(linkCallbackCalls, [
      {
        type: "flow-token",
        args: {
          provider: "google",
          cookieHeader: "quest_session_oauth_link_google=signed-link",
        },
      },
      {
        type: "callback",
        args: {
          provider: "google",
          code: "oauth-code",
          state: "oauth-state",
          flowToken: "signed-link",
          userId: "authenticated-user",
        },
      },
    ]);
    assert.equal(
      callbackResponse.getHeader("Set-Cookie"),
      "link-cookie-google=; Expires=expired"
    );
    assert.equal(
      callbackResponse.redirectUrl,
      "https://app.example.com/profile?tab=account&oauth=linked"
    );
    assert.equal(sessionsCreated, 0);

    const providersResponse = buildResponse();
    await invoke(
      controller.getLinkedProviders,
      { user, body: { userId: "attacker-user" } },
      providersResponse
    );
    assert.deepEqual(providerListCalls, ["authenticated-user"]);
    assert.deepEqual(providersResponse.body, {
      success: true,
      providers: [{ provider: "google", linked: true }],
    });

    const unlinkResponse = buildResponse();
    await invoke(
      controller.unlinkProvider,
      { user, params: { provider: "google" }, body: { userId: "attacker-user" } },
      unlinkResponse
    );
    assert.deepEqual(unlinkCalls, [{
      userId: "authenticated-user",
      provider: "google",
    }]);
    assert.deepEqual(unlinkResponse.body, {
      success: true,
      providers: [{ provider: "google", linked: false }],
    });
  } finally {
    restore();
  }
});

test("current-session responses retain the private Discord ID projection", async () => {
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: {} },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [oauthPath]: {},
    [sessionPath]: {},
    [authServicePath]: {
      mapUserForResponse: (value) => ({ ...value }),
    },
  });

  try {
    const linkedResponse = buildResponse();
    await invoke(
      controller.getCurrentSession,
      { user: { id: "user-1", discordId: "discord-snowflake" } },
      linkedResponse,
    );
    assert.equal(linkedResponse.body.user.discordId, "discord-snowflake");

    const unlinkedResponse = buildResponse();
    await invoke(
      controller.getCurrentSession,
      { user: { id: "user-2", discordId: null } },
      unlinkedResponse,
    );
    assert.equal(unlinkedResponse.body.user.discordId, null);
  } finally {
    restore();
  }
});

test("mounted /api/me and /api/mobile/auth/me responses expose private Discord ID", async () => {
  const { module: controller, restore: restoreController } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: {} },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [oauthPath]: {},
    [sessionPath]: {},
    [authServicePath]: {
      mapUserForResponse: (value) => ({ ...value }),
    },
  });
  const { module: routes, restore: restoreRoutes } = loadModuleWithMocks(authRoutesPath, {
    [controllerPath]: controller,
    [middlewarePath]: { requireAuth: (_req, _res, next) => next() },
    [rateLimitPath]: { createRateLimiter: () => (_req, _res, next) => next(), getClientIp: () => "127.0.0.1" },
    [validationPath]: { normalizeEmail: (value) => value, normalizeUsername: (value) => value },
  });
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: "user-1", discordId: "discord-snowflake" };
    next();
  });
  app.use("/api", routes);
  const server = app.listen(0, "127.0.0.1");

  const request = (requestPath) => new Promise((resolve, reject) => {
    const clientRequest = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: requestPath,
      method: "GET",
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    clientRequest.on("error", reject);
    clientRequest.end();
  });

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    for (const requestPath of ["/api/me", "/api/mobile/auth/me"]) {
      const response = await request(requestPath);
      assert.equal(response.status, 200);
      assert.equal(response.body.user.discordId, "discord-snowflake");
    }
  } finally {
    server.close();
    restoreRoutes();
    restoreController();
  }
});

test("OAuth account-link callback redirects conflicts without exposing provider details", async () => {
  let sessionsCreated = 0;
  const conflict = new Error("provider token and identity should not be returned");
  conflict.statusCode = 409;
  conflict.code = "OAUTH_ACCOUNT_CONFLICT";
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [oauthPath]: {
      buildExpiredOAuthLinkFlowCookie: () => "quest_session_oauth_link_discord=; Expires=expired",
      getOAuthLinkFlowToken: () => "signed-link",
      handleOAuthLinkCallback: async () => {
        throw conflict;
      },
    },
    [sessionPath]: {
      createSession: async () => {
        sessionsCreated += 1;
        return {};
      },
    },
    [authServicePath]: {},
  });

  try {
    const response = buildResponse();
    await invoke(
      controller.discordLinkCallback,
      {
        user: { id: "user-1" },
        headers: { cookie: "quest_session_oauth_link_discord=signed-link" },
        params: {},
        query: { code: "oauth-code", state: "oauth-state" },
      },
      response
    );
    assert.equal(
      response.getHeader("Set-Cookie"),
      "quest_session_oauth_link_discord=; Expires=expired"
    );
    assert.equal(
      response.redirectUrl,
      "https://app.example.com/profile?tab=account&oauth=error"
    );
    assert.equal(sessionsCreated, 0);
  } finally {
    restore();
  }
});

test("OAuth unlink controller preserves safe last-login-method errors", async () => {
  const lastLoginMethod = new Error(
    "You must keep a verified password or another linked OAuth provider."
  );
  lastLoginMethod.statusCode = 400;
  lastLoginMethod.code = "OAUTH_LAST_LOGIN_METHOD";
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [oauthPath]: {
      unlinkOAuthProvider: async () => {
        throw lastLoginMethod;
      },
    },
    [sessionPath]: {},
    [authServicePath]: {},
  });

  try {
    await assert.rejects(
      invoke(
        controller.unlinkProvider,
        {
          user: { id: "user-1" },
          params: { provider: "google" },
          body: { userId: "other-user" },
        },
        buildResponse()
      ),
      (error) => {
        assert.equal(error.code, "OAUTH_LAST_LOGIN_METHOD");
        assert.equal(error.message.includes("provider token"), false);
        return true;
      }
    );
  } finally {
    restore();
  }
});

// Connecting Discord is almost never the errand somebody set out on. It is the
// step in front of accepting a team invitation — which cannot be done without
// it — so the flow has to be able to come back to where it interrupted.
test("an account link returns to the destination it was started from", async () => {
  const linkAuthorizationCalls = [];
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { APP_URL: "https://app.example.com" } },
    [loggerPath]: { logger: { info: () => {}, error: () => {} } },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [oauthPath]: {
      buildExpiredOAuthLinkFlowCookie: (provider) => `link-cookie-${provider}=; Expires=expired`,
      createOAuthLinkAuthorization: async (args) => {
        linkAuthorizationCalls.push(args);
        return {
          authorizationUrl: "https://provider.example.com/discord",
          flowCookie: "quest_session_oauth_link_discord=signed-link; HttpOnly",
        };
      },
      getOAuthLinkFlowToken: () => "signed-link",
      handleOAuthLinkCallback: async () => ({
        providers: [{ provider: "discord", linked: true }],
        redirectTo: "/profile?tab=invitations&member=member-7",
      }),
    },
    [sessionPath]: {},
    [authServicePath]: {},
  });

  try {
    const user = { id: "authenticated-user" };

    await invoke(
      controller.startDiscordLink,
      { user, params: {}, query: { redirect: "/profile?tab=invitations&member=member-7" } },
      buildResponse()
    );
    assert.deepEqual(linkAuthorizationCalls, [{
      provider: "discord",
      userId: "authenticated-user",
      redirectTo: "/profile?tab=invitations&member=member-7",
    }]);

    // Anywhere but this site is refused by the same normalization the login
    // redirect uses, and falls back to the account tab rather than leaving.
    linkAuthorizationCalls.length = 0;
    await invoke(
      controller.startDiscordLink,
      { user, params: {}, query: { redirect: "https://evil.example.com/steal" } },
      buildResponse()
    );
    assert.equal(linkAuthorizationCalls[0].redirectTo, "/profile?tab=account");

    const callbackResponse = buildResponse();
    await invoke(
      controller.discordLinkCallback,
      {
        user,
        headers: { cookie: "quest_session_oauth_link_discord=signed-link" },
        params: {},
        query: { code: "oauth-code", state: "oauth-state" },
      },
      callbackResponse
    );
    // The marker rides on whatever destination the flow carried, so it cannot
    // assume there is already a query string to append to.
    assert.equal(
      callbackResponse.redirectUrl,
      "https://app.example.com/profile?tab=invitations&member=member-7&oauth=linked"
    );
  } finally {
    restore();
  }
});
