const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

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
  const tokenRequestBodies = [];

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
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      tokenRequestBodies.push(new URLSearchParams(options.body));
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
    tokenRequestBodies,
    restore: () => {
      global.fetch = originalFetch;
      restore();
    },
  };
};

const getState = (service) => {
  const authorization = service.createOAuthAuthorization({
    provider: "google",
    redirectTo: "/profile",
  });

  return {
    authorizationUrl: authorization.authorizationUrl,
    flowToken: service.getOAuthFlowToken({
      provider: "google",
      cookieHeader: authorization.flowCookie,
    }),
    state: new URL(authorization.authorizationUrl).searchParams.get("state"),
  };
};

const buildLinkService = ({ existingAccount = null, accounts = [], hasPassword = true } = {}) => {
  const linkedAccounts = [...accounts];
  const createCalls = [];
  const deleteCalls = [];
  const oauthAccount = {
    findUnique: async () => existingAccount,
    findMany: async () => linkedAccounts.map((account) => ({ provider: account.provider })),
    create: async ({ data }) => {
      createCalls.push({ data });
      linkedAccounts.push(data);
      return data;
    },
  };
  const tx = {
    user: {
      findUnique: async () => ({ id: "user-1", passwordHash: hasPassword ? "hash" : null }),
    },
    oAuthAccount: {
      findFirst: async ({ where }) =>
        linkedAccounts.find(
          (account) => account.userId === where.userId && account.provider === where.provider
        ) || null,
      count: async ({ where }) =>
        linkedAccounts.filter(
          (account) =>
            account.userId === where.userId &&
            (!where.provider || account.provider === where.provider)
        ).length,
      deleteMany: async ({ where }) => {
        deleteCalls.push({ where });
        const kept = linkedAccounts.filter(
          (account) => account.userId !== where.userId || account.provider !== where.provider
        );
        const count = linkedAccounts.length - kept.length;
        linkedAccounts.splice(0, linkedAccounts.length, ...kept);
        return { count };
      },
    },
  };
  const { module, restore } = loadModuleWithMocks(
    require.resolve("../src/modules/auth/oauth.service"),
    {
      [require.resolve("../src/lib/prisma")]: {
        prisma: {
          oAuthAccount: oauthAccount,
          $transaction: async (callback) => callback(tx),
        },
      },
      [require.resolve("../src/config/env")]: {
        env: {
          AUTH_ENCRYPTION_KEY: "oauth-link-test-key",
          SESSION_COOKIE_NAME: "quest_session",
          DATABASE_URL: "postgresql://localhost/quest_test",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          GOOGLE_CALLBACK_URL: "http://localhost:5001/api/auth/google/callback",
          DISCORD_CLIENT_ID: "discord-client-id",
          DISCORD_CLIENT_SECRET: "discord-client-secret",
          DISCORD_CALLBACK_URL: "http://localhost:5001/api/auth/discord/callback",
        },
      },
      [require.resolve("../src/lib/logger")]: { logger: { error: () => {} } },
      [require.resolve("../src/modules/auth/auth.service")]: {
        PUBLIC_USER_SELECT: { id: true, email: true },
        mapUserForResponse: (user) => user,
        getUserLoginMethodState: async ({ userId, tx: transaction }) => {
          const loginUser = await transaction.user.findUnique({ where: { id: userId } });
          return loginUser ? { userId, hasVerifiedPassword: hasPassword } : null;
        },
      },
    }
  );
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sub: "google-user-1",
        email: "player@example.com",
        email_verified: true,
        given_name: "Quest",
        family_name: "Player",
      }),
    };
  };
  return {
    service: module,
    createCalls,
    deleteCalls,
    getLinkState: () => {
      const authorization = module.createOAuthLinkAuthorization({
        provider: "google",
        userId: "user-1",
        redirectTo: "/profile?tab=account",
      });
      return {
        state: new URL(authorization.authorizationUrl).searchParams.get("state"),
        flowToken: module.getOAuthFlowToken({
          provider: "google",
          cookieHeader: authorization.flowCookie,
        }),
      };
    },
    restore: () => {
      global.fetch = originalFetch;
      restore();
    },
  };
};

test("OAuth callback does not auto-link an unverified provider email", async () => {
  const { service, oAuthAccountModel, restore } = buildService({
    emailVerified: false,
  });

  try {
    const { flowToken, state } = getState(service);
    await assert.rejects(
      service.handleOAuthCallback({
        provider: "google",
        code: "oauth-code",
        state,
        flowToken,
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
    const { flowToken, state } = getState(service);
    const result = await service.handleOAuthCallback({
      provider: "google",
      code: "oauth-code",
      state,
      flowToken,
    });

    assert.deepEqual(result, {
      redirectTo: "/profile",
      mobileCodeChallenge: null,
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

test("OAuth authorization uses S256 PKCE and binds callback state to its flow cookie", async () => {
  const { service, tokenRequestBodies, restore } = buildService({
    emailVerified: true,
  });

  try {
    const { authorizationUrl, flowToken, state } = getState(service);
    const parsedAuthorizationUrl = new URL(authorizationUrl);

    assert.equal(
      parsedAuthorizationUrl.searchParams.get("code_challenge_method"),
      "S256"
    );
    assert.ok(parsedAuthorizationUrl.searchParams.get("code_challenge"));

    await assert.rejects(
      service.handleOAuthCallback({
        provider: "google",
        code: "oauth-code",
        state,
        flowToken: "",
      }),
      (error) => error.statusCode === 400 && error.message === "Invalid OAuth state."
    );

    const otherFlow = getState(service);
    await assert.rejects(
      service.handleOAuthCallback({
        provider: "google",
        code: "oauth-code",
        state,
        flowToken: otherFlow.flowToken,
      }),
      (error) => error.statusCode === 400 && error.message === "Invalid OAuth state."
    );

    assert.ok(flowToken);

    await service.handleOAuthCallback({
      provider: "google",
      code: "oauth-code",
      state,
      flowToken,
    });

    assert.equal(tokenRequestBodies.length, 1);
    const codeVerifier = tokenRequestBodies[0].get("code_verifier");
    const expectedChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    assert.equal(
      parsedAuthorizationUrl.searchParams.get("code_challenge"),
      expectedChallenge
    );
  } finally {
    restore();
  }
});

test("OAuth link authorization binds signed state and PKCE to the authenticated user", async () => {
  const { service, getLinkState, restore } = buildLinkService();
  try {
    const { state, flowToken } = getLinkState();

    await assert.rejects(
      service.handleOAuthLinkCallback({
        provider: "google",
        code: "code",
        state,
        flowToken,
        userId: "other-user",
      }),
      (error) => error.statusCode === 403
    );
  } finally {
    restore();
  }
});

test("OAuth link callback creates an account and returns provider summaries", async () => {
  const { service, createCalls, getLinkState, restore } = buildLinkService();
  try {
    const result = await service.handleOAuthLinkCallback({
      provider: "google",
      code: "code",
      ...getLinkState(),
      userId: "user-1",
    });
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].data.userId, "user-1");
    assert.equal(createCalls[0].data.providerUserId, "google-user-1");
    assert.deepEqual(result.providers, [
      { provider: "google", linked: true },
      { provider: "discord", linked: false },
    ]);
  } finally {
    restore();
  }
});

test("link callback rejects a provider account owned by another user", async () => {
  const { service, createCalls, getLinkState, restore } = buildLinkService({
    existingAccount: { userId: "other-user" },
  });
  try {
    await assert.rejects(
      service.handleOAuthLinkCallback({
        provider: "google",
        code: "code",
        ...getLinkState(),
        userId: "user-1",
      }),
      (error) => error.code === "OAUTH_ACCOUNT_CONFLICT"
    );
    assert.equal(createCalls.length, 0);
  } finally {
    restore();
  }
});

test("OAuth link callback rejects state and flow-cookie reuse", async () => {
  const { service, getLinkState, restore } = buildLinkService();
  try {
    const linkState = getLinkState();
    const request = { provider: "google", code: "code", ...linkState, userId: "user-1" };
    await service.handleOAuthLinkCallback(request);
    await assert.rejects(
      service.handleOAuthLinkCallback(request),
      (error) => error.statusCode === 400 && /already been used/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("unlinking the last OAuth login method is rejected", async () => {
  const { service, deleteCalls, restore } = buildLinkService({
    accounts: [{ id: "oauth-1", userId: "user-1", provider: "google" }],
    hasPassword: false,
  });
  try {
    await assert.rejects(
      service.unlinkOAuthProvider({ userId: "user-1", provider: "google" }),
      (error) => error.code === "OAUTH_LAST_LOGIN_METHOD"
    );
    assert.equal(deleteCalls.length, 0);
  } finally {
    restore();
  }
});

test("unlinking an OAuth provider preserves another linked provider", async () => {
  const { service, deleteCalls, restore } = buildLinkService({
    accounts: [
      { id: "oauth-1", userId: "user-1", provider: "google" },
      { id: "oauth-2", userId: "user-1", provider: "discord" },
    ],
    hasPassword: false,
  });
  try {
    const providers = await service.unlinkOAuthProvider({ userId: "user-1", provider: "google" });
    assert.equal(deleteCalls.length, 1);
    assert.deepEqual(providers, [
      { provider: "google", linked: false },
      { provider: "discord", linked: true },
    ]);
  } finally {
    restore();
  }
});
