const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/tournaments/auto-approval.service.js"
);
const auditModulePath = path.join(__dirname, "../src/lib/audit.js");
const snapshotModulePath = path.join(
  __dirname,
  "../src/modules/game-accounts/roster-snapshot.service.js"
);

const buildRegistration = (overrides = {}) => ({
  id: "registration-1",
  status: "pending",
  entryType: "team",
  paymentStatus: "paid",
  verificationStatus: "verified",
  tournament: { game: "valorant", autoApproveRegistrations: true, ...overrides.tournament },
  ...overrides,
});

const loadService = () => {
  const audits = [];
  const snapshots = [];
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [auditModulePath]: {
      recordAuditInTransaction: async (_tx, data) => {
        audits.push(data);
        return data;
      },
    },
    [snapshotModulePath]: {
      snapshotAndLockRoster: async (args) => {
        snapshots.push(args);
        return { snapshotted: 0, locked: 0 };
      },
    },
  });

  return { service, restore, audits, snapshots };
};

const buildTx = (registration) => {
  const updates = [];
  return {
    updates,
    tx: {
      teamRegistration: {
        findUnique: async () => registration,
        update: async (args) => {
          updates.push(args);
          return { ...registration, ...args.data };
        },
      },
    },
  };
};

test("a ready registration is approved, snapshotted, and audited without an actor", async () => {
  const { service, restore, audits, snapshots } = loadService();
  const { tx, updates } = buildTx(buildRegistration());

  try {
    const approved = await service.maybeAutoApproveRegistration({
      tx,
      registrationId: "registration-1",
      requestId: "request-1",
      ipAddress: "203.0.113.10",
    });

    assert.equal(approved.status, "approved");
    assert.deepEqual(updates[0].data, { status: "approved" });
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].registrationId, "registration-1");
    assert.equal(snapshots[0].actorUserId, null);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, null);
    assert.equal(audits[0].source, "system");
    assert.equal(audits[0].action, "team_registration.status_changed");
    assert.deepEqual(audits[0].afterData, { status: "approved" });
  } finally {
    restore();
  }
});

test("automatic approval waits for the fee, the roster, and the tournament's own setting", async () => {
  const cases = [
    ["the tournament reviews registrations", { tournament: { game: "valorant", autoApproveRegistrations: false } }],
    ["the fee is not settled", { paymentStatus: "pending" }],
    ["a roster invitation is outstanding", { verificationStatus: "pending" }],
    ["a roster invitation was declined", { verificationStatus: "flagged" }],
    ["the registration is waitlisted", { status: "waitlisted" }],
    ["an admin already rejected it", { status: "rejected" }],
  ];

  for (const [reason, overrides] of cases) {
    const { service, restore, audits, snapshots } = loadService();
    const { tx, updates } = buildTx(buildRegistration(overrides));

    try {
      const result = await service.maybeAutoApproveRegistration({
        tx,
        registrationId: "registration-1",
      });

      assert.equal(result, null, reason);
      assert.equal(updates.length, 0, reason);
      assert.equal(snapshots.length, 0, reason);
      assert.equal(audits.length, 0, reason);
    } finally {
      restore();
    }
  }
});

test("a solo registration is approved without a verified roster", async () => {
  const { service, restore } = loadService();
  const { tx, updates } = buildTx(
    buildRegistration({ entryType: "solo", verificationStatus: "pending" })
  );

  try {
    const approved = await service.maybeAutoApproveRegistration({
      tx,
      registrationId: "registration-1",
    });

    assert.equal(approved.status, "approved");
    assert.equal(updates.length, 1);
  } finally {
    restore();
  }
});

test("a transaction scope that cannot read registrations leaves the caller's write alone", async () => {
  const { service, restore, audits } = loadService();

  try {
    const result = await service.maybeAutoApproveRegistration({
      tx: { teamRegistration: { update: async () => undefined } },
      registrationId: "registration-1",
    });

    assert.equal(result, null);
    assert.equal(audits.length, 0);
  } finally {
    restore();
  }
});
