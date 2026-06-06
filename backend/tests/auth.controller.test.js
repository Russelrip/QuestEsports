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
const mailPath = path.join(
  __dirname,
  "../src/lib/mail/sendSecurityEventEmail.js"
);
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
    getHeader: (name) => headers.get(name),
    setHeader: (name, value) => headers.set(name, value),
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
    [mailPath]: {
      sendSecurityEventEmail: async () => {},
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
      hasSessionFingerprint: async () => true,
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
