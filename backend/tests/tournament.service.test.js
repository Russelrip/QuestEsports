const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServiceModulePath = path.join(__dirname, "../src/modules/teams/team.service.js");

const buildAdminTournamentBody = (overrides = {}) => ({
  title: "Quest Date Cup",
  slug: "quest-date-cup",
  game: "valorant",
  shortDescription: "Short description",
  fullDescription: "Full description",
  format: "Single elimination",
  teamSize: "5",
  maxTeams: "16",
  prizePool: "LKR 50,000",
  status: "draft",
  startDate: "2026-08-01T10:00:00.000Z",
  endDate: "2026-08-02T10:00:00.000Z",
  registrationDeadline: "2026-07-30T10:00:00.000Z",
  ...overrides,
});

test("Challonge URLs are restricted and normalized for safe module embeds", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    assert.equal(
      tournamentService.normalizeChallongeUrl("https://challonge.com/quest-cup?ref=site#matches"),
      "https://challonge.com/quest-cup"
    );
    assert.equal(
      tournamentService.buildChallongeEmbedUrl("https://quest.challonge.com/finals/module"),
      "https://quest.challonge.com/finals/module"
    );
    assert.equal(tournamentService.normalizeChallongeUrl("http://challonge.com/quest-cup"), null);
    assert.equal(tournamentService.normalizeChallongeUrl("https://challonge.com.evil.test/quest-cup"), null);
    assert.equal(tournamentService.normalizeChallongeUrl("https://challonge.com"), null);
  } finally {
    restore();
  }
});

test("registration status includes the payment route needed to resume a bank transfer", async () => {
  let repairedRegistrationId = null;
  const prisma = {
    tournament: {
      findUnique: async () => ({ id: "tournament-1", registrationFeeAmount: 2500 }),
    },
    teamRegistration: {
      findFirst: async () => ({
        id: "registration-1",
        status: "pending",
        paymentStatus: "pending",
        verificationStatus: "verified",
        members: [{ inviteStatus: "accepted" }],
        reservedUntil: new Date("2026-08-01T10:00:00.000Z"),
        assignedSlotNumber: 7,
        payments: [{
          providerOrderId: "QST-0123456789",
          provider: "bank_transfer",
          status: "pending",
        }],
      }),
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {
      ensureTeamRegistrationSaved: async (registrationId) => {
        repairedRegistrationId = registrationId;
      },
    },
  });

  try {
    const result = await tournamentService.getTournamentRegistrationStatus({
      slug: "quest-cup",
      user: { id: "user-1", email: "captain@example.com" },
    });
    assert.equal(result.isRegistered, true);
    assert.equal(result.registration.assignedSlotNumber, 7);
    assert.equal(repairedRegistrationId, "registration-1");
    assert.deepEqual(result.registration.payment, {
      orderId: "QST-0123456789",
      provider: "bank_transfer",
      status: "pending",
    });
  } finally {
    restore();
  }
});

test("admin tournaments can store optional descriptions and TBA/TBD dates", async () => {
  let savedData;
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        create: async ({ data }) => {
          savedData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const tournament = await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({
        shortDescription: "",
        fullDescription: "",
        startDateStatus: "tba",
        endDateStatus: "tbd",
        registrationDeadlineStatus: "tba",
      }),
      files: {},
    });

    assert.equal(savedData.startDate, null);
    assert.equal(savedData.endDate, null);
    assert.equal(savedData.registrationDeadline, null);
    assert.equal(savedData.shortDescription, "");
    assert.equal(savedData.fullDescription, "");
    assert.equal(tournament.startDateStatus, "tba");
    assert.equal(tournament.endDateStatus, "tbd");
    assert.equal(tournament.registrationDeadlineStatus, "tba");
  } finally {
    restore();
  }
});

test("admin tournaments can save an editable schedule without a spreadsheet", async () => {
  let savedData;
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        create: async ({ data }) => {
          savedData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({
        scheduleData: JSON.stringify({
          sheetName: "Quest Cup Schedule",
          headers: ["Date", "Match", "Team A", "Team B", "Time", "Format"],
          rows: [
            {
              Date: "2026-08-01",
              Match: "1",
              "Team A": "Alpha",
              "Team B": "Bravo",
              Time: "09:00 AM",
              Format: "Bo1",
            },
          ],
        }),
      }),
      files: {},
    });

    assert.equal(savedData.scheduleData.sheetName, "Quest Cup Schedule");
    assert.equal(savedData.scheduleData.rows[0]["Team A"], "Alpha");
    assert.equal(savedData.scheduleData.headers.length, 6);
  } finally {
    restore();
  }
});

test("editable schedule columns must be unique", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await assert.rejects(
      tournamentService.createAdminTournament({
        body: buildAdminTournamentBody({
          scheduleData: JSON.stringify({
            sheetName: "Invalid",
            headers: ["Team", "team"],
            rows: [],
          }),
        }),
        files: {},
      }),
      /column names must be unique/
    );
  } finally {
    restore();
  }
});

test("scheduled tournament dates still require valid values", async () => {
  const prismaMock = {
    prisma: {
      tournament: { findFirst: async () => null },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await assert.rejects(
      tournamentService.createAdminTournament({
        body: buildAdminTournamentBody({ startDate: "" }),
        files: {},
      }),
      /Start date is required/
    );
  } finally {
    restore();
  }
});

test("getPublicTournamentBySlug exposes approved public team card data", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => ({
          id: "tournament-1",
          slug: "quest-cup",
          title: "Quest Cup",
          game: "valorant",
          displayPriority: 100,
          bannerImageName: "banner.jpg",
          shortDescription: "Short",
          fullDescription: "Full",
          rules: "Rules",
          startDate: new Date("2026-06-01T00:00:00.000Z"),
          endDate: new Date("2026-06-02T00:00:00.000Z"),
          registrationDeadline: new Date("2026-05-30T00:00:00.000Z"),
          format: "Single elimination",
          teamSize: 5,
          maxTeams: 16,
          prizePool: "LKR 100,000",
          status: "completed",
          isPublished: true,
          bracketLink: null,
          contactLink: null,
          isFeatured: false,
          scheduleData: null,
          completedPosterImageName: null,
          firstPlaceImageName: null,
          secondPlaceImageName: null,
          thirdPlaceImageName: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z"),
          _count: {
            teamRegistrations: 1,
          },
          teamRegistrations: [
            {
              id: "registration-1",
              teamName: "Quest Five",
              captainName: "Captain Quest",
              teamLogoName: "private-logo.png",
              status: "approved",
              members: [{ id: "member-1" }, { id: "member-2" }, { id: "member-3" }],
            },
          ],
        }),
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup");

    assert.deepEqual(tournament.registeredTeams, [
      {
        id: "registration-1",
        teamName: "Quest Five",
        logoUrl: "/api/uploads/team-logos/private-logo.png",
        shortCode: "QF",
        memberCount: 3,
        status: "approved",
        captainName: "Captain Quest",
      },
    ]);
    assert.equal(tournament.bracketSummary, null);
    assert.equal(tournament.bracketData, null);
  } finally {
    restore();
  }
});

test("future registrationOpenAt keeps an otherwise open tournament closed", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findMany: async () => [
          {
            id: "tournament-1",
            slug: "future-cup",
            title: "Future Cup",
            game: "valorant",
            displayPriority: 100,
            shortDescription: "Short",
            fullDescription: "Full",
            rules: "Rules",
            registrationOpenAt: new Date(Date.now() + 60_000),
            startDate: new Date(Date.now() + 3600_000),
            endDate: new Date(Date.now() + 7200_000),
            registrationDeadline: new Date(Date.now() + 1800_000),
            format: "Single elimination",
            registrationMode: "open_entry",
            teamSize: 5,
            maxTeams: 16,
            prizePool: "LKR 100,000",
            status: "registration_open",
            isPublished: true,
            isFeatured: false,
            _count: {
              teamRegistrations: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const [tournament] = await tournamentService.listPublicTournaments();

    assert.equal(tournament.registrationState, "registration_closed");
    assert.equal(tournament.isRegistrationOpen, false);
    assert.equal(tournament.isRegistrationClosed, true);
  } finally {
    restore();
  }
});

test("a TBA registration deadline does not close an otherwise open tournament", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findMany: async () => [
          {
            id: "tournament-tba",
            slug: "tba-cup",
            title: "TBA Cup",
            game: "valorant",
            displayPriority: 100,
            shortDescription: "Short",
            fullDescription: "Full",
            rules: null,
            registrationOpenAt: null,
            startDate: null,
            startDateStatus: "tba",
            endDate: null,
            endDateStatus: "tbd",
            registrationDeadline: null,
            registrationDeadlineStatus: "tba",
            format: "Single elimination",
            registrationMode: "open_entry",
            teamSize: 5,
            maxTeams: 16,
            prizePool: "TBA",
            status: "registration_open",
            isPublished: true,
            isFeatured: false,
            _count: { teamRegistrations: 0 },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const [tournament] = await tournamentService.listPublicTournaments();
    assert.equal(tournament.registrationState, "registration_open");
    assert.equal(tournament.startDate, null);
    assert.equal(tournament.startDateStatus, "tba");
  } finally {
    restore();
  }
});

test("deleteAdminTournament removes private proofs and only unreferenced registration logos", async () => {
  const removedUploads = [];
  const prisma = {
    tournament: {
      findUnique: async () => ({
        id: "tournament-1",
        bannerImageName: "banner.webp",
        heroImageName: null,
        completedPosterImageName: null,
        firstPlaceImageName: null,
        secondPlaceImageName: null,
        thirdPlaceImageName: null,
        scheduleFileName: null,
        sponsors: [],
        teamRegistrations: [
          {
            teamLogoName: "shared-logo.webp",
            payments: [
              { bankTransferProof: { storedFilename: "private-proof.webp" } },
            ],
          },
          { teamLogoName: "orphan-logo.webp", payments: [] },
        ],
      }),
      deleteMany: async () => ({ count: 1 }),
    },
    teamRegistration: { count: async () => 0 },
    savedTeam: {
      count: async ({ where }) => where.logoName === "shared-logo.webp" ? 1 : 0,
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
      tournamentBannerDirectory: "uploads/tournament-banners",
      tournamentScheduleDirectory: "uploads/tournament-schedules",
      sponsorLogoDirectory: "uploads/sponsor-logos",
      bankTransferProofDirectory: "private/bank-transfer-proofs",
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServiceModulePath]: {},
  });

  try {
    await tournamentService.deleteAdminTournament("tournament-1");
    assert.deepEqual(removedUploads, [
      { directory: "uploads/tournament-banners", filename: "banner.webp" },
      { directory: "private/bank-transfer-proofs", filename: "private-proof.webp" },
      { directory: "uploads/team-logos", filename: "orphan-logo.webp" },
    ]);
  } finally {
    restore();
  }
});
