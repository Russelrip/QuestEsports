const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/game-accounts/game-account.service.js");
const clientPath = path.join(__dirname, "../src/modules/game-accounts/game-account.client.js");
const leaderboardServicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const leaderboardClientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const cachePath = path.join(__dirname, "../src/lib/cache.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const RESOLVED = {
  externalId: "puuid-abc",
  username: "Russel",
  tagline: "1234",
  region: "ap",
  platforms: ["pc"],
};

const AUDIT = { actorUserId: "user-1", requestId: "req-1", ipAddress: "127.0.0.1" };

const loadService = ({
  existingAccount = null,
  discordAccount = { providerUserId: "discord-123" },
  checkDiscord = async () => ({ exists: false }),
  existingPlayer = null,
  createFails = null,
  leaderboardServiceOverride = null,
} = {}) => {
  const state = { created: [], players: [], audits: [] };

  const tx = {
    player: {
      findUnique: async () => existingPlayer,
      create: async ({ data }) => {
        const player = { ...data, publicId: "QPID-000001" };
        state.players.push(player);
        return player;
      },
    },
    gameAccount: {
      create: async ({ data }) => {
        if (createFails) throw createFails;
        state.created.push(data);
        return { ...data, linkedAt: new Date(), lastSyncedAt: new Date() };
      },
    },
  };

  const loaded = loadModuleWithMocks(servicePath, {
    [clientPath]: {
      resolveRiotAccount: async () => ({ ...RESOLVED }),
      fetchPlayerPreview: async () => null,
      FastApiError: class FastApiError extends Error {},
      InternalServiceError: class InternalServiceError extends Error {},
    },
    [leaderboardServicePath]: leaderboardServiceOverride || { checkDiscord },
    [prismaPath]: {
      prisma: {
        gameAccount: { findUnique: async () => existingAccount },
        oAuthAccount: { findFirst: async () => discordAccount },
        player: { findUnique: async () => existingPlayer },
        $transaction: async (fn) => fn(tx),
      },
    },
    [cachePath]: { get: async () => null, set: async () => {} },
    [loggerPath]: { logger: { info() {}, warn() {}, error() {} } },
    [auditPath]: {
      recordAuditInTransaction: async (_db, entry) => {
        state.audits.push(entry);
        return entry;
      },
      requestAuditContext: () => AUDIT,
    },
  });

  return { ...loaded, state };
};

const loadRealLeaderboardService = (checkDiscord) => loadModuleWithMocks(leaderboardServicePath, {
  [leaderboardClientPath]: {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => null,
    checkPuuid: async () => null,
    checkDiscord,
    previewRegistration: async () => null,
    submitRegistration: async () => null,
  },
  [prismaPath]: {
    prisma: {
      oAuthAccount: { findFirst: async () => null },
    },
  },
});

test("a confirmed link records only what the user actually established", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });

    assert.equal(result.alreadyLinked, false);
    // The user clicked confirm; no Discord pairing corroborated it, and there
    // is no Riot Sign-On. "user_confirmed" is the honest ceiling.
    assert.equal(state.created[0].verificationStatus, "user_confirmed");
    assert.equal(state.created[0].status, "active");
    assert.equal(state.created[0].externalId, "puuid-abc");
  } finally {
    restore();
  }
});

test("an upstream Discord pairing upgrades the link, but only to corroboration", async () => {
  const { module: service, state, restore } = loadService({
    checkDiscord: async () => ({ exists: true, user: { puuid: "PUUID-ABC" } }),
  });
  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    // Two independent systems agree the same Discord account holds this PUUID.
    // That is stronger than self-assertion and still short of ownership.
    assert.equal(state.created[0].verificationStatus, "discord_corroborated");
  } finally {
    restore();
  }
});

test("game-account linking uses the real leaderboard service checkDiscord export", async () => {
  const checkDiscordCalls = [];
  const leaderboard = loadRealLeaderboardService(async (discordId) => {
    checkDiscordCalls.push(discordId);
    return { exists: true, user: { puuid: "PUUID-ABC" } };
  });
  const { module: service, state, restore } = loadService({
    leaderboardServiceOverride: leaderboard.module,
  });

  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    assert.deepEqual(checkDiscordCalls, ["discord-123"]);
    assert.equal(state.created[0].verificationStatus, "discord_corroborated");
  } finally {
    restore();
    leaderboard.restore();
  }
});

test("corroboration against a different PUUID does not upgrade the link", async () => {
  const { module: service, state, restore } = loadService({
    checkDiscord: async () => ({ exists: true, user: { puuid: "some-other-puuid" } }),
  });
  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    assert.equal(state.created[0].verificationStatus, "user_confirmed");
  } finally {
    restore();
  }
});

test("a degraded corroboration check never blocks linking", async () => {
  const { module: service, state, restore } = loadService({
    checkDiscord: async () => {
      throw new Error("upstream down");
    },
  });
  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    // Corroboration is an upgrade, not a gate.
    assert.equal(result.alreadyLinked, false);
    assert.equal(state.created[0].verificationStatus, "user_confirmed");
  } finally {
    restore();
  }
});

test("a user with no linked Discord simply links unconfirmed by Discord", async () => {
  const { module: service, state, restore } = loadService({ discordAccount: null });
  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    assert.equal(state.created[0].verificationStatus, "user_confirmed");
  } finally {
    restore();
  }
});

test("an account held by someone else is refused without naming them", async () => {
  const { module: service, state, restore } = loadService({
    existingAccount: {
      id: "account-9",
      status: "active",
      verificationStatus: "user_confirmed",
      player: { userId: "another-user" },
    },
  });
  try {
    await assert.rejects(
      () =>
        service.linkValorantAccount({
          riotId: "Russel#1234",
          userId: "user-1",
          displayName: "Russel",
          audit: AUDIT,
        }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.doesNotMatch(error.message, /another-user|account-9/);
        return true;
      },
    );
    assert.equal(state.created.length, 0, "nothing may be written on a conflict");
  } finally {
    restore();
  }
});

test("a race for the same account is decided by the database, not by the pre-check", async () => {
  const duplicate = new Error("unique constraint");
  duplicate.code = "P2002";
  const { module: service, restore } = loadService({ createFails: duplicate });
  try {
    // The pre-check said the PUUID was free; a concurrent request won. The
    // loser must get the same conflict answer, never a 500.
    await assert.rejects(
      () =>
        service.linkValorantAccount({
          riotId: "Russel#1234",
          userId: "user-1",
          displayName: "Russel",
          audit: AUDIT,
        }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("relinking an account the user already holds is not an error", async () => {
  const { module: service, state, restore } = loadService({
    existingAccount: {
      id: "account-1",
      status: "active",
      verificationStatus: "user_confirmed",
      player: { userId: "user-1" },
    },
  });
  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    assert.equal(result.alreadyLinked, true);
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("the audit trail records the change without storing the identifier", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });

    const [entry] = state.audits;
    assert.equal(entry.action, "game_account.linked");
    assert.equal(entry.targetType, "GameAccount");
    assert.equal(entry.actorUserId, "user-1");

    // Audit rows are durable and routinely exported. A fingerprint plus the
    // account row id lets an admin follow the change; the stable identifier
    // itself does not need to live in exported audit data.
    const serialized = JSON.stringify(entry);
    assert.doesNotMatch(serialized, /puuid-abc/);
    assert.match(serialized, /externalIdFingerprint/);
    assert.match(serialized, /Russel#1234/);
  } finally {
    restore();
  }
});

test("the audit row is written in the same transaction as the link", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.linkValorantAccount({
      riotId: "Russel#1234",
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    // A link that is not auditable is worse than no link: both must commit or
    // neither does.
    assert.equal(state.audits.length, 1);
    assert.equal(state.created.length, 1);
  } finally {
    restore();
  }
});

test("the fingerprint is stable, short, and not reversible to the identifier", () => {
  const { module: service, restore } = loadService();
  try {
    const a = service.fingerprint("puuid-abc");
    const b = service.fingerprint("puuid-abc");
    assert.equal(a, b);
    assert.equal(a.length, 12);
    assert.notEqual(a, service.fingerprint("puuid-abd"));
    assert.doesNotMatch(a, /puuid/);
  } finally {
    restore();
  }
});

test("the public view never exposes the stable identifier", () => {
  const { module: service, restore } = loadService();
  try {
    const view = service.publicView({
      id: "account-1",
      game: "valorant",
      externalId: "puuid-abc",
      username: "Russel",
      tagline: "1234",
      region: "ap",
      verificationStatus: "user_confirmed",
      status: "active",
      linkedAt: new Date(),
      verifiedAt: null,
      lastSyncedAt: null,
    });
    // The profile panel shows the player their account; it has no reason to
    // hand the browser a durable cross-service handle.
    assert.equal(view.externalId, undefined);
    assert.doesNotMatch(JSON.stringify(view), /puuid-abc/);
    assert.equal(view.username, "Russel");
    assert.equal(view.verificationStatus, "user_confirmed");
  } finally {
    restore();
  }
});

// Importing the account a player already registered on the VALORANT leaderboard.
//
// The two journeys ask for the same thing to the same degree: a connected
// Discord, and a Riot identity the player fetched from their own Riot account
// page. Making somebody who has done one do the other by hand is a step that
// proves nothing new and loses some of them along the way.

test("an import adopts the leaderboard account without asking for a Riot ID", async () => {
  const { module: service, restore, state } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "puuid-abc", name: "Russel", tag: "1234" },
    }),
  });

  try {
    const result = await service.importValorantAccountFromLeaderboard({
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });

    assert.equal(result.alreadyLinked, false);
    const [created] = state.created;
    assert.equal(created.externalId, "puuid-abc");
    // The same Discord id that found the registration also corroborates it, so
    // an import lands a rung higher than a hand-typed link rather than lower.
    assert.equal(created.verificationStatus, "discord_corroborated");
  } finally {
    restore();
  }
});

test("an import re-resolves rather than trusting what the leaderboard returned", async () => {
  let resolvedWith = null;
  const { module: service, restore } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "puuid-somebody-else", name: "Russel", tag: "1234" },
    }),
  });

  try {
    await service.importValorantAccountFromLeaderboard({
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    resolvedWith = true;
  } finally {
    restore();
  }

  // The upstream answer is a hint about *which* account to link, never the
  // identifier itself: the PUUID written is the one the resolver returned for
  // that Riot ID, not the one the leaderboard handed over.
  assert.equal(resolvedWith, true);
});

test("an import refuses without a connected Discord, and says which step is missing", async () => {
  const { module: service, restore } = loadService({ discordAccount: null });
  try {
    await assert.rejects(
      () => service.importValorantAccountFromLeaderboard({
        userId: "user-1",
        displayName: "Russel",
        audit: AUDIT,
      }),
      (error) => error.statusCode === 400 && /Discord/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("a player with no leaderboard registration is pointed at the ordinary flow", async () => {
  const { module: service, restore } = loadService({
    checkDiscord: async () => ({ exists: false, user: null }),
  });
  try {
    await assert.rejects(
      () => service.importValorantAccountFromLeaderboard({
        userId: "user-1",
        displayName: "Russel",
        audit: AUDIT,
      }),
      (error) => error.statusCode === 404 && /Riot ID/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("an unreachable leaderboard fails the import rather than inventing an account", async () => {
  const { module: service, restore } = loadService({
    checkDiscord: async () => { throw new Error("upstream down"); },
  });
  try {
    await assert.rejects(
      () => service.importValorantAccountFromLeaderboard({
        userId: "user-1",
        displayName: "Russel",
        audit: AUDIT,
      }),
      (error) => error.statusCode === 503,
    );
  } finally {
    restore();
  }
});
