const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const teamPath = path.join(__dirname, "../src/modules/teams/team.service.js");
const generatedPath = path.join(__dirname, "../src/generated/prisma/index.js");

const load = ({ prisma = {}, activatePaidTeamRegistration = async () => undefined } = {}) =>
  loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [uploadPath]: {
      bankTransferProofDirectory: "private-proofs",
      persistBankTransferProofUpload: async () => undefined,
      removeUploadFile: async () => undefined,
    },
    [teamPath]: { activatePaidTeamRegistration },
    [generatedPath]: {
      Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
    },
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
      tournament: { maxTeams: 10 },
    },
  };
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => ({ ...current, ...data }),
    },
    teamRegistration: {
      count: async () => 9,
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
    });
    assert.equal(result.status, "paid");
    assert.deepEqual(registrationUpdates[0], { paymentStatus: "paid", reservedUntil: null });
    assert.equal(activatedId, "registration-1");
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
    });
    assert.equal(result.status, "failed");
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
