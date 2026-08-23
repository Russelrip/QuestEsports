const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/game-account-change.service.js",
);
const gameAccountServicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/game-account.service.js",
);
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "../prisma/migrations/20260823150000_add_game_account_change_requests/migration.sql",
  ),
  "utf8",
);

const CURRENT = {
  id: "account-1",
  game: "valorant",
  externalId: "puuid-old",
  username: "OldName",
  tagline: "1111",
  region: "ap",
  verificationStatus: "user_confirmed",
  status: "active",
};

const loadService = ({
  player = { id: "player-1", gameAccounts: [{ ...CURRENT }] },
  resolved = { externalId: "puuid-new", username: "NewName", tagline: "2222", region: "ap", linkedElsewhere: false },
  openRequest = null,
  request = null,
} = {}) => {
  const state = { accountUpdates: [], accountCreates: [], requests: [], audits: [], reviews: [] };
  const tx = {
    gameAccount: {
      update: async (args) => {
        state.accountUpdates.push(args);
        return { ...CURRENT, ...args.data };
      },
      create: async ({ data }) => {
        state.accountCreates.push(data);
        return data;
      },
    },
    gameAccountChangeRequest: {
      create: async ({ data }) => {
        state.requests.push(data);
        return { ...data, status: "pending" };
      },
      findUnique: async () => request,
      update: async (args) => {
        state.reviews.push(args);
        return { ...request, ...args.data };
      },
    },
  };

  const loaded = loadModuleWithMocks(servicePath, {
    [gameAccountServicePath]: {
      resolveValorantAccount: async () => resolved,
      fingerprint: (value) => `fp-${String(value).slice(0, 6)}`,
      publicView: (account) => ({ id: account.id, username: account.username, tagline: account.tagline }),
      VALORANT: "valorant",
    },
    [prismaPath]: {
      prisma: {
        player: { findUnique: async () => player },
        gameAccountChangeRequest: { findFirst: async () => openRequest },
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

test("a rename and a replacement are told apart by the stable identifier", () => {
  const { module: service, restore } = loadService();
  try {
    assert.equal(
      service.classifyChange({ currentExternalId: "puuid-a", requestedExternalId: "puuid-a" }),
      "rename",
    );
    assert.equal(
      service.classifyChange({ currentExternalId: "puuid-a", requestedExternalId: "puuid-b" }),
      "replacement",
    );
  } finally {
    restore();
  }
});

test("a Riot rename refreshes display data with no admin involved", async () => {
  const { module: service, state, restore } = loadService({
    resolved: {
      externalId: "puuid-old",
      username: "BrandNewName",
      tagline: "9999",
      region: "ap",
      linkedElsewhere: false,
    },
  });
  try {
    const result = await service.requestAccountChange({
      userId: "user-1",
      riotId: "BrandNewName#9999",
      reason: "I renamed on Riot",
    });

    assert.equal(result.kind, "rename");
    assert.equal(result.refreshed, true);
    // No request row: making admins approve renames would bury them in
    // paperwork and train them to rubber-stamp.
    assert.equal(state.requests.length, 0);
    const [update] = state.accountUpdates;
    assert.equal(update.data.username, "BrandNewName");
    assert.equal(update.data.tagline, "9999");
    // The identity key must not move.
    assert.equal(update.data.externalId, undefined);
  } finally {
    restore();
  }
});

test("a rename that changes nothing writes nothing", async () => {
  const { module: service, state, restore } = loadService({
    resolved: { externalId: "puuid-old", username: "OldName", tagline: "1111", region: "ap", linkedElsewhere: false },
  });
  try {
    const result = await service.requestAccountChange({
      userId: "user-1",
      riotId: "OldName#1111",
      reason: "checking",
    });
    assert.equal(result.refreshed, false);
    assert.equal(state.accountUpdates.length, 0);
    assert.equal(state.audits.length, 0);
  } finally {
    restore();
  }
});

test("a genuine replacement opens a request and swaps nothing yet", async () => {
  const { module: service, state, restore } = loadService();
  try {
    const result = await service.requestAccountChange({
      userId: "user-1",
      riotId: "NewName#2222",
      reason: "I lost access to my old Riot account",
    });

    assert.equal(result.kind, "replacement");
    assert.equal(result.status, "pending");
    assert.equal(state.requests.length, 1);
    // Nothing is swapped and no new account exists until an admin decides.
    assert.equal(state.accountCreates.length, 0);
    // The old account is flagged, not retired.
    assert.deepEqual(state.accountUpdates[0].data, { status: "change_requested" });
  } finally {
    restore();
  }
});

test("a tournament lock is not cleared by requesting a change", async () => {
  const { module: service, state, restore } = loadService({
    player: { id: "player-1", gameAccounts: [{ ...CURRENT, status: "locked" }] },
  });
  try {
    await service.requestAccountChange({
      userId: "user-1",
      riotId: "NewName#2222",
      reason: "account compromised",
    });
    // A player must not be able to unlock their committed roster identity by
    // filing paperwork.
    assert.equal(state.accountUpdates.length, 0);
    assert.equal(state.requests.length, 1);
  } finally {
    restore();
  }
});

test("a replacement requires an explanation", async () => {
  const { module: service, restore } = loadService();
  try {
    for (const reason of ["", "   ", null, undefined]) {
      await assert.rejects(
        () => service.requestAccountChange({ userId: "user-1", riotId: "NewName#2222", reason }),
        (error) => error.statusCode === 400,
      );
    }
  } finally {
    restore();
  }
});

test("a player cannot queue two open requests", async () => {
  const { module: service, restore } = loadService({ openRequest: { id: "existing" } });
  try {
    await assert.rejects(
      () =>
        service.requestAccountChange({
          userId: "user-1",
          riotId: "NewName#2222",
          reason: "another one",
        }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("a player with nothing linked has nothing to change", async () => {
  const { module: service, restore } = loadService({ player: null });
  try {
    await assert.rejects(
      () => service.requestAccountChange({ userId: "user-1", riotId: "NewName#2222", reason: "x" }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("a replacement onto someone else's account is refused", async () => {
  const { module: service, state, restore } = loadService({
    resolved: {
      externalId: "puuid-new",
      username: "NewName",
      tagline: "2222",
      region: "ap",
      linkedElsewhere: true,
    },
  });
  try {
    await assert.rejects(
      () => service.requestAccountChange({ userId: "user-1", riotId: "NewName#2222", reason: "x" }),
      (error) => error.statusCode === 409,
    );
    assert.equal(state.requests.length, 0);
  } finally {
    restore();
  }
});

const pendingRequest = (overrides = {}) => ({
  id: "request-1",
  playerId: "player-1",
  currentAccountId: "account-1",
  game: "valorant",
  requestedExternalId: "puuid-new",
  requestedUsername: "NewName",
  requestedTagline: "2222",
  requestedRegion: "ap",
  status: "pending",
  currentAccount: { ...CURRENT, status: "change_requested" },
  ...overrides,
});

test("approval retires the old account instead of deleting it", async () => {
  const { module: service, state, restore } = loadService({ request: pendingRequest() });
  try {
    const result = await service.reviewChangeRequest({
      requestId: "request-1",
      approve: true,
      adminUserId: "admin-1",
      adminNote: "verified support ticket",
    });

    // Registration snapshots and tournament history point at the old row.
    assert.ok(state.accountUpdates.some((update) => update.data.status === "replaced"));
    assert.equal(state.accountCreates.length, 1);
    // Only a human decision earns this state.
    assert.equal(state.accountCreates[0].verificationStatus, "admin_verified");
    assert.equal(state.accountCreates[0].externalId, "puuid-new");
    assert.equal(result.status, "approved");
  } finally {
    restore();
  }
});

test("rejection returns the account to service unchanged", async () => {
  const { module: service, state, restore } = loadService({ request: pendingRequest() });
  try {
    await service.reviewChangeRequest({
      requestId: "request-1",
      approve: false,
      adminUserId: "admin-1",
      adminNote: "could not verify the claim",
    });
    assert.equal(state.accountCreates.length, 0);
    assert.deepEqual(state.accountUpdates[0].data, { status: "active" });
  } finally {
    restore();
  }
});

test("a rejection the player cannot understand is not a decision", async () => {
  const { module: service, restore } = loadService({ request: pendingRequest() });
  try {
    await assert.rejects(
      () =>
        service.reviewChangeRequest({
          requestId: "request-1",
          approve: false,
          adminUserId: "admin-1",
          adminNote: "  ",
        }),
      (error) => error.statusCode === 400,
    );
  } finally {
    restore();
  }
});

test("a request cannot be reviewed twice", async () => {
  const { module: service, restore } = loadService({
    request: pendingRequest({ status: "approved" }),
  });
  try {
    await assert.rejects(
      () =>
        service.reviewChangeRequest({
          requestId: "request-1",
          approve: true,
          adminUserId: "admin-1",
          adminNote: "again",
        }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("both decisions are audited with old and new references", async () => {
  for (const approve of [true, false]) {
    const { module: service, state, restore } = loadService({ request: pendingRequest() });
    try {
      await service.reviewChangeRequest({
        requestId: "request-1",
        approve,
        adminUserId: "admin-1",
        adminNote: "reviewed",
      });
      const entry = state.audits.at(-1);
      assert.equal(
        entry.action,
        approve ? "game_account.change_approved" : "game_account.change_rejected",
      );
      assert.ok(entry.beforeData.externalIdFingerprint);
      assert.ok(entry.afterData.externalIdFingerprint);
      // The identifiers themselves stay out of exported audit data.
      assert.doesNotMatch(JSON.stringify(entry), /puuid-old|puuid-new/);
    } finally {
      restore();
    }
  }
});

test("the change-request migration enforces integrity in the database", () => {
  const statements = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(statements, /CREATE TABLE "game_account_change_requests"/);
  assert.match(statements, /ENABLE ROW LEVEL SECURITY/);

  // One open request per player per game, or an admin could approve two.
  assert.match(
    statements,
    /CREATE UNIQUE INDEX "game_account_change_requests_open_player_game_idx"[\s\S]*?WHERE status = 'pending'/,
  );
  // A reason is mandatory and the identifier is comparable.
  assert.match(statements, /CHECK \(length\(btrim\("reason"\)\) > 0\)/);
  assert.match(statements, /"requested_external_id" = lower\(btrim\("requested_external_id"\)\)/);

  // A decision record must outlive the rows it references.
  for (const fk of ["current_account_id", "requested_by_user_id", "reviewed_by_user_id"]) {
    assert.match(
      statements,
      new RegExp(`game_account_change_requests_${fk}_fkey[\\s\\S]*?ON DELETE SET NULL`),
    );
  }

  assert.doesNotMatch(statements, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
