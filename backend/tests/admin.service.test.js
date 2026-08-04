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

test("reserveAdminRegistrationSlot locks the lowest free slot and its bank-transfer fee", async () => {
  let createdHold;
  const tx = {
    teamRegistration: {
      findUnique: async () => ({
        id: "registration-1",
        tournamentId: "tournament-1",
        paymentStatus: "unpaid",
        status: "pending",
        members: [{ inviteStatus: "pending" }],
        adminSlotReservation: null,
        tournament: {
          id: "tournament-1",
          maxTeams: 10,
          paymentMethod: "bank_transfer",
          registrationFeeAmount: 5000,
          registrationFeeCurrency: "LKR",
          registrationFeeTiers: [
            { startSlot: 1, endSlot: 2, amount: 2000 },
            { startSlot: 3, endSlot: 10, amount: 3000 },
          ],
        },
      }),
      count: async ({ where }) => where.adminSlotReservation ? 0 : 2,
      findMany: async () => [{ assignedSlotNumber: 2 }],
    },
    adminSlotReservation: {
      count: async () => 1,
      findMany: async () => [{ assignedSlotNumber: 1 }],
      create: async ({ data }) => {
        createdHold = data;
        return { id: "hold-1", ...data };
      },
    },
  };
  const { module: adminService, restore } = loadAdminService({
    $transaction: async (work) => work(tx),
  });

  try {
    const hold = await adminService.reserveAdminRegistrationSlot({
      registrationId: "registration-1",
      adminUserId: "admin-1",
      body: { note: "Invited roster" },
    });
    assert.equal(hold.assignedSlotNumber, 3);
    assert.equal(hold.quotedFeeAmount, 3000);
    assert.equal(hold.quotedFeeCurrency, "LKR");
    assert.equal(createdHold.registrationId, "registration-1");
  } finally {
    restore();
  }
});

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
                privacyAcceptedAt: "2026-07-03T09:00:00.000Z",
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
    assert.equal(membersSheet.getRow(2).getCell(13).value, "2026-07-03T09:00:00.000Z");
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
  const savedTeam = {
      count: async () => 1,
      findMany: async (args) => {
        findManyCalls.push(args);
        return [
          {
            id: "saved-team-1",
            name: "Quest Five",
            teamTag: "Q5",
            logoName: "quest-five.png",
            country: "Sri Lanka",
            organizationName: null,
            updatedAt: new Date("2026-07-20T10:00:00.000Z"),
            captainUser: {
              firstName: "Team",
              lastName: "Captain",
              username: "captain",
            },
            _count: { members: 5 },
          },
        ];
      },
    };
  const { module: adminService, restore } = loadAdminService({
    savedTeam,
    $transaction: async (operations) => Promise.all(operations),
  });

  try {
    const result = await adminService.listAdminSavedTeams({ search: "Quest", page: "2", pageSize: "15" });

    assert.equal(findManyCalls[0].skip, 15);
    assert.equal(findManyCalls[0].take, 15);
    assert.equal(findManyCalls[0].where.OR[0].name.contains, "Quest");
    assert.ok(findManyCalls[0].where.OR.some((filter) => filter.members?.some));
    assert.deepEqual(result.items, [
      {
        id: "saved-team-1",
        name: "Quest Five",
        teamTag: "Q5",
        logoUrl: "/api/uploads/team-logos/quest-five.png",
        country: "Sri Lanka",
        organizationName: "Independent",
        captainName: "Team Captain",
        memberCount: 5,
        updatedAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    ]);
    assert.deepEqual(result.pagination, { page: 2, pageSize: 15, total: 1, totalPages: 1 });
  } finally {
    restore();
  }
});

test("getAdminSavedTeamById loads the roster only for the selected team", async () => {
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => ({
        id: "saved-team-1",
        name: "Quest Five",
        teamTag: "Q5",
        logoName: null,
        country: "Sri Lanka",
        organizationName: null,
        updatedAt: new Date("2026-07-20T10:00:00.000Z"),
        captainUser: { firstName: "Team", lastName: "Captain", username: "captain" },
        _count: { members: 1 },
        members: [
          { id: "member-1", role: "PLAYER", name: "Player One", email: "player@example.com", discord: "player", riotId: "Player#001", inviteStatus: "accepted" },
        ],
      }),
    },
  });

  try {
    const team = await adminService.getAdminSavedTeamById("saved-team-1");
    assert.equal(team.captainName, "Team Captain");
    assert.deepEqual(team.members, [
      { id: "member-1", role: "PLAYER", name: "Player One", email: "player@example.com", discord: "player", gameId: "Player#001", inviteStatus: "accepted" },
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

test("updateAdminSavedTeam replaces its logo across linked tournament registrations", async () => {
  const savedTeamUpdates = [];
  const registrationUpdates = [];
  const removedUploads = [];
  const team = {
    id: "saved-team-1",
    name: "Quest Five",
    teamTag: "Q5",
    logoName: "old-logo.png",
    country: "Sri Lanka",
    organizationName: null,
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    captainUser: { firstName: "Team", lastName: "Captain", username: "captain" },
    members: [
      { id: "member-1", role: "PLAYER", name: "Player One", email: "player@example.com", discord: null, riotId: null, inviteStatus: "accepted" },
    ],
    _count: { members: 1 },
  };
  let savedTeamLookupCount = 0;
  const tx = {
    savedTeam: {
      update: async (args) => savedTeamUpdates.push(args),
    },
    savedTeamMember: {
      update: async () => undefined,
    },
    teamRegistration: {
      findMany: async () => [{ id: "registration-1", tournamentId: "tournament-1", teamName: "Quest Five" }],
      updateMany: async (args) => registrationUpdates.push(args),
    },
    tournamentBracket: {
      findMany: async () => [],
    },
    tournament: {
      findMany: async () => [],
    },
  };
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => ({
        ...team,
        logoName: savedTeamLookupCount++ === 0 ? "old-logo.png" : "new-logo.webp",
      }),
      count: async () => 0,
    },
    teamRegistration: {
      count: async () => 0,
    },
    $transaction: async (work) => work(tx),
  }, {
    persistTeamLogoUpload: async () => ({ filename: "new-logo.webp" }),
    removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
  });

  try {
    const updated = await adminService.updateAdminSavedTeam(
      "saved-team-1",
      {
        name: "Quest Five",
        teamTag: "Q5",
        country: "Sri Lanka",
        organizationName: "Independent",
        members: JSON.stringify([{ id: "member-1", name: "Player One", email: "player@example.com", discord: "", gameId: "" }]),
      },
      { buffer: Buffer.from("logo") }
    );

    assert.equal(savedTeamUpdates[0].data.logoName, "new-logo.webp");
    assert.deepEqual(registrationUpdates, [{
      where: { savedTeamId: "saved-team-1" },
      data: { teamName: "Quest Five", teamLogoName: "new-logo.webp" },
    }]);
    assert.equal(updated.logoUrl, "/api/uploads/team-logos/new-logo.webp");
    assert.deepEqual(removedUploads, [{ directory: "uploads/team-logos", filename: "old-logo.png" }]);
  } finally {
    restore();
  }
});

test("updateAdminSavedTeam syncs a renamed team across registrations, brackets, and schedules", async () => {
  const savedTeamUpdates = [];
  const registrationUpdates = [];
  const bracketUpdates = [];
  const tournamentUpdates = [];
  const oldName = "OCG Valorant Academy";
  const newName = "Thrownumi";
  const team = {
    id: "saved-team-1",
    name: oldName,
    teamTag: "OCG",
    logoName: null,
    country: "Sri Lanka",
    organizationName: null,
    updatedAt: new Date("2026-07-20T10:00:00.000Z"),
    captainUser: { firstName: "Team", lastName: "Captain", username: "captain" },
    members: [
      { id: "member-1", role: "PLAYER", name: "Player One", email: "player@example.com", discord: null, riotId: null, inviteStatus: "accepted" },
    ],
    _count: { members: 1 },
  };
  let savedTeamLookupCount = 0;
  const tx = {
    savedTeam: {
      update: async (args) => savedTeamUpdates.push(args),
    },
    savedTeamMember: {
      update: async () => undefined,
    },
    teamRegistration: {
      findMany: async () => [{ id: "registration-1", tournamentId: "tournament-1", teamName: oldName }],
      updateMany: async (args) => registrationUpdates.push(args),
    },
    tournamentBracket: {
      findMany: async () => [{
        id: "bracket-1",
        seedData: [{ id: "registration-1", name: oldName, shortCode: "OVA" }],
        bracketData: {
          participant: [{ id: 0, registrationId: "registration-1", name: oldName, shortCode: "OVA" }],
          match: [],
        },
      }],
      update: async (args) => bracketUpdates.push(args),
    },
    tournament: {
      findMany: async () => [{
        id: "tournament-1",
        scheduleData: {
          headers: ["Team A", "Team B"],
          rows: [{ "Team A": oldName, "Team B": "Other Team" }],
        },
      }],
      update: async (args) => tournamentUpdates.push(args),
    },
  };
  const { module: adminService, restore } = loadAdminService({
    savedTeam: {
      findUnique: async () => ({
        ...team,
        name: savedTeamLookupCount++ === 0 ? oldName : newName,
      }),
    },
    $transaction: async (work) => work(tx),
  });

  try {
    const updated = await adminService.updateAdminSavedTeam("saved-team-1", {
      name: newName,
      teamTag: "THR",
      country: "Sri Lanka",
      organizationName: "Independent",
      members: JSON.stringify([{ id: "member-1", name: "Player One", email: "player@example.com", discord: "", gameId: "" }]),
    });

    assert.equal(savedTeamUpdates[0].data.name, newName);
    assert.deepEqual(registrationUpdates, [{
      where: { savedTeamId: "saved-team-1" },
      data: { teamName: newName },
    }]);
    assert.equal(bracketUpdates[0].data.seedData[0].name, newName);
    assert.equal(bracketUpdates[0].data.seedData[0].shortCode, "THRO");
    assert.equal(bracketUpdates[0].data.bracketData.participant[0].name, newName);
    assert.equal(tournamentUpdates[0].data.scheduleData.rows[0]["Team A"], newName);
    assert.equal(tournamentUpdates[0].data.scheduleData.rows[0]["Team B"], "Other Team");
    assert.equal(updated.name, newName);
  } finally {
    restore();
  }
});

test("transferAdminSavedTeamCaptain promotes an accepted member and removes the former captain everywhere", async () => {
  const savedMemberDeletes = [];
  const savedMemberUpdates = [];
  const savedTeamUpdates = [];
  const registrationMemberDeletes = [];
  const registrationMemberUpdates = [];
  const registrationUpdates = [];
  const sourceTeam = {
    id: "saved-team-1",
    name: "Quest Five",
    captainUserId: "captain-user",
    captainUser: {
      id: "captain-user",
      firstName: "Former",
      lastName: "Captain",
      username: "former-captain",
      email: "former@example.com",
      emailNormalized: "former@example.com",
    },
    members: [
      {
        id: "saved-captain",
        userId: "captain-user",
        role: "CAPTAIN",
        memberOrder: 0,
        name: "Former Captain",
        email: "former@example.com",
        emailNormalized: "former@example.com",
        discord: "former",
        riotId: "Former#001",
        inviteStatus: "accepted",
        user: null,
      },
      {
        id: "saved-player",
        userId: "player-user",
        role: "PLAYER",
        memberOrder: 1,
        name: "New Captain",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        discord: "new-discord",
        riotId: "New#002",
        inviteStatus: "accepted",
        user: {
          id: "player-user",
          email: "new@example.com",
          emailNormalized: "new@example.com",
          emailVerified: true,
          phone: "0771234567",
          discordTag: "new-profile",
        },
      },
    ],
    registrations: [
      {
        id: "registration-1",
        tournamentId: "tournament-1",
        captainEmail: "former@example.com",
        additionalData: {},
        tournament: {
          title: "Quest Cup",
          game: "Valorant",
          registrationFields: [],
        },
        members: [
          {
            id: "registration-captain",
            userId: "captain-user",
            role: "CAPTAIN",
            name: "Former Captain",
            email: "former@example.com",
            emailNormalized: "former@example.com",
            discord: "former",
            riotId: "Former#001",
            additionalData: {},
            inviteStatus: "accepted",
          },
          {
            id: "registration-player",
            userId: "player-user",
            role: "PLAYER",
            name: "New Captain",
            email: "new@example.com",
            emailNormalized: "new@example.com",
            discord: "new-discord",
            riotId: "New#002",
            additionalData: {},
            inviteStatus: "accepted",
          },
        ],
      },
    ],
  };
  const updatedTeam = {
    id: "saved-team-1",
    name: "Quest Five",
    teamTag: "Q5",
    logoName: null,
    country: "Sri Lanka",
    organizationName: null,
    updatedAt: new Date("2026-08-03T10:00:00.000Z"),
    captainUser: { firstName: "New", lastName: "Captain", username: "new-captain" },
    members: [
      { id: "saved-player", role: "CAPTAIN", name: "New Captain", email: "new@example.com", discord: "new-discord", riotId: "New#002", inviteStatus: "accepted" },
    ],
    _count: { members: 1 },
  };
  const tx = {
    savedTeam: {
      findUnique: async () => sourceTeam,
      findFirst: async () => null,
      update: async (args) => savedTeamUpdates.push(args),
    },
    savedTeamMember: {
      delete: async (args) => savedMemberDeletes.push(args),
      update: async (args) => savedMemberUpdates.push(args),
    },
    teamRegistration: {
      findFirst: async () => null,
      update: async (args) => registrationUpdates.push(args),
    },
    registrationMember: {
      delete: async (args) => registrationMemberDeletes.push(args),
      update: async (args) => registrationMemberUpdates.push(args),
    },
  };
  const { module: adminService, restore } = loadAdminService({
    savedTeam: { findUnique: async () => updatedTeam },
    $transaction: async (work) => work(tx),
  });

  try {
    const result = await adminService.transferAdminSavedTeamCaptain({
      teamId: "saved-team-1",
      memberId: "saved-player",
    });

    assert.deepEqual(savedMemberDeletes, [{ where: { id: "saved-captain" } }]);
    assert.equal(savedMemberUpdates[0].data.role, "CAPTAIN");
    assert.equal(savedMemberUpdates[0].data.memberOrder, 0);
    assert.deepEqual(savedTeamUpdates, [{ where: { id: "saved-team-1" }, data: { captainUserId: "player-user" } }]);
    assert.deepEqual(registrationMemberDeletes, [{ where: { id: "registration-captain" } }]);
    assert.equal(registrationMemberUpdates[0].data.role, "CAPTAIN");
    assert.equal(registrationUpdates[0].data.userId, "player-user");
    assert.equal(registrationUpdates[0].data.captainEmail, "new@example.com");
    assert.equal(registrationUpdates[0].data.captainPhone, "0771234567");
    assert.equal(result.team.captainName, "New Captain");
    assert.deepEqual(result.transfer.registrationIds, ["registration-1"]);
  } finally {
    restore();
  }
});

test("transferAdminSavedTeamCaptain requires a phone before transferring linked registrations", async () => {
  const sourceTeam = {
    id: "saved-team-1",
    name: "Quest Five",
    captainUserId: "captain-user",
    captainUser: {
      id: "captain-user",
      firstName: "Former",
      lastName: "Captain",
      username: "former-captain",
      email: "former@example.com",
      emailNormalized: "former@example.com",
    },
    members: [
      { id: "saved-captain", userId: "captain-user", role: "CAPTAIN", memberOrder: 0, name: "Former Captain", email: "former@example.com", emailNormalized: "former@example.com", discord: "former", riotId: "Former#001", inviteStatus: "accepted", user: null },
      {
        id: "saved-player",
        userId: "player-user",
        role: "PLAYER",
        memberOrder: 1,
        name: "New Captain",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        discord: "new-discord",
        riotId: "New#002",
        inviteStatus: "accepted",
        user: { id: "player-user", email: "new@example.com", emailNormalized: "new@example.com", emailVerified: true, phone: null, discordTag: "new-profile" },
      },
    ],
    registrations: [{ id: "registration-1" }],
  };
  const { module: adminService, restore } = loadAdminService({
    $transaction: async (work) => work({ savedTeam: { findUnique: async () => sourceTeam } }),
  });

  try {
    await assert.rejects(
      adminService.transferAdminSavedTeamCaptain({ teamId: "saved-team-1", memberId: "saved-player" }),
      (error) => error.statusCode === 409 && /phone number/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("listTeamRegistrations returns paginated summaries without loading rosters", async () => {
  const findManyCalls = [];
  const prisma = {
    teamRegistration: {
      count: async () => 1,
      findMany: async (args) => {
        findManyCalls.push(args);
        return [{
          id: "registration-1",
          entryType: "team",
          teamName: "Quest Five",
          status: "pending",
          paymentStatus: "unpaid",
          verificationStatus: "pending",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          captainName: "Team Captain",
          captainEmail: "captain@example.com",
          tournament: { id: "tournament-1", slug: "quest-cup", title: "Quest Cup", status: "registration_open", isPublished: true },
          _count: { members: 5 },
        }];
      },
    },
    tournament: { findMany: async () => [] },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: adminService, restore } = loadAdminService(prisma);
  try {
    const result = await adminService.listTeamRegistrations({ page: "1", pageSize: "10" });
    assert.equal(findManyCalls[0].select.members, undefined);
    assert.equal(result.items[0].memberCount, 5);
    assert.equal(result.items[0].captain.email, "captain@example.com");
    assert.equal(result.items[0].members, undefined);
  } finally {
    restore();
  }
});

test("getAdminTeamRegistrationById loads the selected registration roster", async () => {
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findUnique: async () => ({
        id: "registration-1",
        entryType: "team",
        teamName: "Quest Five",
        additionalData: {},
        reservedUntil: null,
        country: "Sri Lanka",
        teamTag: "Q5",
        organizationRequested: false,
        status: "pending",
        paymentStatus: "unpaid",
        verificationStatus: "pending",
        adminSlotReservation: null,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        contactEmail: "captain@example.com",
        teamLogoName: null,
        tournament: { id: "tournament-1", slug: "quest-cup", title: "Quest Cup", status: "registration_open", isPublished: true },
        captainName: "Team Captain",
        captainEmail: "captain@example.com",
        captainPhone: "0770000000",
        captainDiscord: "captain",
        captainRiotId: "Captain#001",
        members: [{
          id: "member-1", role: "CAPTAIN", memberOrder: 0, name: "Team Captain", email: "captain@example.com",
          discord: "captain", riotId: "Captain#001", additionalData: {}, inviteStatus: "accepted", inviteRespondedAt: new Date(), user: null,
        }],
      }),
    },
  });
  try {
    const result = await adminService.getAdminTeamRegistrationById("registration-1");
    assert.equal(result.members.length, 1);
    assert.equal(result.members[0].name, "Team Captain");
  } finally {
    restore();
  }
});

test("updateTeamRegistrationGameIds updates the captain and every selected roster member", async () => {
  const registrationUpdates = [];
  const memberUpdates = [];
  let lookupCount = 0;
  const detail = {
    id: "registration-1",
    entryType: "team",
    teamName: "Quest Five",
    additionalData: {},
    reservedUntil: null,
    country: "Sri Lanka",
    teamTag: "Q5",
    organizationRequested: false,
    status: "pending",
    paymentStatus: "unpaid",
    verificationStatus: "pending",
    adminSlotReservation: null,
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    contactEmail: "captain@example.com",
    teamLogoName: null,
    tournament: { id: "tournament-1", slug: "quest-cup", title: "Quest Cup", status: "registration_open", isPublished: true },
    captainName: "Team Captain",
    captainEmail: "captain@example.com",
    captainPhone: "0770000000",
    captainDiscord: "captain",
    captainRiotId: "Captain#002",
    members: [
      { id: "captain-1", role: "CAPTAIN", memberOrder: 0, name: "Team Captain", email: "captain@example.com", discord: "captain", riotId: "Captain#002", additionalData: {}, inviteStatus: "accepted", inviteRespondedAt: new Date(), user: null },
      { id: "member-1", role: "PLAYER", memberOrder: 1, name: "Player One", email: "player@example.com", discord: null, riotId: "Player#002", additionalData: {}, inviteStatus: "accepted", inviteRespondedAt: new Date(), user: null },
    ],
  };
  const tx = {
    teamRegistration: { update: async (args) => registrationUpdates.push(args) },
    registrationMember: { update: async (args) => memberUpdates.push(args) },
  };
  const { module: adminService, restore } = loadAdminService({
    teamRegistration: {
      findUnique: async () => lookupCount++ === 0
        ? {
            id: "registration-1",
            additionalData: { valorant_id: "Captain#001" },
            tournament: { game: "Valorant", registrationFields: [
              { key: "valorant_id", label: "Valorant ID", scope: "entry" },
              { key: "riot_id", label: "Riot ID", scope: "member" },
            ] },
            members: detail.members.map(({ id, role }) => ({ id, role, additionalData: { riot_id: "Old#001" } })),
          }
        : detail,
    },
    $transaction: async (work) => work(tx),
  });

  try {
    const result = await adminService.updateTeamRegistrationGameIds("registration-1", {
      captainGameId: "Captain#002",
      members: [
        { id: "captain-1", gameId: "Ignored#000" },
        { id: "member-1", gameId: "Player#002" },
      ],
    });

    assert.deepEqual(registrationUpdates, [{
      where: { id: "registration-1" },
      data: { captainRiotId: "Captain#002", additionalData: { valorant_id: "Captain#002" } },
    }]);
    assert.deepEqual(memberUpdates, [
      { where: { id: "captain-1" }, data: { riotId: "Captain#002", additionalData: { riot_id: "Captain#002" } } },
      { where: { id: "member-1" }, data: { riotId: "Player#002", additionalData: { riot_id: "Player#002" } } },
    ]);
    assert.equal(result.captain.riotId, "Captain#002");
  } finally {
    restore();
  }
});
