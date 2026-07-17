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

test("createConfiguredRegistration updates registration details and roster on payment retry", async () => {
  const removedUploads = [];
  let registrationUpdate;
  let memberRows;
  const existing = {
    id: "registration-1",
    teamLogoName: "old-logo.png",
    paymentStatus: "pending",
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const tx = {
    tournament: { findUnique: async () => tournament },
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
    tournament: { findFirst: async () => tournament },
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
