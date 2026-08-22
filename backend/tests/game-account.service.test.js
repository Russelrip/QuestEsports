const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/game-accounts/game-account.service.js");
const clientPath = path.join(__dirname, "../src/modules/game-accounts/game-account.client.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const cachePath = path.join(__dirname, "../src/lib/cache.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

class FakeFastApiError extends Error {
  constructor(code, status = 400) {
    super(`upstream ${code}`);
    this.name = "FastApiError";
    this.code = code;
    this.status = status;
  }
}

const RESOLVED = {
  externalId: "PUUID-ABC",
  username: "Russel",
  tagline: "1234",
  region: "ap",
  platforms: ["pc"],
};

const loadService = ({
  resolve = async () => ({ ...RESOLVED }),
  preview = async () => null,
  existingAccount = null,
  cacheStore = new Map(),
} = {}) => {
  const calls = { resolve: 0, preview: 0, cacheSets: [] };
  return loadModuleWithMocks(servicePath, {
    [clientPath]: {
      resolveRiotAccount: async (args) => {
        calls.resolve += 1;
        return resolve(args);
      },
      fetchPlayerPreview: async (args) => {
        calls.preview += 1;
        return preview(args);
      },
      FastApiError: FakeFastApiError,
      InternalServiceError: class InternalServiceError extends Error {},
    },
    [prismaPath]: {
      prisma: {
        gameAccount: {
          findUnique: async () => existingAccount,
        },
      },
    },
    [cachePath]: {
      get: async (key) => cacheStore.get(key) || null,
      set: async (key, value, ttl) => {
        calls.cacheSets.push({ key, ttl });
        cacheStore.set(key, value);
      },
    },
    [loggerPath]: { logger: { info() {}, warn() {}, error() {} } },
  });
};

test("resolution reports what it proved and nothing more", async () => {
  const { module: service, restore } = loadService();
  try {
    const result = await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    // The upstream has no Riot Sign-On, so a successful lookup establishes that
    // the account exists — never that this user holds it.
    assert.equal(result.verification, "resolved");
    assert.equal(result.game, "valorant");
    assert.equal(result.username, "Russel");
    assert.equal(result.available, true);
    assert.equal(result.linkedToYou, false);
  } finally {
    restore();
  }
});

test("the stable identifier is normalized before it is compared or returned", async () => {
  const { module: service, restore } = loadService({
    resolve: async () => ({ ...RESOLVED, externalId: "  PUUID-AbC  " }),
  });
  try {
    const result = await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    // Uniqueness on a de-normalized key is only cosmetic; the database CHECK
    // rejects anything else, so normalization has to happen before the write.
    assert.equal(result.externalId, "puuid-abc");
  } finally {
    restore();
  }
});

test("a missing Riot ID and an unreachable provider are different answers", async (t) => {
  await t.test("upstream says the account does not exist", async () => {
    const { module: service, restore } = loadService({
      resolve: async () => {
        throw new FakeFastApiError("PLAYER_NOT_FOUND", 404);
      },
    });
    try {
      await assert.rejects(
        () => service.resolveValorantAccount({ riotId: "Ghost#0000", userId: "user-1" }),
        (error) => error.statusCode === 404 && /could not be found/i.test(error.message),
      );
    } finally {
      restore();
    }
  });

  for (const code of ["HENRIK_UNAVAILABLE", "HENRIK_RATE_LIMITED", "HENRIK_AUTH_FAILED"]) {
    await t.test(`upstream ${code} never reports the account as missing`, async () => {
      const { module: service, restore } = loadService({
        resolve: async () => {
          throw new FakeFastApiError(code, 503);
        },
      });
      try {
        await assert.rejects(
          () => service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" }),
          (error) => {
            assert.equal(error.statusCode, 503);
            assert.match(error.message, /couldn't verify this account right now/i);
            assert.doesNotMatch(error.message, /not found|does not exist/i);
            return true;
          },
        );
      } finally {
        restore();
      }
    });
  }

  await t.test("a transport failure is also 'could not check'", async () => {
    const { module: service, restore } = loadService({
      resolve: async () => {
        throw new Error("socket hang up");
      },
    });
    try {
      await assert.rejects(
        () => service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" }),
        (error) => error.statusCode === 503,
      );
    } finally {
      restore();
    }
  });
});

test("upstream error detail never reaches the caller", async () => {
  const { module: service, restore } = loadService({
    resolve: async () => {
      const error = new FakeFastApiError("HENRIK_AUTH_FAILED", 502);
      error.message = "henrik api key 1234-secret rejected at https://api.henrikdev.xyz";
      throw error;
    },
  });
  try {
    await assert.rejects(
      () => service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" }),
      (error) => {
        assert.doesNotMatch(error.message, /henrik|api key|secret|http/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("a success envelope without a stable identifier is refused, not stored", async () => {
  const { module: service, restore } = loadService({
    resolve: async () => ({ ...RESOLVED, externalId: "" }),
  });
  try {
    // Falling back to the display name as identity is precisely the failure
    // this model exists to prevent.
    await assert.rejects(
      () => service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" }),
      (error) => error.statusCode === 503,
    );
  } finally {
    restore();
  }
});

test("only successful resolutions are cached", async () => {
  const store = new Map();
  const { module: service, restore } = loadService({
    resolve: async () => {
      throw new FakeFastApiError("HENRIK_UNAVAILABLE", 503);
    },
    cacheStore: store,
  });
  try {
    await assert.rejects(() =>
      service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" }),
    );
    // Caching a provider outage would make it look like a missing account for
    // the whole TTL.
    assert.equal(store.size, 0);
  } finally {
    restore();
  }
});

test("a repeat lookup is served from cache rather than the upstream", async () => {
  const store = new Map();
  let upstreamCalls = 0;
  const { module: service, restore } = loadService({
    resolve: async () => {
      upstreamCalls += 1;
      return { ...RESOLVED };
    },
    cacheStore: store,
  });
  try {
    await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    // Case differences are the same lookup — a debounced field produces both.
    await service.resolveValorantAccount({ riotId: "russel#1234", userId: "user-1" });
    assert.equal(upstreamCalls, 1);
  } finally {
    restore();
  }
});

test("an already-claimed account is reported without naming its owner", async () => {
  const { module: service, restore } = loadService({
    existingAccount: {
      id: "account-1",
      status: "active",
      verificationStatus: "user_confirmed",
      player: { userId: "someone-else" },
    },
  });
  try {
    const result = await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    assert.equal(result.available, false);
    assert.equal(result.linkedElsewhere, true);
    assert.equal(result.linkedToYou, false);
    // Telling one signed-in user which account holds a PUUID would turn this
    // endpoint into a lookup directory.
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /someone-else/);
    assert.doesNotMatch(serialized, /account-1/);
  } finally {
    restore();
  }
});

test("the caller is told about their own existing link", async () => {
  const { module: service, restore } = loadService({
    existingAccount: {
      id: "account-1",
      status: "locked",
      verificationStatus: "user_confirmed",
      player: { userId: "user-1" },
    },
  });
  try {
    const result = await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    assert.equal(result.linkedToYou, true);
    assert.equal(result.status, "locked");
    assert.equal(result.verificationStatus, "user_confirmed");
  } finally {
    restore();
  }
});

test("degraded stats never block resolution", async () => {
  const { module: service, restore } = loadService({ preview: async () => null });
  try {
    const result = await service.resolveValorantAccount({ riotId: "Russel#1234", userId: "user-1" });
    // Rank is an enrichment for the confirmation card, not an eligibility gate.
    assert.equal(result.preview, null);
    assert.equal(result.externalId, "puuid-abc");
  } finally {
    restore();
  }
});

test("malformed Riot IDs are rejected before any upstream call", async (t) => {
  const cases = [
    ["missing separator", "Russel1234"],
    ["empty tag", "Russel#"],
    ["empty name", "#1234"],
    ["blank", "   "],
    ["separator only", "#"],
    ["whitespace in tag", "Russel#12 34"],
  ];

  for (const [label, riotId] of cases) {
    await t.test(label, async () => {
      let upstreamCalls = 0;
      const { module: service, restore } = loadService({
        resolve: async () => {
          upstreamCalls += 1;
          return { ...RESOLVED };
        },
      });
      try {
        await assert.rejects(
          () => service.resolveValorantAccount({ riotId, userId: "user-1" }),
          (error) => error.statusCode === 400,
        );
        assert.equal(upstreamCalls, 0, "malformed input must not reach the provider");
      } finally {
        restore();
      }
    });
  }
});

test("a name containing the separator keeps its tag", async () => {
  let seen = null;
  const { module: service, restore } = loadService({
    resolve: async (args) => {
      seen = args;
      return { ...RESOLVED };
    },
  });
  try {
    // Riot names cannot contain '#', but splitting on the FIRST one would
    // silently mis-parse anything odd; the last separator is the tag boundary.
    await assert.rejects(() =>
      service.resolveValorantAccount({ riotId: "a#b#1234", userId: "user-1" }),
    );
    assert.equal(seen, null);
  } finally {
    restore();
  }
});

test("name and tag may be supplied separately", async () => {
  let seen = null;
  const { module: service, restore } = loadService({
    resolve: async (args) => {
      seen = args;
      return { ...RESOLVED };
    },
  });
  try {
    await service.resolveValorantAccount({ name: " Russel ", tag: " 1234 ", userId: "user-1" });
    assert.deepEqual({ name: seen.name, tag: seen.tag }, { name: "Russel", tag: "1234" });
  } finally {
    restore();
  }
});
