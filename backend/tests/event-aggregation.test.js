const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const aggregationPath = path.join(__dirname, "../src/modules/series/event-aggregation.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

test("event aggregate counts visible active teams and non-coach players without waitlisted capacity", async () => {
  const prisma = {
    tournament: {
      findMany: async () => [
        {
          id: "game-1",
          maxTeams: 4,
          status: "registration_open",
          registrationOpenAt: null,
          registrationDeadline: null,
          startDate: new Date("2099-01-01T00:00:00.000Z"),
          endDate: new Date("2099-01-02T00:00:00.000Z"),
          _count: { teamRegistrations: 2, adminSlotReservations: 0 },
          adminSlotReservations: [],
        },
        {
          id: "game-2",
          maxTeams: 2,
          status: "completed",
          registrationOpenAt: null,
          registrationDeadline: null,
          startDate: new Date("2025-01-01T00:00:00.000Z"),
          endDate: new Date("2025-01-02T00:00:00.000Z"),
          _count: { teamRegistrations: 2, adminSlotReservations: 0 },
          adminSlotReservations: [],
        },
      ],
    },
    registrationMember: {
      count: async () => 7,
    },
  };
  const { module: aggregation, restore } = loadModuleWithMocks(aggregationPath, {
    [prismaPath]: { prisma },
  });

  try {
    const result = await aggregation.getEventAggregate({ seriesId: "event-1" });
    assert.deepEqual(result, {
      games: 2,
      teamsRegistered: 4,
      playersRegistered: 7,
      availableSlots: 2,
      registrationState: "open",
    });
  } finally {
    restore();
  }
});

test("event aggregate derives upcoming and completed states", async () => {
  const makePrisma = (tournament) => ({
    tournament: { findMany: async () => [tournament] },
    registrationMember: { count: async () => 0 },
  });

  for (const [tournament, expected] of [
    [{ id: "upcoming", maxTeams: 4, status: "upcoming", startDate: new Date("2099-01-01") }, "upcoming"],
    [{ id: "completed", maxTeams: 4, status: "completed", endDate: new Date("2020-01-01") }, "completed"],
  ]) {
    const { module: aggregation, restore } = loadModuleWithMocks(aggregationPath, {
      [prismaPath]: { prisma: makePrisma(tournament) },
    });
    try {
      assert.equal(
        (await aggregation.getEventAggregate({ seriesId: "event-1" })).registrationState,
        expected
      );
    } finally {
      restore();
    }
  }
});
