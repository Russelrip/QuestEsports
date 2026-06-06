const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServiceModulePath = path.join(__dirname, "../src/modules/teams/team.service.js");

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
