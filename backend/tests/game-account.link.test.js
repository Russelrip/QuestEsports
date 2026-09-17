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
  currentAccount = null,
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
        gameAccount: {
          findUnique: async () => existingAccount,
          findFirst: async () => currentAccount,
        },
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

test("an account on a player record nobody owns is explained, not handed over", async () => {
  // A player row outlives an admin-deleted user. Telling the person who comes
  // back that "another Quest account" holds their Riot account sends them
  // looking for an account that does not exist — but resolving a Riot ID proves
  // nothing about ownership, so it is still never claimed automatically.
  const { module: service, state, restore } = loadService({
    existingAccount: {
      id: "account-9",
      status: "active",
      verificationStatus: "user_confirmed",
      player: { userId: null },
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
        assert.equal(error.message, service.UNCLAIMED_RECORD_MESSAGE);
        return true;
      },
    );
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("an account the user replaced is not reported as already connected", async () => {
  // It does not show on their profile, so "already connected" would be a
  // success message for something they cannot see.
  const { module: service, state, restore } = loadService({
    existingAccount: {
      id: "account-0",
      status: "replaced",
      verificationStatus: "user_confirmed",
      player: { userId: "user-1" },
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
        assert.equal(error.message, service.PREVIOUS_ACCOUNT_MESSAGE);
        return true;
      },
    );
    assert.equal(state.created.length, 0);
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

test("an import never links a stranger who now holds the registered Riot name", async () => {
  // The leaderboard stored "Russel#1234" on the day this player registered.
  // Riot names are reusable: after a rename that name can resolve to somebody
  // else. Linking by name alone connected that stranger's account at
  // `user_confirmed`, without the player ever seeing it.
  const { module: service, restore, state } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "puuid-registered-before-rename", name: "Russel", tag: "1234" },
    }),
  });

  try {
    await assert.rejects(
      () =>
        service.importValorantAccountFromLeaderboard({
          userId: "user-1",
          displayName: "Russel",
          audit: AUDIT,
        }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Russel#1234/);
        assert.match(error.message, /current Riot ID/);
        return true;
      },
    );
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("an import compares identifiers without caring about their case", async () => {
  const { module: service, restore, state } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "  PUUID-ABC ", name: "Russel", tag: "1234" },
    }),
  });
  try {
    await service.importValorantAccountFromLeaderboard({
      userId: "user-1",
      displayName: "Russel",
      audit: AUDIT,
    });
    assert.equal(state.created[0].externalId, "puuid-abc");
  } finally {
    restore();
  }
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

// Connecting an account now also puts the player on the leaderboard, because
// the two journeys were asking for the same two things and a player who did one
// was quietly missing from the other.
//
// It is a call to another service attached to something that already committed,
// so every one of these is about the same rule: the link is the thing the player
// asked for, and nothing here may take it away from them.

test("connecting an account also registers it on the leaderboard", async () => {
  const submitted = [];
  const { module: service, restore } = loadService({
    leaderboardServiceOverride: {
      checkDiscord: async () => ({ exists: false }),
      submitRegistration: async (input) => { submitted.push(input); return { ok: true }; },
    },
  });

  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234", userId: "user-1", displayName: "Russel", audit: AUDIT,
    });
    assert.equal(result.leaderboard.state, "registered");
    assert.deepEqual(submitted, [{ userId: "user-1", puuid: "puuid-abc" }]);
  } finally {
    restore();
  }
});

test("a leaderboard that refuses or breaks never costs the player their link", async () => {
  for (const failure of [
    Object.assign(new Error("nope"), { code: "SOMETHING_ELSE" }),
    new Error("upstream down"),
  ]) {
    const { module: service, restore } = loadService({
      leaderboardServiceOverride: {
        checkDiscord: async () => ({ exists: false }),
        submitRegistration: async () => { throw failure; },
      },
    });
    try {
      const result = await service.linkValorantAccount({
        riotId: "Russel#1234", userId: "user-1", displayName: "Russel", audit: AUDIT,
      });
      // The account is connected. That is what was asked for.
      assert.equal(result.alreadyLinked, false);
      assert.equal(result.leaderboard.state, "unavailable");
    } finally {
      restore();
    }
  }
});

test("an account already on the leaderboard is not reported as a problem", async () => {
  const { module: service, restore } = loadService({
    leaderboardServiceOverride: {
      checkDiscord: async () => ({ exists: true, user: { puuid: "puuid-abc" } }),
      submitRegistration: async () => {
        throw Object.assign(new Error("dupe"), { code: "DISCORD_ALREADY_REGISTERED" });
      },
    },
  });

  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234", userId: "user-1", displayName: "Russel", audit: AUDIT,
    });
    // Their Discord already holds a registration, and it points at this very
    // account. Nothing to do, and nothing wrong.
    assert.equal(result.leaderboard.state, "already");
  } finally {
    restore();
  }
});

test("a leaderboard entry pointing at an older account is surfaced, not swallowed", async () => {
  const { module: service, restore } = loadService({
    leaderboardServiceOverride: {
      checkDiscord: async () => ({
        exists: true,
        user: { puuid: "puuid-an-older-account", name: "OldName", tag: "0000" },
      }),
      submitRegistration: async () => {
        throw Object.assign(new Error("dupe"), { code: "DISCORD_ALREADY_REGISTERED" });
      },
    },
  });

  try {
    const result = await service.linkValorantAccount({
      riotId: "Russel#1234", userId: "user-1", displayName: "Russel", audit: AUDIT,
    });
    // The upstream offers no way to re-point a registration, so this cannot be
    // fixed here. It is reported because a stale entry is worse than an absent
    // one: it looks current and is wrong.
    assert.equal(result.leaderboard.state, "diverged");
    assert.equal(result.leaderboard.registeredName, "OldName");
    assert.equal(result.leaderboard.registeredTag, "0000");
  } finally {
    restore();
  }
});

// The profile names the leaderboard account before offering it, so the player
// confirms an account they can see rather than trusting a button.

test("the leaderboard lookup names the account without exposing its identifier", async () => {
  const { module: service, restore } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "puuid-abc", name: "Russel", tag: "1234" },
    }),
  });
  try {
    const result = await service.findLeaderboardRegistration({ userId: "user-1" });
    assert.deepEqual(result, {
      discordConnected: true,
      unavailable: false,
      registration: {
        riotId: "Russel#1234",
        linkedToYou: false,
        linkedElsewhere: false,
        unclaimedRecord: false,
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /puuid-abc/);
  } finally {
    restore();
  }
});

test("the leaderboard lookup separates no Discord, no registration and no answer", async () => {
  const noDiscord = loadService({ discordAccount: null });
  try {
    const result = await noDiscord.module.findLeaderboardRegistration({ userId: "user-1" });
    assert.equal(result.discordConnected, false);
    assert.equal(result.registration, null);
  } finally {
    noDiscord.restore();
  }

  const notRegistered = loadService({ checkDiscord: async () => ({ exists: false, user: null }) });
  try {
    const result = await notRegistered.module.findLeaderboardRegistration({ userId: "user-1" });
    assert.equal(result.discordConnected, true);
    assert.equal(result.unavailable, false);
    assert.equal(result.registration, null);
  } finally {
    notRegistered.restore();
  }

  const down = loadService({
    checkDiscord: async () => {
      throw Object.assign(new Error("down"), { status: 503 });
    },
  });
  try {
    const result = await down.module.findLeaderboardRegistration({ userId: "user-1" });
    // "Could not check" is not "not registered".
    assert.equal(result.unavailable, true);
    assert.equal(result.registration, null);
  } finally {
    down.restore();
  }
});

test("a looked-up account is compared with the leaderboard by identifier, not by name", async () => {
  const { module: service, restore } = loadService({
    checkDiscord: async () => ({
      exists: true,
      user: { puuid: "puuid-abc", name: "OldName", tag: "0001" },
    }),
  });
  try {
    // A renamed account is still the registered one.
    assert.deepEqual(
      await service.compareWithLeaderboard({ userId: "user-1", externalId: "PUUID-ABC" }),
      { matches: true, riotId: "OldName#0001" },
    );
    assert.deepEqual(
      await service.compareWithLeaderboard({ userId: "user-1", externalId: "puuid-other" }),
      { matches: false, riotId: "OldName#0001" },
    );
  } finally {
    restore();
  }
});

test("nothing to compare with is never presented as a mismatch", async () => {
  const noDiscord = loadService({ discordAccount: null });
  try {
    assert.equal(
      await noDiscord.module.compareWithLeaderboard({ userId: "user-1", externalId: "puuid-abc" }),
      null,
    );
  } finally {
    noDiscord.restore();
  }

  const down = loadService({
    checkDiscord: async () => {
      throw new Error("down");
    },
  });
  try {
    assert.equal(
      await down.module.compareWithLeaderboard({ userId: "user-1", externalId: "puuid-abc" }),
      null,
    );
  } finally {
    down.restore();
  }
});

test("the profile shows a pending request, and a decision only while it is recent", () => {
  const { module: service, restore } = loadService();
  try {
    const now = Date.parse("2026-09-17T00:00:00.000Z");
    const base = {
      id: "request-1",
      requestedUsername: "NewName",
      requestedTagline: "2222",
      reason: "lost access",
      adminNote: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      reviewedAt: null,
    };

    assert.equal(
      service.visibleChangeRequest({ ...base, status: "pending" }, now).requestedIdentity,
      "NewName#2222",
    );
    const recent = {
      ...base,
      status: "rejected",
      adminNote: "No evidence",
      reviewedAt: "2026-09-10T00:00:00.000Z",
    };
    assert.equal(service.visibleChangeRequest(recent, now).adminNote, "No evidence");
    assert.equal(
      service.visibleChangeRequest({ ...recent, reviewedAt: "2026-08-01T00:00:00.000Z" }, now),
      null,
    );
    assert.equal(service.visibleChangeRequest({ ...base, status: "withdrawn" }, now), null);
    assert.equal(service.visibleChangeRequest(null, now), null);
  } finally {
    restore();
  }
});

// Registering on the leaderboard is how a player connects VALORANT, so the same
// step connects the account on Quest. Before, a registered player was ranked
// but had no Quest account, and team registration said so.

const registrationLeaderboard = (overrides = {}) => {
  const calls = { guard: 0, submitted: [] };
  const service = {
    checkDiscord: async () => ({ exists: false }),
    requireRegistrationDiscord: async () => {
      calls.guard += 1;
      return { discordId: "discord-123", discordUsername: "russel" };
    },
    submitRegistration: async (input) => {
      calls.submitted.push(input);
      return {
        success: true,
        message: "Registered",
        player: { puuid: "puuid-abc", name: "Russel", tag: "1234", current_rank: "Gold 2", elo: 1200 },
      };
    },
    ...overrides,
  };
  return { service, calls };
};

test("registering connects the same account on Quest", async () => {
  const leaderboard = registrationLeaderboard();
  const { module: service, restore, state } = loadService({ leaderboardServiceOverride: leaderboard.service });
  try {
    const result = await service.registerValorantAccount({
      userId: "user-1",
      puuid: "  puuid-abc  ",
      displayName: "Russel",
      audit: AUDIT,
    });

    assert.deepEqual(leaderboard.calls.submitted, [{ userId: "user-1", puuid: "puuid-abc" }]);
    assert.equal(result.success, true);
    assert.equal(result.account.username, "Russel");
    const [created] = state.created;
    assert.equal(created.externalId, "puuid-abc");
    assert.equal(created.tagline, "1234");
    // The leaderboard now pairs this Discord with this PUUID: the same agreement
    // an import records, and no more than that.
    assert.equal(created.verificationStatus, "discord_corroborated");
    assert.equal(state.audits[0].action, "game_account.linked");
  } finally {
    restore();
  }
});

test("a player without a linked Discord is refused before anything else happens", async () => {
  const refused = Object.assign(new Error("Link a Discord account first."), {
    statusCode: 403,
    code: "DISCORD_LINK_REQUIRED",
  });
  const leaderboard = registrationLeaderboard({
    requireRegistrationDiscord: async () => {
      throw refused;
    },
  });
  const { module: service, restore, state } = loadService({
    leaderboardServiceOverride: leaderboard.service,
    currentAccount: { externalId: "puuid-other", username: "Other", tagline: "0001" },
  });
  try {
    await assert.rejects(
      () => service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT }),
      (error) => error === refused,
    );
    assert.equal(leaderboard.calls.submitted.length, 0);
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("a profile already connected to another account is refused before the leaderboard changes", async () => {
  const leaderboard = registrationLeaderboard();
  const { module: service, restore, state } = loadService({
    leaderboardServiceOverride: leaderboard.service,
    currentAccount: { externalId: "puuid-main", username: "MyMain", tagline: "0001" },
  });
  try {
    await assert.rejects(
      () => service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /MyMain#0001/);
        assert.match(error.message, /Change account/);
        return true;
      },
    );
    // Otherwise the leaderboard and the profile would disagree from the start.
    assert.equal(leaderboard.calls.submitted.length, 0);
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("an account another Quest user holds is refused before the leaderboard changes", async () => {
  const leaderboard = registrationLeaderboard();
  const { module: service, restore, state } = loadService({
    leaderboardServiceOverride: leaderboard.service,
    existingAccount: {
      id: "account-9",
      status: "active",
      verificationStatus: "user_confirmed",
      player: { userId: "another-user" },
    },
  });
  try {
    await assert.rejects(
      () => service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT }),
      (error) => error.statusCode === 409 && error.message === service.LINKED_ELSEWHERE_MESSAGE,
    );
    assert.equal(leaderboard.calls.submitted.length, 0);
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("registering the account a profile already holds adds nothing on Quest", async () => {
  const leaderboard = registrationLeaderboard();
  const { module: service, restore, state } = loadService({
    leaderboardServiceOverride: leaderboard.service,
    currentAccount: { externalId: "puuid-abc", username: "Russel", tagline: "1234" },
  });
  try {
    const result = await service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT });
    assert.equal(leaderboard.calls.submitted.length, 1);
    assert.equal(result.account, null);
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("a leaderboard refusal reaches the player unchanged and connects nothing", async () => {
  const banned = Object.assign(new Error("This account is banned."), { status: 403 });
  const leaderboard = registrationLeaderboard({
    submitRegistration: async () => {
      throw banned;
    },
  });
  const { module: service, restore, state } = loadService({ leaderboardServiceOverride: leaderboard.service });
  try {
    await assert.rejects(
      () => service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT }),
      (error) => error === banned,
    );
    assert.equal(state.created.length, 0);
  } finally {
    restore();
  }
});

test("a registration that succeeded is not failed by the Quest write that follows", async () => {
  const leaderboard = registrationLeaderboard();
  const duplicate = Object.assign(new Error("unique constraint"), { code: "P2002" });
  const { module: service, restore } = loadService({
    leaderboardServiceOverride: leaderboard.service,
    createFails: duplicate,
  });
  try {
    // The player is on the leaderboard and that cannot be undone from here, so
    // the request reports it rather than claiming the whole thing failed.
    const result = await service.registerValorantAccount({ userId: "user-1", puuid: "puuid-abc", audit: AUDIT });
    assert.equal(result.success, true);
    assert.equal(result.account, null);
  } finally {
    restore();
  }
});
