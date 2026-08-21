const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const teamPath = path.join(__dirname, "../src/modules/teams/team.service.js");
const generatedPath = path.join(__dirname, "../src/generated/prisma/index.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const uploadCleanupPath = path.join(__dirname, "../src/lib/upload-cleanup.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const auditContext = {
  actorUserId: "admin-1",
  requestId: "request-1",
  ipAddress: "198.51.100.7",
};
const bankAudit = (decision, reasonCode) => ({
  ...auditContext,
  action: "payment.bank_transfer.reviewed",
  decision,
  reasonCode,
});

const load = ({
  prisma = {},
  activatePaidTeamRegistration = async () => undefined,
  persistBankTransferProofUpload = async () => undefined,
  removeUploadFile = async () => undefined,
  additionalMocks = {},
} = {}) =>
  loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [uploadPath]: {
      bankTransferProofDirectory: "private-proofs",
      persistBankTransferProofUpload,
      removeUploadFile,
    },
    [uploadCleanupPath]: {
      removeUploadsQuietly: async (uploads) => {
        try {
          for (const upload of uploads) await removeUploadFile(upload);
          return true;
        } catch {
          return false;
        }
      },
    },
    [teamPath]: { activatePaidTeamRegistration },
    [generatedPath]: {
      Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
    },
    [loggerPath]: { logger: { error: () => undefined } },
    [auditPath]: { recordAuditInTransaction: async (tx, data) => tx.auditLog?.create ? tx.auditLog.create({ data }) : undefined },
    ...additionalMocks,
  });

test("bank-transfer fee tiers quote the exact assigned slot price", () => {
  const { module: service, restore } = load();
  try {
    const tournament = {
      registrationFeeAmount: 2000,
      registrationFeeTiers: [
        { startSlot: 1, endSlot: 3, amount: 2000 },
        { startSlot: 4, endSlot: 6, amount: 2500 },
        { startSlot: 7, endSlot: 9, amount: 3000 },
        { startSlot: 10, endSlot: 10, amount: 3500 },
      ],
    };
    assert.equal(service.getBankTransferAmountForSlot(tournament, 1), 2000);
    assert.equal(service.getBankTransferAmountForSlot(tournament, 6), 2500);
    assert.equal(service.getBankTransferAmountForSlot(tournament, 9), 3000);
    assert.equal(service.getBankTransferAmountForSlot(tournament, 10), 3500);
  } finally {
    restore();
  }
});

test("ticket bank-transfer instructions use the LAN event bank account", () => {
  const { module: service, restore } = load();
  try {
    const expiresAt = new Date(Date.now() + 60_000);
    const instructions = service.buildBankTransferInstructions({
      transaction: {
        providerOrderId: "TICKET-BANK-1",
        amount: 1600,
        currency: "LKR",
        status: "pending",
        bankTransferProof: null,
      },
      ticketOrder: { expiresAt },
      ticketEvent: {
        bankName: "Quest Bank",
        bankBranch: "Colombo",
        bankAccountName: "Quest E-sports",
        bankAccountNumber: "123456789",
      },
    });
    assert.equal(instructions.assignedSlotNumber, null);
    assert.equal(instructions.expiresAt, expiresAt);
    assert.equal(instructions.bankAccount.accountNumber, "123456789");
  } finally {
    restore();
  }
});

test("admin approval confirms a reserved bank transfer and activates the team", async () => {
  const registrationUpdates = [];
  let activatedId = null;
  const current = {
    id: "payment-1",
    provider: "bank_transfer",
    status: "review_required",
    registrationId: "registration-1",
    bankTransferProof: { id: "proof-1" },
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      reservedUntil: new Date(Date.now() + 60_000),
      members: [{ role: "PLAYER", email: "player@example.com", riotId: "Player#001" }],
      tournament: { maxTeams: 10 },
    },
  };
  let findUniqueArgs;
  const tx = {
    paymentTransaction: {
      findUnique: async (args) => {
        findUniqueArgs = args;
        return current;
      },
      update: async ({ data }) => ({ ...current, ...data }),
    },
    teamRegistration: {
      count: async () => 9,
      findMany: async () => [],
      update: async ({ data }) => { registrationUpdates.push(data); },
    },
    bankTransferProof: { update: async () => undefined },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load({
    prisma,
    activatePaidTeamRegistration: async (id) => { activatedId = id; },
  });
  try {
    const result = await service.reviewBankTransfer({
      transactionId: current.id,
      decision: "approve",
      admin: { id: "admin-1" },
      audit: bankAudit("approve", "approved"),
    });
    assert.equal(result.status, "paid");
    assert.equal(result.__tournamentProjectionChanged, true);
    assert.deepEqual(registrationUpdates[0], { paymentStatus: "paid", reservedUntil: null });
    assert.equal(activatedId, "registration-1");
    assert.equal(findUniqueArgs.include.registration.include.members, true);
  } finally {
    restore();
  }
});

test("bank-transfer approval rejects an active same-tournament coach/player conflict", async () => {
  const current = {
    id: "payment-conflict",
    provider: "bank_transfer",
    status: "review_required",
    registrationId: "registration-1",
    bankTransferProof: { id: "proof-1" },
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      reservedUntil: new Date(Date.now() + 60_000),
      members: [{ role: "PLAYER", email: "player@example.com", riotId: "Player#001" }],
      tournament: { maxTeams: 10 },
    },
  };
  const queryCalls = [];
  const tx = {
    paymentTransaction: { findUnique: async () => current },
    teamRegistration: {
      findMany: async (args) => {
        queryCalls.push(args);
        return [{ members: [{ role: "COACH", email: "coach@example.com", riotId: "Player#001" }] }];
      },
    },
  };
  const { module: service, restore } = load({
    prisma: { $transaction: async (callback) => callback(tx) },
  });
  try {
    await assert.rejects(
      service.reviewBankTransfer({
        transactionId: current.id,
        decision: "approve",
        admin: { id: "admin-1" },
        audit: bankAudit("approve", "approved"),
      }),
      (error) => error.statusCode === 409 && /both a coach and a player/.test(error.message)
    );
    assert.equal(queryCalls[0].where.tournamentId, "tournament-1");
    assert.equal(queryCalls[0].where.id.not, "registration-1");
  } finally {
    restore();
  }
});

test("admin rejection records a reason and releases the assigned slot", async () => {
  let registrationUpdate = null;
  let proofUpdate = null;
  const current = {
    id: "payment-2",
    provider: "bank_transfer",
    status: "review_required",
    registrationId: "registration-2",
    bankTransferProof: { id: "proof-2" },
    registration: {
      id: "registration-2",
      tournamentId: "tournament-1",
      reservedUntil: new Date(Date.now() + 60_000),
      tournament: { maxTeams: 10 },
    },
  };
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => ({ ...current, ...data }),
    },
    teamRegistration: {
      update: async ({ data }) => { registrationUpdate = data; },
    },
    bankTransferProof: {
      update: async ({ data }) => { proofUpdate = data; },
    },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load({ prisma });
  try {
    const result = await service.reviewBankTransfer({
      transactionId: current.id,
      decision: "reject",
      reason: "Reference was not found in the bank account.",
      admin: { id: "admin-1" },
      audit: bankAudit("reject", "rejected"),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.__tournamentProjectionChanged, true);
    assert.deepEqual(registrationUpdate, {
      paymentStatus: "unpaid",
      reservedUntil: null,
      assignedSlotNumber: null,
    });
    assert.equal(proofUpdate.rejectionReason, "Reference was not found in the bank account.");
  } finally {
    restore();
  }
});

test("invalid bank-transfer decisions retain 400 validation without state or audit mutation", async () => {
  let transactionCalls = 0;
  let auditCalls = 0;
  const { module: service, restore } = load({
    prisma: {
      $transaction: async () => {
        transactionCalls += 1;
      },
    },
    additionalMocks: {
      [auditPath]: {
        recordAuditInTransaction: async () => {
          auditCalls += 1;
        },
      },
    },
  });
  try {
    await assert.rejects(
      service.reviewBankTransfer({
        transactionId: "invalid-bank-decision",
        decision: "approve-without-review",
        admin: { id: "admin-1" },
        audit: bankAudit("approve-without-review", "approved"),
      }),
      (error) => error.statusCode === 400 && /Choose approve or reject/.test(error.message),
    );
    assert.equal(transactionCalls, 0);
    assert.equal(auditCalls, 0);
  } finally {
    restore();
  }
});

test("bank-transfer review rolls back local writes when its transaction-scoped audit fails", async () => {
  const current = {
    id: "payment-audit-atomic",
    provider: "bank_transfer",
    status: "review_required",
    registrationId: "registration-1",
    bankTransferProof: { id: "proof-1" },
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      reservedUntil: new Date(Date.now() + 60_000),
      members: [],
      tournament: { maxTeams: 10 },
    },
  };
  let paymentUpdates = 0;
  let rolledBack = false;
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => { paymentUpdates += 1; return { ...current, ...data }; },
    },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      update: async () => undefined,
    },
    bankTransferProof: { update: async () => undefined },
  };
  const prisma = {
    $transaction: async (callback) => {
      try { return await callback(tx); } catch (error) { rolledBack = true; throw error; }
    },
  };
  const { module: service, restore } = load({
    prisma,
    additionalMocks: { [auditPath]: { recordAuditInTransaction: async () => { throw new Error("audit unavailable"); } } },
  });
  try {
    await assert.rejects(service.reviewBankTransfer({
      transactionId: current.id,
      decision: "approve",
      reason: "secret buyer@example.test provider-ref signature-secret",
      admin: { id: "admin-1" },
      audit: {
        actorUserId: "admin-1",
        requestId: "request-1",
        ipAddress: "198.51.100.7",
        action: "payment.bank_transfer.reviewed",
        decision: "approve",
        reasonCode: "approved",
      },
    }), /audit unavailable/);
    assert.equal(paymentUpdates, 1);
    assert.equal(rolledBack, true);
  } finally {
    restore();
  }
});

test("already-paid bank review is an idempotent no-op without a misleading audit", async () => {
  const current = {
    id: "payment-already-paid",
    provider: "bank_transfer",
    status: "paid",
    registrationId: "registration-paid",
    bankTransferProof: { id: "proof-paid" },
    registration: { id: "registration-paid" },
  };
  const auditCalls = [];
  const { module: service, restore } = load({
    prisma: { $transaction: async (callback) => callback({ paymentTransaction: { findUnique: async () => current } }) },
    additionalMocks: { [auditPath]: { recordAuditInTransaction: async (_tx, data) => auditCalls.push(data) } },
  });
  try {
    const approved = await service.reviewBankTransfer({
      transactionId: current.id,
      decision: "approve",
      admin: { id: "admin-1" },
      audit: bankAudit("approve", "approved"),
    });
    const rejected = await service.reviewBankTransfer({
      transactionId: current.id,
      decision: "reject",
      admin: { id: "admin-1" },
      audit: bankAudit("reject", "rejected"),
    });
    assert.equal(approved.status, "paid");
    assert.equal(rejected.status, "paid");
    assert.equal(auditCalls.length, 0);
  } finally {
    restore();
  }
});

test("proof upload cannot revert a payment approved during file persistence", async () => {
  const removed = [];
  const initial = {
    id: "payment-race",
    provider: "bank_transfer",
    status: "review_required",
    registrationId: "registration-race",
    registration: {
      id: "registration-race",
      userId: "user-1",
      verificationStatus: "verified",
      reservedUntil: new Date(Date.now() + 60_000),
      tournament: { bankTransferReviewMinutes: 30 },
    },
    bankTransferProof: null,
  };
  const approved = { ...initial, status: "paid" };
  const prisma = {
    paymentTransaction: { findUnique: async () => initial },
    $transaction: async (callback) => callback({
      paymentTransaction: { findUnique: async () => approved },
    }),
  };
  const { module: service, restore } = load({
    prisma,
    persistBankTransferProofUpload: async () => ({
      filename: "new.webp",
      originalFilename: "receipt.png",
      contentType: "image/webp",
      byteSize: 10,
      sha256: "proof-hash",
    }),
    removeUploadFile: async (upload) => removed.push(upload),
  });
  try {
    await assert.rejects(
      service.submitBankTransferProof({
        providerOrderId: "BANK-race",
        user: { id: "user-1" },
        file: { buffer: Buffer.from("receipt") },
      }),
      (error) => error.statusCode === 409 && /already been approved/.test(error.message)
    );
    assert.deepEqual(removed, [{ directory: "private-proofs", filename: "new.webp" }]);
  } finally {
    restore();
  }
});

test("database duplicate-proof conflicts return a safe conflict and remove the new file", async () => {
  const initial = {
    id: "payment-duplicate",
    provider: "bank_transfer",
    status: "pending",
    registrationId: "registration-duplicate",
    registration: {
      id: "registration-duplicate",
      userId: "user-1",
      verificationStatus: "verified",
      reservedUntil: new Date(Date.now() + 60_000),
      tournament: { bankTransferReviewMinutes: 30 },
    },
    bankTransferProof: null,
  };
  let removed = false;
  const prisma = {
    paymentTransaction: { findUnique: async () => initial },
    $transaction: async () => {
      const error = new Error("unique constraint");
      error.code = "P2002";
      throw error;
    },
  };
  const { module: service, restore } = load({
    prisma,
    persistBankTransferProofUpload: async () => ({ filename: "duplicate.webp" }),
    removeUploadFile: async () => { removed = true; },
  });
  try {
    await assert.rejects(
      service.submitBankTransferProof({
        providerOrderId: "BANK-duplicate",
        user: { id: "user-1" },
        file: { buffer: Buffer.from("receipt") },
      }),
      (error) => error.statusCode === 409 && /already been used/.test(error.message)
    );
    assert.equal(removed, true);
  } finally {
    restore();
  }
});

test("retained proof cleanup keeps the database record when file deletion fails", async () => {
  let databaseDeletes = 0;
  const prisma = {
    bankTransferProof: {
      findMany: async () => [{ id: "proof-1", storedFilename: "receipt.webp" }],
      deleteMany: async () => {
        databaseDeletes += 1;
        return { count: 1 };
      },
    },
  };
  const { module: service, restore } = load({
    prisma,
    removeUploadFile: async () => {
      throw new Error("storage unavailable");
    },
  });
  try {
    const deleted = await service.cleanupRetainedBankTransferProofs({
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    assert.equal(deleted, 0);
    assert.equal(databaseDeletes, 0);
  } finally {
    restore();
  }
});
