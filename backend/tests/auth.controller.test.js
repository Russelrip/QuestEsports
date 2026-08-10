const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(
  __dirname,
  "../src/modules/auth/auth.controller.js"
);
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
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
