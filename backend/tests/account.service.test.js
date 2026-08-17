const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/account/account.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const authServicePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const uploadCleanupPath = path.join(__dirname, "../src/lib/upload-cleanup.js");

test("account dashboard keeps recruitment application status visible", async () => {
  const application = {
    id: "application-1",
    applicationType: "solo_player",
    game: "Valorant",
    teamName: null,
    status: "pending",
    createdAt: new Date("2026-07-17T10:00:00.000Z"),
    updatedAt: new Date("2026-07-17T10:00:00.000Z"),
  };
  const prisma = {
    teamRegistration: { findMany: async () => [] },
    merchandiseOrder: { findMany: async () => [] },
    recruitmentApplication: { findMany: async () => [application] },
  };
  const { module: accountService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: { listProfileTeams: async () => [] },
    [authServicePath]: { mapUserForResponse: (user) => user, PUBLIC_USER_SELECT: {} },
    [uploadCleanupPath]: { removeUploadsQuietly: async () => undefined },
  });

  try {
    const dashboard = await accountService.getAccountDashboard({ user: { id: "user-1" } });
    assert.deepEqual(dashboard.recruitmentApplications, [application]);
    assert.deepEqual(dashboard.currentRegistrations, []);
    assert.deepEqual(dashboard.orders, []);
  } finally {
    restore();
  }
});

test("account dashboard includes nullable event context for each child registration", async () => {
  const registration = {
    id: "registration-1",
    entryType: "team",
    teamName: "Quest Five",
    status: "approved",
    paymentStatus: "paid",
    verificationStatus: "verified",
    createdAt: new Date("2026-08-17T10:00:00.000Z"),
    reservedUntil: null,
    tournament: {
      id: "tournament-1",
      slug: "valorant-cup",
      title: "Valorant Cup",
      game: "Valorant",
      status: "registration_open",
      startDate: null,
      startDateStatus: "tba",
      endDate: null,
      endDateStatus: "tba",
      bannerImageName: null,
      series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension" },
    },
    payments: [],
  };
  const prisma = {
    teamRegistration: { findMany: async () => [registration] },
    merchandiseOrder: { findMany: async () => [] },
    recruitmentApplication: { findMany: async () => [] },
  };
  const { module: accountService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: { listProfileTeams: async () => [] },
    [authServicePath]: { mapUserForResponse: (user) => user, PUBLIC_USER_SELECT: {} },
    [uploadCleanupPath]: { removeUploadsQuietly: async () => undefined },
  });

  try {
    const dashboard = await accountService.getAccountDashboard({ user: { id: "user-1" } });
    assert.deepEqual(dashboard.currentRegistrations[0].event, registration.tournament.series);
  } finally {
    restore();
  }
});
