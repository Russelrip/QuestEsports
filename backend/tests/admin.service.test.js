const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ExcelJS = require("exceljs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/admin/admin.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const authServiceModulePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const legacyImportModulePath = path.join(__dirname, "../src/modules/media/legacy-import.service.js");
const mediaServiceModulePath = path.join(__dirname, "../src/modules/media/media.service.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");

const loadAdminService = (prisma, uploadMock = {}) =>
  loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [authServiceModulePath]: {
      mapUserForResponse: (user) => user,
      validateUserBasics: () => ({}),
    },
    [legacyImportModulePath]: {
      importLegacyPosters: async () => ({}),
    },
    [mediaServiceModulePath]: {
      migrateImageAssetsToFilesystem: async () => ({}),
    },
    [uploadModulePath]: {
      removeUploadFiles: async () => undefined,
      bankTransferProofDirectory: "private/bank-transfer-proofs",
      teamLogoDirectory: "uploads/team-logos",
      ...uploadMock,
    },
    [loggerModulePath]: {
      logger: {
        warn: () => {},
      },
    },
  });

const loadWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
};

test("exportTeamRegistrations creates an Excel workbook with registration and roster sheets", async () => {
  const findManyCalls = [];
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findMany: async (args) => {
        findManyCalls.push(args);
        return [
          {
            id: "registration-1",
            teamName: "Quest Five",
            status: "approved",
            paymentStatus: "paid",
            verificationStatus: "verified",
            createdAt: new Date("2026-07-01T10:00:00.000Z"),
            contactEmail: "contact@example.com",
            teamLogoName: "quest-five.png",
            tournament: {
              id: "tournament-1",
              slug: "quest-cup",
              title: "Quest Cup",
              status: "registration_open",
              isPublished: true,
            },
            captainName: "Team Captain",
            captainEmail: "captain@example.com",
            captainPhone: "0770000000",
            captainDiscord: "captain",
            captainRiotId: "Captain#001",
            members: [
              {
                id: "member-1",
                role: "CAPTAIN",
                memberOrder: 1,
                name: "Team Captain",
                email: "captain@example.com",
                discord: "captain",
                riotId: "Captain#001",
                inviteStatus: "accepted",
                inviteRespondedAt: new Date("2026-07-01T11:00:00.000Z"),
                user: {
                  id: "user-1",
                  username: "captain",
                  email: "captain@example.com",
                },
              },
              {
                id: "member-2",
                role: "PLAYER",
                memberOrder: 1,
                name: "Player Two",
                email: "player2@example.com",
                discord: "player2",
                riotId: "Player2#001",
                inviteStatus: "pending",
                inviteRespondedAt: null,
                user: null,
              },
            ],
          },
        ];
      },
    },
  });

  try {
    const exportFile = await adminService.exportTeamRegistrations({
      tournament: "quest-cup",
      status: "approved",
    });
    const workbook = await loadWorkbook(exportFile.buffer);
    const registrationsSheet = workbook.getWorksheet("Registrations");
    const rosterSheet = workbook.getWorksheet("Roster Members");

    assert.equal(exportFile.contentType.includes("spreadsheetml.sheet"), true);
    assert.match(exportFile.filename, /^team-registrations-\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.equal(findManyCalls[0].where.status, "approved");
    assert.equal(findManyCalls[0].take, 5001);
    assert.equal(registrationsSheet.getRow(2).getCell(1).value, "Quest Cup");
    assert.equal(registrationsSheet.getRow(2).getCell(3).value, "Quest Five");
    assert.equal(registrationsSheet.getRow(2).getCell(17).value, 1);
    assert.equal(rosterSheet.getRow(2).getCell(7).value, "Team Captain");
    assert.equal(rosterSheet.getRow(3).getCell(11).value, "pending");
  } finally {
    restore();
  }
});

test("exportRecruitmentApplications creates an Excel workbook with solo and team applications", async () => {
  const findManyCalls = [];
  const { module: adminService, restore } = loadAdminService({
    recruitmentApplication: {
      findMany: async (args) => {
        findManyCalls.push(args);
        return [
          {
            id: "application-1",
            applicationType: "solo_player",
            fullName: "Solo Player",
            email: "solo@example.com",
            phone: "0771111111",
            discord: "solo",
            game: "valorant",
            playerId: "Solo#001",
            applicantIdNumberCiphertext: null,
            teamName: null,
            currentRosterSize: null,
            members: [],
            details: {
              ign: "Solo",
              canAttendLan: true,
              declarationAccepted: true,
            },
            notes: "Available for tryouts.",
            womensLeagueInterest: false,
            status: "pending",
            createdAt: new Date("2026-07-02T10:00:00.000Z"),
            updatedAt: new Date("2026-07-02T10:00:00.000Z"),
          },
          {
            id: "application-2",
            applicationType: "existing_team",
            fullName: "Team Manager",
            email: "manager@example.com",
            phone: "0772222222",
            discord: "manager",
            game: "valorant",
            playerId: null,
            applicantIdNumberCiphertext: null,
            teamName: "Quest Academy",
            currentRosterSize: 5,
            members: [
              {
                name: "Academy Player",
                email: "academy@example.com",
                discord: "academy",
                playerId: "Academy#001",
                ign: "Academy",
                phone: "0773333333",
                role: "duelist",
              },
            ],
            details: {},
            notes: null,
            womensLeagueInterest: true,
            status: "reviewed",
            createdAt: new Date("2026-07-03T10:00:00.000Z"),
            updatedAt: new Date("2026-07-03T11:00:00.000Z"),
          },
        ];
      },
    },
  });

  try {
    const exportFile = await adminService.exportRecruitmentApplications({
      applicationType: "solo_player",
    });
    const workbook = await loadWorkbook(exportFile.buffer);
    const applicationsSheet = workbook.getWorksheet("Applications");
    const membersSheet = workbook.getWorksheet("Team Members");

    assert.equal(exportFile.contentType.includes("spreadsheetml.sheet"), true);
    assert.match(exportFile.filename, /^recruitment-applications-\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.equal(findManyCalls[0].where.applicationType, "solo_player");
    assert.equal(findManyCalls[0].take, 5001);
    assert.equal(applicationsSheet.getRow(2).getCell(2).value, "solo_player");
    assert.equal(applicationsSheet.getRow(2).getCell(4).value, "Solo Player");
    assert.equal(applicationsSheet.getRow(3).getCell(11).value, "Quest Academy");
    assert.equal(membersSheet.getRow(2).getCell(5).value, "Academy Player");
  } finally {
    restore();
  }
});

test("deleteTeamRegistration removes a tournament registration by id", async () => {
  const deleteCalls = [];
  const removedUploads = [];
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findUnique: async (args) => {
        assert.deepEqual(args, {
          where: { id: "registration-1" },
          select: {
            teamLogoName: true,
            payments: {
              select: {
                bankTransferProof: {
                  select: { storedFilename: true },
                },
              },
            },
          },
        });
        return {
          teamLogoName: "quest-five.png",
          payments: [
            { bankTransferProof: { storedFilename: "receipt.webp" } },
          ],
        };
      },
      deleteMany: async (args) => {
        deleteCalls.push(args);
        return { count: 1 };
      },
      count: async () => 0,
    },
    savedTeam: {
      count: async () => 0,
    },
  }, {
    removeUploadFiles: async (uploads) => {
      removedUploads.push(...uploads);
    },
  });

  try {
    await adminService.deleteTeamRegistration("registration-1");

    assert.deepEqual(deleteCalls, [{ where: { id: "registration-1" } }]);
    assert.deepEqual(removedUploads, [
      {
        directory: "private/bank-transfer-proofs",
        filename: "receipt.webp",
      },
      {
        directory: "uploads/team-logos",
        filename: "quest-five.png",
      },
    ]);
  } finally {
    restore();
  }
});

test("deleteTeamRegistration reports missing registrations", async () => {
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findUnique: async () => null,
      deleteMany: async () => ({ count: 0 }),
    },
  });

  try {
    await assert.rejects(
      adminService.deleteTeamRegistration("missing-registration"),
      (error) =>
        error.statusCode === 404 &&
        error.message === "Team registration not found."
    );
  } finally {
    restore();
  }
});

test("deleteTeamRegistration preserves a logo referenced by a saved team", async () => {
  const removedUploads = [];
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findUnique: async () => ({
        teamLogoName: "shared-logo.png",
        payments: [{ bankTransferProof: { storedFilename: "receipt.webp" } }],
      }),
      deleteMany: async () => ({ count: 1 }),
      count: async () => 0,
    },
    savedTeam: {
      count: async ({ where }) => {
        assert.deepEqual(where, { logoName: "shared-logo.png" });
        return 1;
      },
    },
  }, {
    removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
  });

  try {
    await adminService.deleteTeamRegistration("registration-1");
    assert.deepEqual(removedUploads, [
      { directory: "private/bank-transfer-proofs", filename: "receipt.webp" },
    ]);
  } finally {
    restore();
  }
});

test("exportTeamRegistrations rejects oversized exports before building workbooks", async () => {
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findMany: async () => Array.from({ length: 5001 }, () => ({})),
    },
  });

  try {
    await assert.rejects(
      adminService.exportTeamRegistrations(),
      (error) =>
        error.statusCode === 413 &&
        error.message.includes("Team registration export is limited")
    );
  } finally {
    restore();
  }
});

test("exportRecruitmentApplications rejects oversized exports before building workbooks", async () => {
  const { module: adminService, restore } = loadAdminService({
    recruitmentApplication: {
      findMany: async () => Array.from({ length: 5001 }, () => ({})),
    },
  });

  try {
    await assert.rejects(
      adminService.exportRecruitmentApplications(),
      (error) =>
        error.statusCode === 413 &&
        error.message.includes("Recruitment application export is limited")
    );
  } finally {
    restore();
  }
});

test("deleteRecruitmentApplication removes a recruitment application by id", async () => {
  const deleteCalls = [];
  const { module: adminService, restore } = loadAdminService({
    recruitmentApplication: {
      deleteMany: async (args) => {
        deleteCalls.push(args);
        return { count: 1 };
      },
    },
  });

  try {
    await adminService.deleteRecruitmentApplication("application-1");

    assert.deepEqual(deleteCalls, [{ where: { id: "application-1" } }]);
  } finally {
    restore();
  }
});

test("deleteRecruitmentApplication reports missing applications", async () => {
  const { module: adminService, restore } = loadAdminService({
    recruitmentApplication: {
      deleteMany: async () => ({ count: 0 }),
    },
  });

  try {
    await assert.rejects(
      adminService.deleteRecruitmentApplication("missing-application"),
      (error) =>
        error.statusCode === 404 &&
        error.message === "Recruitment application not found."
    );
  } finally {
    restore();
  }
});

test("deleteAdminSavedTeam removes the saved team and an unreferenced logo", async () => {
  const deleteCalls = [];
  const removedUploads = [];
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => ({ id: "saved-team-1", logoName: "quest-five.png" }),
      deleteMany: async (args) => {
        deleteCalls.push(args);
        return { count: 1 };
      },
      count: async () => 0,
    },
    teamRegistration: {
      count: async () => 0,
    },
  }, {
    removeUploadFiles: async (uploads) => {
      removedUploads.push(...uploads);
    },
  });

  try {
    await adminService.deleteAdminSavedTeam("saved-team-1");

    assert.deepEqual(deleteCalls, [{ where: { id: "saved-team-1" } }]);
    assert.deepEqual(removedUploads, [
      { directory: "uploads/team-logos", filename: "quest-five.png" },
    ]);
  } finally {
    restore();
  }
});

test("deleteAdminSavedTeam preserves logos used by tournament registrations", async () => {
  const removedUploads = [];
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => ({ id: "saved-team-1", logoName: "quest-five.png" }),
      deleteMany: async () => ({ count: 1 }),
      count: async () => 0,
    },
    teamRegistration: {
      count: async (args) => {
        assert.deepEqual(args, { where: { teamLogoName: "quest-five.png" } });
        return 1;
      },
    },
  }, {
    removeUploadFiles: async (uploads) => {
      removedUploads.push(...uploads);
    },
  });

  try {
    await adminService.deleteAdminSavedTeam("saved-team-1");
    assert.deepEqual(removedUploads, []);
  } finally {
    restore();
  }
});

test("deleteAdminSavedTeam reports missing saved teams", async () => {
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => null,
    },
  });

  try {
    await assert.rejects(
      adminService.deleteAdminSavedTeam("missing-team"),
      (error) => error.statusCode === 404 && error.message === "Team not found."
    );
  } finally {
    restore();
  }
});

test("listAdminSavedTeams maps saved teams for the admin team manager", async () => {
  const findManyCalls = [];
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findMany: async (args) => {
        findManyCalls.push(args);
        return [
          {
            id: "saved-team-1",
            name: "Quest Five",
            logoName: "quest-five.png",
            country: "Sri Lanka",
            organizationName: null,
            captainUser: {
              firstName: "Team",
              lastName: "Captain",
              username: "captain",
            },
            _count: { members: 5 },
          },
        ];
      },
    },
  });

  try {
    const teams = await adminService.listAdminSavedTeams({ search: "Quest" });

    assert.deepEqual(findManyCalls[0].where, {
      OR: [
        { name: { contains: "Quest", mode: "insensitive" } },
        { organizationName: { contains: "Quest", mode: "insensitive" } },
      ],
    });
    assert.deepEqual(teams, [
      {
        id: "saved-team-1",
        name: "Quest Five",
        logoUrl: "/api/uploads/team-logos/quest-five.png",
        country: "Sri Lanka",
        organizationName: "Independent",
        captainName: "Team Captain",
        memberCount: 5,
      },
    ]);
  } finally {
    restore();
  }
});

test("updateAdminSavedTeamOrganization stores a verified organization label", async () => {
  const updateCalls = [];
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      updateMany: async (args) => {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  });

  try {
    const team = await adminService.updateAdminSavedTeamOrganization(
      "saved-team-1",
      { organizationName: "Quest Esports" }
    );

    assert.deepEqual(updateCalls, [
      {
        where: { id: "saved-team-1" },
        data: { organizationName: "Quest Esports" },
      },
    ]);
    assert.deepEqual(team, { organizationName: "Quest Esports" });
  } finally {
    restore();
  }
});
