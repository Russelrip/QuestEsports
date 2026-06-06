const test = require("node:test");
const assert = require("node:assert/strict");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const UNVERIFIED_EMAIL_MESSAGE =
  "This provider account cannot be used to sign in until its email address is verified.";

const buildService = ({ emailVerified }) => {
  const existingUser = {
    id: "user-1",
    email: "player@example.com",
  };
  const oAuthAccountModel = {
    findUniqueCalls: [],
    createCalls: [],
    findUnique: async (args) => {
      oAuthAccountModel.findUniqueCalls.push(args);
      return null;
    },
    create: async (args) => {
      oAuthAccountModel.createCalls.push(args);
      return args;
    },
  };
  const userModel = {
    findUniqueCalls: [],
    findUnique: async (args) => {
      userModel.findUniqueCalls.push(args);
      return existingUser;
    },
  };

  const { module, restore } = loadModuleWithMocks(
    require.resolve("../src/modules/auth/oauth.service"),
    {
      [require.resolve("../src/lib/prisma")]: {
        prisma: {
          oAuthAccount: oAuthAccountModel,
          user: userModel,
          $transaction: async () => {
            throw new Error("Unexpected transaction in existing-user link test.");
          },
        },
      },
      [require.resolve("../src/config/env")]: {
        env: {
          AUTH_ENCRYPTION_KEY: "oauth-test-key",
          SESSION_COOKIE_NAME: "quest_session",
          DATABASE_URL: "postgresql://localhost/quest_test",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          GOOGLE_CALLBACK_URL: "http://localhost:5001/api/auth/google/callback",
        },
      },
      [require.resolve("../src/lib/logger")]: {
        logger: {
          error: () => {},
        },
      },
      [require.resolve("../src/modules/auth/auth.service")]: {
        PUBLIC_USER_SELECT: {
          id: true,
          email: true,
        },
        mapUserForResponse: (user) => user,
      },
    }
  );

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "access-token" }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        sub: "google-user-1",
        email: "player@example.com",
        email_verified: emailVerified,
        given_name: "Quest",
        family_name: "Player",
      }),
    };
  };

  return {
    existingUser,
    oAuthAccountModel,
    service: module,
    restore: () => {
      global.fetch = originalFetch;
      restore();
    },
  };
};

const getState = (service) => {
  const authorizationUrl = service.buildAuthorizationUrl({
    provider: "google",
    redirectTo: "/profile",
  });

  return new URL(authorizationUrl).searchParams.get("state");
};

test("OAuth callback does not auto-link an unverified provider email", async () => {
  const { service, oAuthAccountModel, restore } = buildService({
    emailVerified: false,
  });

  try {
    await assert.rejects(
      service.handleOAuthCallback({
        provider: "google",
        code: "oauth-code",
        state: getState(service),
      }),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, UNVERIFIED_EMAIL_MESSAGE);
        return true;
      }
    );

    assert.equal(oAuthAccountModel.createCalls.length, 0);
  } finally {
    restore();
  }
});

test("OAuth callback auto-links a verified provider email", async () => {
  const { service, existingUser, oAuthAccountModel, restore } = buildService({
    emailVerified: true,
  });

  try {
    const result = await service.handleOAuthCallback({
      provider: "google",
      code: "oauth-code",
      state: getState(service),
    });

    assert.deepEqual(result, {
      redirectTo: "/profile",
      user: existingUser,
    });
    assert.equal(oAuthAccountModel.createCalls.length, 1);
    assert.deepEqual(oAuthAccountModel.createCalls[0].data, {
      id: oAuthAccountModel.createCalls[0].data.id,
      userId: "user-1",
      provider: "google",
      providerUserId: "google-user-1",
      email: "player@example.com",
    });
  } finally {
    restore();
  }
});
