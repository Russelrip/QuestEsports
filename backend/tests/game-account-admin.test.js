const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/game-account-admin.service.js",
);
const gameAccountServicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/game-account.service.js",
);
const leaderboardServicePath = path.join(
  __dirname,
  "../src/modules/valorant-leaderboard/service.js",
);
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const HELD = {
  id: "account-1",
  playerId: "player-1",
  game: "valorant",
  externalId: "puuid-held",
  username: "Sheeno",
  tagline: "LK1",
  region: "ap",
  verificationStatus: "discord_corroborated",
  status: "active",
  linkedAt: new Date("2026-01-05T00:00:00.000Z"),
  player: {
    id: "player-1",
    publicId: "QPID-000042",
    displayName: "Previous Holder",
    userId: "user-seller",
    user: { username: "seller" },
    discordIdentity: { username: "seller#0", globalName: "Seller" },
  },
  _count: { registrationSnapshots: 3 },
};

const REASON = "Account changed hands; previous holder confirmed in support.";

const loadService = ({
  account = HELD,
  remainingAccounts = 0,
  pendingRequests = 1,
  searchResults = [],
  leaderboardOverride = null,
} = {}) => {
  const state = {
    audits: [],
    deleted: [],
    requestUpdates: [],
    rankingDeletes: [],
    searches: [],
    leaderboardRemovals: [],
  };

  const tx = {
    gameAccount: {
      delete: async (args) => {
        state.deleted.push(args.where.id);
        return { id: args.where.id };
      },
      count: async () => remainingAccounts,
    },
    gameAccountChangeRequest: {
      updateMany: async (args) => {
        state.requestUpdates.push(args);
        return { count: pendingRequests };
      },
    },
    playerRanking: {
      deleteMany: async (args) => {
        state.rankingDeletes.push(args);
        return { count: 1 };
      },
    },
  };

  const loaded = loadModuleWithMocks(servicePath, {
    [gameAccountServicePath]: {
      fingerprint: (value) => `fp-${String(value).slice(0, 8)}`,
      normalizeExternalId: (value) => String(value || "").trim().toLowerCase(),
      VALORANT: "valorant",
    },
    [leaderboardServicePath]: leaderboardOverride || {
      removeAdminRegistration: async (args) => {
        state.leaderboardRemovals.push(args);
        return { removalId: "removal-1" };
      },
    },
    [prismaPath]: {
      prisma: {
        gameAccount: {
          findUnique: async () => account,
          findMany: async (args) => {
            state.searches.push(args);
            return searchResults;
          },
        },
        $transaction: async (fn) => fn(tx),
      },
    },
    [auditPath]: {
      recordAuditInTransaction: async (_db, entry) => {
        state.audits.push(entry);
        return entry;
      },
    },
    [loggerPath]: { logger: { info() {}, warn() {}, error() {} } },
  });

  return { ...loaded, state };
};

const rejects = async (promise, status, fragment) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, status);
    if (fragment) assert.match(error.message, fragment);
    return true;
  });
};

test("a Riot ID search matches the stored name and tag exactly", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.searchLinkedAccounts({ query: "Sheeno#LK1" });
    const [args] = state.searches;
    assert.deepEqual(args.where.username, { equals: "Sheeno", mode: "insensitive" });
    assert.deepEqual(args.where.tagline, { equals: "LK1", mode: "insensitive" });
    // An exact identity lookup must never widen into a substring sweep.
    assert.equal(args.where.OR, undefined);
  } finally {
    restore();
  }
});

test("a player public id searches the player rather than the Riot name", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.searchLinkedAccounts({ query: "QPID-000042" });
    const [args] = state.searches;
    assert.deepEqual(args.where.player, { publicId: { equals: "QPID-000042", mode: "insensitive" } });
  } finally {
    restore();
  }
});

test("anything else searches names across Quest, Riot and Discord", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.searchLinkedAccounts({ query: "sheeno" });
    const [args] = state.searches;
    assert.equal(args.where.OR.length, 4);
    assert.equal(args.take, service.MAX_RESULTS);
  } finally {
    restore();
  }
});

test("a one-character search is refused rather than returning the table", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await rejects(service.searchLinkedAccounts({ query: "s" }), 400);
    assert.equal(state.searches.length, 0);
  } finally {
    restore();
  }
});

test("the admin view names the holder but never the stable identifier", () => {
  const { module: service, restore } = loadService();
  try {
    const view = service.adminView(HELD);
    assert.equal(view.riotId, "Sheeno#LK1");
    assert.equal(view.player.displayName, "Previous Holder");
    assert.equal(view.player.discord.username, "seller#0");
    assert.equal(view.player.hasQuestAccount, true);
    assert.equal(view.externalId, undefined);
    assert.equal(view.externalIdFingerprint, "fp-puuid-he");
    // The blast radius is shown before the decision, not after it.
    assert.equal(view.registrationSnapshots, 3);
  } finally {
    restore();
  }
});

test("an unlink without a reason writes nothing", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await rejects(
      service.unlinkGameAccount({ accountId: "account-1", reason: "oops", adminUserId: "admin-1" }),
      400,
    );
    assert.equal(state.deleted.length, 0);
    assert.equal(state.audits.length, 0);
  } finally {
    restore();
  }
});

test("an unlink releases the identifier by deleting the row", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });

    // A `revoked` row would go on holding (game, external_id), so the account
    // would stay exactly as unclaimable as before.
    assert.deepEqual(state.deleted, ["account-1"]);
    assert.equal(result.released.riotId, "Sheeno#LK1");
    assert.equal(result.released.previousHolder.publicId, "QPID-000042");
    assert.equal(result.released.registrationSnapshots, 3);
  } finally {
    restore();
  }
});

test("the audit row carries what the deleted row can no longer say", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });

    const [entry] = state.audits;
    assert.equal(entry.action, "game_account.unlinked");
    assert.equal(entry.actorUserId, "admin-1");
    assert.equal(entry.reason, REASON);
    assert.equal(entry.beforeData.displayIdentity, "Sheeno#LK1");
    assert.equal(entry.beforeData.playerPublicId, "QPID-000042");
    assert.equal(entry.beforeData.verificationStatus, "discord_corroborated");
    assert.equal(entry.beforeData.externalIdFingerprint, "fp-puuid-he");
    // The identifier itself is redacted from audit rows by policy, so it must
    // never be the thing this entry relies on.
    assert.equal(entry.beforeData.externalId, undefined);
  } finally {
    restore();
  }
});

test("a pending change request made from the account is closed with an explanation", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });

    const [update] = state.requestUpdates;
    assert.deepEqual(update.where, { currentAccountId: "account-1", status: "pending" });
    assert.equal(update.data.status, "rejected");
    assert.equal(update.data.reviewedByUserId, "admin-1");
    assert.match(update.data.adminNote, /staff unlinked the account/);
    assert.equal(result.changeRequestsClosed, 1);
  } finally {
    restore();
  }
});

test("the cached profile rank goes only when no account for the game is left", async () => {
  const gone = loadService({ remainingAccounts: 0 });
  try {
    const result = await gone.module.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });
    assert.equal(gone.state.rankingDeletes.length, 1);
    assert.equal(result.rankingsCleared, 1);
  } finally {
    gone.restore();
  }

  const kept = loadService({ remainingAccounts: 1 });
  try {
    const result = await kept.module.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });
    assert.equal(kept.state.rankingDeletes.length, 0);
    assert.equal(result.rankingsCleared, 0);
  } finally {
    kept.restore();
  }
});

test("a renamed account refuses the unlink the admin was looking at", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await rejects(
      service.unlinkGameAccount({
        accountId: "account-1",
        reason: REASON,
        expectedRiotId: "Sheeno#OLD",
        adminUserId: "admin-1",
      }),
      409,
      /Search again/,
    );
    assert.equal(state.deleted.length, 0);
  } finally {
    restore();
  }
});

test("the confirmed identity is matched without case getting in the way", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      expectedRiotId: "sheeno#lk1",
      adminUserId: "admin-1",
    });
    assert.deepEqual(state.deleted, ["account-1"]);
  } finally {
    restore();
  }
});

test("an account locked to a roster is refused until it is confirmed", async () => {
  const locked = { ...HELD, status: "locked" };

  const refused = loadService({ account: locked });
  try {
    await rejects(
      refused.module.unlinkGameAccount({
        accountId: "account-1",
        reason: REASON,
        adminUserId: "admin-1",
      }),
      409,
      /locked to an approved tournament roster/,
    );
    assert.equal(refused.state.deleted.length, 0);
  } finally {
    refused.restore();
  }

  const confirmed = loadService({ account: locked });
  try {
    const result = await confirmed.module.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      allowLocked: true,
      adminUserId: "admin-1",
    });
    assert.deepEqual(confirmed.state.deleted, ["account-1"]);
    assert.equal(result.released.wasLocked, true);
  } finally {
    confirmed.restore();
  }
});

test("a missing account is a 404 rather than a silent success", async () => {
  const { module: service, restore } = loadService({ account: null });
  try {
    await rejects(
      service.unlinkGameAccount({ accountId: "nope", reason: REASON, adminUserId: "admin-1" }),
      404,
    );
  } finally {
    restore();
  }
});

test("the leaderboard is left alone unless the caller asked for it", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      adminUserId: "admin-1",
    });
    assert.equal(state.leaderboardRemovals.length, 0);
    assert.equal(result.leaderboard, null);
  } finally {
    restore();
  }
});

test("releasing the leaderboard removes the upstream registration by identifier", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      releaseLeaderboard: true,
      adminUserId: "admin-1",
    });
    assert.deepEqual(state.leaderboardRemovals, [{ puuid: "puuid-held", actorUserId: "admin-1" }]);
    assert.equal(result.leaderboard.state, "removed");
    assert.equal(result.leaderboard.removalId, "removal-1");
  } finally {
    restore();
  }
});

test("a leaderboard that cannot be reached reports the gap and keeps the unlink", async () => {
  const { module: service, state, restore } = loadService({
    leaderboardOverride: {
      removeAdminRegistration: async () => {
        throw Object.assign(new Error("upstream down"), { code: "UPSTREAM_UNAVAILABLE" });
      },
    },
  });
  try {
    const result = await service.unlinkGameAccount({
      accountId: "account-1",
      reason: REASON,
      releaseLeaderboard: true,
      adminUserId: "admin-1",
    });
    // The unlink committed before the upstream was touched and must stand.
    assert.deepEqual(state.deleted, ["account-1"]);
    assert.equal(result.leaderboard.state, "failed");
    assert.equal(result.leaderboard.reason, "UPSTREAM_UNAVAILABLE");
  } finally {
    restore();
  }
});
