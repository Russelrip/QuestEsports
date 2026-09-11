const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/roster-snapshot.service.js",
);
const readinessPath = path.join(
  __dirname,
  "../src/modules/game-accounts/registration-readiness.service.js",
);
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const migration = fs.readFileSync(
  path.join(__dirname, "../prisma/migrations/20260823140000_add_roster_identity_snapshots/migration.sql"),
  "utf8",
);
const adminService = fs.readFileSync(
  path.join(__dirname, "../src/modules/admin/admin.service.js"),
  "utf8",
);

const ACCOUNT = {
  id: "account-1",
  game: "valorant",
  externalId: "puuid-abc",
  username: "Russel",
  tagline: "1234",
  verificationStatus: "user_confirmed",
  status: "active",
};

const loadService = ({ members = [] } = {}) => {
  const state = { memberUpdates: [], accountUpdates: [], audits: [] };
  const tx = {
    registrationMember: {
      findMany: async () => members,
      update: async (args) => {
        state.memberUpdates.push(args);
        return args;
      },
    },
    gameAccount: {
      update: async (args) => {
        state.accountUpdates.push(args);
        return args;
      },
    },
  };
  const loaded = loadModuleWithMocks(servicePath, {
    [readinessPath]: {
      trackedGameFor: (game) =>
        String(game || "").trim().toLowerCase() === "valorant" ? "valorant" : null,
    },
    [auditPath]: {
      recordAuditInTransaction: async (_db, entry) => {
        state.audits.push(entry);
        return entry;
      },
    },
    [loggerPath]: { logger: { info() {}, warn() {}, error() {} } },
  });
  return { ...loaded, state, tx };
};

const rosterMember = (overrides = {}) => ({
  id: "member-1",
  playerId: "player-1",
  snapshotAt: null,
  player: { gameAccounts: [{ ...ACCOUNT }] },
  ...overrides,
});

test("approval records what was actually committed to the tournament", async () => {
  const { module: service, state, tx, restore } = loadService({ members: [rosterMember()] });
  try {
    const result = await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "VALORANT",
      actorUserId: "admin-1",
    });

    assert.equal(result.snapshotted, 1);
    const [update] = state.memberUpdates;
    // The stable identifier is what makes the record survive a rename.
    assert.equal(update.data.externalIdSnapshot, "puuid-abc");
    assert.equal(update.data.usernameSnapshot, "Russel");
    assert.equal(update.data.tagSnapshot, "1234");
    assert.equal(update.data.verificationStatusSnapshot, "user_confirmed");
    assert.equal(update.data.gameAccountId, "account-1");
    assert.ok(update.data.snapshotAt instanceof Date);
  } finally {
    restore();
  }
});

test("the committed account is locked", async () => {
  const { module: service, state, tx, restore } = loadService({ members: [rosterMember()] });
  try {
    await service.snapshotAndLockRoster({ tx, registrationId: "reg-1", tournamentGame: "valorant" });
    assert.equal(state.accountUpdates.length, 1);
    assert.deepEqual(state.accountUpdates[0].data, { status: "locked" });
  } finally {
    restore();
  }
});

test("re-approving never rewrites an existing snapshot", async () => {
  const alreadySnapshotted = rosterMember({ snapshotAt: new Date("2026-01-01") });
  const { module: service, state, tx, restore } = loadService({ members: [alreadySnapshotted] });
  try {
    const result = await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "valorant",
    });
    // The first commitment is the one that counts. A genuine change goes
    // through the admin account-change process, not through re-approval.
    assert.equal(result.snapshotted, 0);
    assert.equal(state.memberUpdates.length, 0);
    assert.equal(state.accountUpdates.length, 0);
  } finally {
    restore();
  }
});

test("an already-locked account is not locked twice", async () => {
  const member = rosterMember({
    player: { gameAccounts: [{ ...ACCOUNT, status: "locked" }] },
  });
  const { module: service, state, tx, restore } = loadService({ members: [member] });
  try {
    const result = await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "valorant",
    });
    // A player on two rosters is already committed; the snapshot still records
    // the account, but there is nothing further to lock.
    assert.equal(result.snapshotted, 1);
    assert.equal(result.locked, 0);
    assert.equal(state.accountUpdates.length, 0);
  } finally {
    restore();
  }
});

test("a member with no linked account is skipped, not failed", async () => {
  const member = rosterMember({ player: { gameAccounts: [] } });
  const { module: service, state, tx, restore } = loadService({ members: [member] });
  try {
    const result = await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "valorant",
    });
    // Approval must remain possible for legacy and partially linked rosters.
    assert.equal(result.snapshotted, 0);
    assert.equal(state.memberUpdates.length, 0);
  } finally {
    restore();
  }
});

test("a tournament with no game adapter snapshots nothing", async () => {
  const { module: service, state, tx, restore } = loadService({ members: [rosterMember()] });
  try {
    const result = await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "Call of Duty Mobile",
    });
    assert.equal(result.skipped, "no_adapter");
    assert.equal(state.memberUpdates.length, 0);
  } finally {
    restore();
  }
});

test("locking a roster is auditable", async () => {
  const { module: service, state, tx, restore } = loadService({ members: [rosterMember()] });
  try {
    await service.snapshotAndLockRoster({
      tx,
      registrationId: "reg-1",
      tournamentGame: "valorant",
      actorUserId: "admin-1",
      requestId: "req-1",
    });
    const [entry] = state.audits;
    assert.equal(entry.action, "registration.roster_locked");
    assert.equal(entry.targetId, "reg-1");
    assert.equal(entry.actorUserId, "admin-1");
    // The identifier itself does not belong in exported audit data.
    assert.doesNotMatch(JSON.stringify(entry), /puuid-abc/);
  } finally {
    restore();
  }
});

test("no audit noise when nothing was committed", async () => {
  const member = rosterMember({ player: { gameAccounts: [] } });
  const { module: service, state, tx, restore } = loadService({ members: [member] });
  try {
    await service.snapshotAndLockRoster({ tx, registrationId: "reg-1", tournamentGame: "valorant" });
    assert.equal(state.audits.length, 0);
  } finally {
    restore();
  }
});

test("ordinary roster edits cannot touch the competitive snapshot", async () => {
  const { module: service, restore } = loadService();
  try {
    // A profile edit or roster edit reaching these columns would let a rename
    // or account swap silently rewrite competitive history.
    assert.throws(
      () => service.assertNoSnapshotWrite({ name: "New Name", externalIdSnapshot: "puuid-x" }),
      /competitive snapshot columns/,
    );
    assert.throws(
      () => service.assertNoSnapshotWrite({ snapshotAt: new Date() }),
      /snapshotAt/,
    );
    // Ordinary fields pass through untouched.
    const payload = { name: "New Name", phone: "123" };
    assert.deepEqual(service.assertNoSnapshotWrite(payload), payload);
  } finally {
    restore();
  }
});

test("every approval path snapshots inside its own transaction", () => {
  // There are three places a registration becomes approved. A path that
  // approves without snapshotting produces a tournament record with no account
  // history, which is precisely the failure this work prevents.
  const approvals = adminService.match(/acceptPendingRegistrationInvites\(\{/g) || [];
  const snapshots = adminService.match(/snapshotAndLockRoster\(\{/g) || [];
  assert.equal(approvals.length, 3, "expected three approval paths");
  assert.equal(snapshots.length, 3, "every approval path must snapshot");

  // And it must be the transaction's own client, not a fresh connection.
  for (const call of adminService.match(/snapshotAndLockRoster\(\{[\s\S]*?\}\);/g) || []) {
    assert.match(call, /\btx,/);
  }
});

test("the snapshot migration preserves history and never cascades", () => {
  const statements = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  for (const column of [
    "game_account_id",
    "external_id_snapshot",
    "username_snapshot",
    "tag_snapshot",
    "verification_status_snapshot",
    "snapshot_at",
  ]) {
    assert.match(statements, new RegExp(`ADD COLUMN "${column}"`));
  }

  assert.doesNotMatch(statements, /DROP COLUMN|DROP TABLE|TRUNCATE/i);
  assert.doesNotMatch(statements, /^\s*(UPDATE|INSERT)\s+/im);
  // Deleting a game account must not delete the evidence of what a team
  // registered with; the text snapshot survives the reference deliberately.
  assert.match(statements, /registration_members_game_account_id_fkey[\s\S]*?ON DELETE SET NULL/);
  assert.doesNotMatch(statements, /game_account_id_fkey[\s\S]*?ON DELETE CASCADE/);
});
