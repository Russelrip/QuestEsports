const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/registration.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const paymentServicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bankTransferServicePath = path.join(
  __dirname,
  "../src/modules/payments/bank-transfer.service.js"
);

const tournament = {
  id: "tournament-1",
  slug: "quest-cup",
  title: "Quest Cup",
  isPublished: true,
  status: "registration_open",
  registrationOpenAt: null,
  registrationDeadline: null,
  registrationFeeAmount: 2500,
  registrationFeeCurrency: "LKR",
  paymentMethod: "payhere",
  reservationMinutes: 15,
  maxTeams: 16,
  entryType: "team",
  minRosterSize: 1,
  maxRosterSize: 5,
  maxSubstitutes: 2,
  registrationFields: [],
  updatedAt: new Date("2026-07-17T00:00:00.000Z"),
};

const user = {
  id: "user-1",
  firstName: "Quest",
  lastName: "Captain",
  email: "captain@example.com",
  phone: "0770000000",
};

const body = {
  teamName: "Updated Quest",
  teamTag: "UQ",
  country: "Sri Lanka",
  captainName: "Updated Captain",
  captainPhone: "0771111111",
  captainDiscord: "updated-captain",
  captainRiotId: "Captain#002",
  contactEmail: "contact@example.com",
  rulebookAccepted: true,
  falsityWarningAccepted: true,
  members: JSON.stringify([]),
};

test("bank-transfer references are short and banking-app friendly", () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: {},
    [bankTransferServicePath]: {},
  });

  try {
    const reference = service.buildPaymentOrderId("bank_transfer");
    assert.match(reference, /^QST-[A-F0-9]{10}$/);
    assert.equal(reference.length, 14);
  } finally {
    restore();
  }
});

test("paid direct team registration saves the team and dispatches player invites immediately", async () => {
  const syncedTeams = [];
  let createdRegistration;
  let createdMembers;
  let registrationTransactionActive = false;
  let tournamentLookupAttempts = 0;
  const valorantTournament = { ...tournament, game: "Valorant" };
  const tx = {
    tournament: { findUnique: async () => valorantTournament },
    teamRegistration: {
      count: async () => 0,
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistration = data;
        return { ...data, id: data.id };
      },
    },
    registrationMember: {
      createMany: async ({ data }) => {
        createdMembers = data;
        return { count: data.length };
      },
    },
    paymentTransaction: {
      create: async ({ data }) => ({ ...data, status: "created" }),
    },
  };
  const prisma = {
    tournament: {
      findFirst: async () => {
        tournamentLookupAttempts += 1;
        if (tournamentLookupAttempts === 1) {
          const error = new Error("Timed out while acquiring a connection.");
          error.code = "P2024";
          throw error;
        }
        return valorantTournament;
      },
    },
    teamRegistration: { findFirst: async () => null },
    $transaction: async (work) => {
      registrationTransactionActive = true;
      try {
        return await work(tx);
      } finally {
        registrationTransactionActive = false;
      }
    },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async (registrationId) => {
        assert.equal(registrationTransactionActive, false);
        syncedTeams.push(registrationId);
      },
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: valorantTournament.slug,
      body: {
        ...body,
        members: JSON.stringify([{
          name: "Player Two",
          email: "player@example.com",
          gameId: "PlayerTwo#456",
          role: "PLAYER",
        }]),
      },
      user,
    });

    assert.equal(createdRegistration.paymentStatus, "unpaid");
    assert.equal(result.awaitingTeamVerification, true);
    assert.equal(result.checkout, null);
    assert.equal(result.paymentOrderId, null);
    assert.equal(createdRegistration.captainRiotId, "Captain#002");
    assert.equal(createdMembers[1].riotId, "PlayerTwo#456");
    assert.equal(syncedTeams.length, 1);
    assert.equal(syncedTeams[0], createdRegistration.id);
    assert.equal(tournamentLookupAttempts, 2);
  } finally {
    restore();
  }
});

test("verified direct-registration roster can start payment without re-entering the team", async () => {
  let registrationPaymentUpdate;
  let createdPayment;
  let consumedHoldId;
  const verifiedRegistration = {
    id: "registration-verified",
    entryType: "team",
    teamName: "Updated Quest",
    status: "pending",
    paymentStatus: "unpaid",
    verificationStatus: "verified",
    captainPhone: "0771111111",
    country: "Sri Lanka",
    reservedUntil: null,
    members: [{ inviteStatus: "accepted" }, { inviteStatus: "accepted" }],
    payments: [],
  };
  const tx = {
    tournament: { findUnique: async () => tournament },
    teamRegistration: {
      findUnique: async () => verifiedRegistration,
      count: async () => 0,
      findFirst: async () => null,
      update: async ({ data }) => {
        registrationPaymentUpdate = data;
        return { ...verifiedRegistration, ...data };
      },
    },
    paymentTransaction: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        createdPayment = data;
        return { ...data, status: "created" };
      },
    },
    adminSlotReservation: {
      findUnique: async () => ({
        id: "hold-1",
        assignedSlotNumber: 4,
        quotedFeeAmount: 1750,
        quotedFeeCurrency: "LKR",
      }),
      delete: async ({ where }) => {
        consumedHoldId = where.id;
      },
    },
  };
  const prisma = {
    tournament: { findFirst: async () => tournament },
    teamRegistration: { findFirst: async () => verifiedRegistration },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: tournament.slug,
      body: { resumePayment: true },
      user,
    });

    assert.equal(registrationPaymentUpdate.paymentStatus, "pending");
    assert.equal(registrationPaymentUpdate.assignedSlotNumber, 4);
    assert.equal(registrationPaymentUpdate.quotedFeeAmount, 1750);
    assert.equal(createdPayment.amount, 1750);
    assert.equal(consumedHoldId, "hold-1");
    assert.ok(registrationPaymentUpdate.reservedUntil instanceof Date);
    assert.match(result.paymentOrderId, /^TOUR-/);
    assert.equal(result.checkout.orderId, result.paymentOrderId);
  } finally {
    restore();
  }
});

test("createConfiguredRegistration lets an active payment reservation retry after registration closes", async () => {
  const removedUploads = [];
  let registrationUpdate;
  let memberRows;
  const retryTournament = { ...tournament, status: "upcoming" };
  const existing = {
    id: "registration-1",
    teamLogoName: "old-logo.png",
    paymentStatus: "pending",
    verificationStatus: "verified",
    members: [{ inviteStatus: "accepted" }],
    reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const tx = {
    tournament: { findUnique: async () => retryTournament },
    teamRegistration: {
      findUnique: async () => existing,
      count: async () => 0,
      findFirst: async () => null,
      update: async ({ data }) => {
        registrationUpdate = data;
        return { ...existing, ...data, entryType: "team" };
      },
    },
    registrationMember: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async ({ data }) => {
        memberRows = data;
        return { count: data.length };
      },
    },
    paymentTransaction: {
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }) => ({ ...data, status: "created" }),
    },
  };
  const prisma = {
    tournament: { findFirst: async () => retryTournament },
    teamRegistration: {
      findFirst: async () => existing,
      count: async () => 0,
    },
    savedTeam: { count: async () => 0 },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      removeUploadFile: async ({ filename }) => removedUploads.push(filename),
      removeUploadFiles: async (uploads) => {
        removedUploads.push(...uploads.map((upload) => upload.filename));
      },
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: retryTournament.slug,
      body,
      file: { originalname: "new-logo.png" },
      user,
    });

    assert.equal(registrationUpdate.teamName, "Updated Quest");
    assert.equal(registrationUpdate.captainName, "Updated Captain");
    assert.equal(registrationUpdate.teamLogoName, "new-logo.png");
    assert.equal(registrationUpdate.status, "pending");
    assert.equal(registrationUpdate.verificationStatus, "pending");
    assert.equal(memberRows.length, 1);
    assert.equal(memberRows[0].role, "CAPTAIN");
    assert.equal(memberRows[0].name, "Updated Captain");
    assert.deepEqual(removedUploads, ["old-logo.png"]);
    assert.match(result.paymentOrderId, /^TOUR-/);
  } finally {
    restore();
  }
});

test("createConfiguredRegistration removes a newly persisted retry logo when the transaction fails", async () => {
  const removedUploads = [];
  const existing = {
    id: "registration-1",
    teamLogoName: "old-logo.png",
    paymentStatus: "pending",
    verificationStatus: "verified",
    members: [{ inviteStatus: "accepted" }],
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const prisma = {
    tournament: { findFirst: async () => tournament },
    teamRegistration: { findFirst: async () => existing },
    $transaction: async () => {
      throw new Error("database unavailable");
    },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      removeUploadFile: async ({ filename }) => removedUploads.push(filename),
      removeUploadFiles: async (uploads) => {
        removedUploads.push(...uploads.map((upload) => upload.filename));
      },
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: () => ({}),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    await assert.rejects(
      registrationService.createConfiguredRegistration({
        slug: tournament.slug,
        body,
        file: { originalname: "new-logo.png" },
        user,
      }),
      /database unavailable/
    );
    assert.deepEqual(removedUploads, ["new-logo.png"]);
  } finally {
    restore();
  }
});
