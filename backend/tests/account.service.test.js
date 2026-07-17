const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/account/account.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");

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
