const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const generatedPrismaPath = path.join(__dirname, "../src/generated/prisma/index.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServiceModulePath = path.join(__dirname, "../src/modules/teams/team.service.js");

const buildRegistrationBody = (overrides = {}) => {
  const body = {
    tournamentSlug: "quest-cup",
    teamName: "Quest Five",
    country: "Sri Lanka",
    teamTag: "QF",
    organizationRequested: true,
    captainName: "Captain",
    captainPhone: "123456789",
    captainDiscord: "captain",
    captainRiotId: "Captain#001",
    contactEmail: "contact@example.com",
    rulebook: true,
    falsityWarning: true,
    ...overrides,
  };

  for (let index = 2; index <= 5; index += 1) {
    body[`player${index}Name`] = `Player ${index}`;
    body[`player${index}Email`] = `player${index}@example.com`;
    body[`player${index}Discord`] = `player${index}`;
    body[`player${index}RiotId`] = `Player${index}#001`;
  }

  return body;
};

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

test("createTournamentRegistration rejects submissions before registrationOpenAt", async () => {
  let uploadCalls = 0;
  const prismaMock = {
    prisma: {
      tournament: {
        findUnique: async () => ({
          id: "tournament-1",
          title: "Future Cup",
          maxTeams: 16,
          status: "registration_open",
          registrationOpenAt: new Date(Date.now() + 60_000),
          registrationDeadline: new Date(Date.now() + 3600_000),
          _count: {
            teamRegistrations: 0,
          },
        }),
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => {
        uploadCalls += 1;
        return null;
      },
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  const body = {
    tournamentSlug: "future-cup",
    teamName: "Quest Five",
    captainName: "Captain",
    captainPhone: "123456789",
    captainDiscord: "captain",
    captainRiotId: "Captain#001",
    contactEmail: "contact@example.com",
    rulebook: true,
    falsityWarning: true,
  };

  for (let index = 2; index <= 5; index += 1) {
    body[`player${index}Name`] = `Player ${index}`;
    body[`player${index}Email`] = `player${index}@example.com`;
    body[`player${index}Discord`] = `player${index}`;
    body[`player${index}RiotId`] = `Player${index}#001`;
  }

  try {
    await assert.rejects(
      tournamentService.createTournamentRegistration({
        body,
        file: null,
        user: { email: "captain@example.com" },
      }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "Registration is closed for the selected tournament."
    );
    assert.equal(uploadCalls, 0);
  } finally {
    restore();
  }
});

test("createTournamentRegistration retries transient transaction startup errors", async () => {
  class PrismaClientKnownRequestError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const tournamentRecord = {
    id: "a2508cd7-f437-42d9-9b65-af3a6b4d9da4",
    slug: "quest-cup",
    title: "Quest Cup",
    maxTeams: 16,
    status: "registration_open",
    registrationOpenAt: new Date(Date.now() - 60_000),
    registrationDeadline: new Date(Date.now() + 3600_000),
    _count: {
      teamRegistrations: 0,
    },
  };
  const createdRegistrations = [];
  const createdMembers = [];
  let transactionCalls = 0;
  let uploadCalls = 0;
  let syncCalls = 0;
  let sendCalls = 0;

  const tx = {
    tournament: {
      findUnique: async () => tournamentRecord,
    },
    teamRegistration: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistrations.push(data);
        return data;
      },
    },
    registrationMember: {
      createMany: async ({ data }) => {
        createdMembers.push(...data);
        return { count: data.length };
      },
    },
  };
  const prismaMock = {
    prisma: {
      tournament: {
        findUnique: async () => tournamentRecord,
      },
      $transaction: async (callback, options) => {
        transactionCalls += 1;
        assert.equal(options.isolationLevel, "Serializable");
        assert.equal(options.maxWait, 10_000);
        assert.equal(options.timeout, 20_000);

        if (transactionCalls === 1) {
          throw new PrismaClientKnownRequestError(
            "Unable to start a transaction in the given time.",
            "P2028"
          );
        }

        return callback(tx);
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: {
          Serializable: "Serializable",
        },
        PrismaClientKnownRequestError,
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => {
        uploadCalls += 1;
        return null;
      },
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => {
        syncCalls += 1;
        return [];
      },
      sendTeamInvites: async () => {
        sendCalls += 1;
      },
    },
  });

  try {
    await tournamentService.createTournamentRegistration({
      body: buildRegistrationBody(),
      file: null,
      user: {
        id: "b2508cd7-f437-42d9-9b65-af3a6b4d9da4",
        email: "captain@example.com",
        firstName: "Team",
        lastName: "Captain",
        username: "captain",
      },
    });

    assert.equal(transactionCalls, 2);
    assert.equal(uploadCalls, 1);
    assert.equal(createdRegistrations.length, 1);
    assert.equal(createdRegistrations[0].country, "Sri Lanka");
    assert.equal(createdRegistrations[0].teamTag, "QF");
    assert.equal(createdRegistrations[0].organizationRequested, true);
    assert.equal(createdMembers.length, 5);
    assert.equal(syncCalls, 1);
    assert.equal(sendCalls, 1);
  } finally {
    restore();
  }
});
