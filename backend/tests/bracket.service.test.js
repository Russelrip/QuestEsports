const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/bracket.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

test("generateTournamentBracket uses approved teams and pads non-power-of-two fields with BYEs", async () => {
  let savedBracketData = null;
  const prismaMock = {
    prisma: {
      tournament: {
        findUnique: async () => ({ id: "tournament-1", title: "Quest Cup" }),
      },
      teamRegistration: {
        findMany: async () => [
          { id: "r1", teamName: "Alpha Team", teamLogoName: "alpha.png", members: [{ id: "m1" }], createdAt: new Date() },
          { id: "r2", teamName: "Beta Team", teamLogoName: null, members: [{ id: "m2" }], createdAt: new Date() },
          { id: "r3", teamName: "Gamma Team", teamLogoName: null, members: [{ id: "m3" }], createdAt: new Date() },
        ],
      },
      tournamentBracket: {
        upsert: async ({ create }) => {
          savedBracketData = create.bracketData;
          return {
            ...create,
            generatedAt: new Date("2026-05-29T00:00:00.000Z"),
            lastUpdatedAt: new Date("2026-05-29T00:00:00.000Z"),
          };
        },
      },
    },
  };

  const { module: bracketService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
  });

  try {
    const bracket = await bracketService.generateTournamentBracket("tournament-1");

    assert.equal(bracket.seedData.length, 3);
    assert.equal(savedBracketData.participant.length, 3);
    assert.equal(savedBracketData.match.length > 0, true);
    assert.equal(savedBracketData.match.some((match) => match.opponent1 === null || match.opponent2 === null), true);
  } finally {
    restore();
  }
});

test("updateTournamentBracketMatch completes a ready match and advances the winner", async () => {
  let currentBracket = null;
  const prismaMock = {
    prisma: {
      tournament: {
        findUnique: async () => ({ id: "tournament-1", title: "Quest Cup" }),
      },
      teamRegistration: {
        findMany: async () => [
          { id: "r1", teamName: "Alpha Team", teamLogoName: null, members: [], createdAt: new Date() },
          { id: "r2", teamName: "Beta Team", teamLogoName: null, members: [], createdAt: new Date() },
          { id: "r3", teamName: "Gamma Team", teamLogoName: null, members: [], createdAt: new Date() },
          { id: "r4", teamName: "Delta Team", teamLogoName: null, members: [], createdAt: new Date() },
        ],
      },
      tournamentBracket: {
        upsert: async ({ create }) => {
          currentBracket = {
            id: "bracket-1",
            tournamentId: "tournament-1",
            ...create,
            generatedAt: new Date("2026-05-29T00:00:00.000Z"),
            lastUpdatedAt: new Date("2026-05-29T00:00:00.000Z"),
          };
          return currentBracket;
        },
        findUnique: async () => currentBracket,
        update: async ({ data }) => {
          currentBracket = {
            ...currentBracket,
            ...data,
            lastUpdatedAt: new Date("2026-05-29T01:00:00.000Z"),
          };
          return currentBracket;
        },
      },
    },
  };

  const { module: bracketService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
  });

  try {
    await bracketService.generateTournamentBracket("tournament-1");
    const bracket = await bracketService.updateTournamentBracketMatch("tournament-1", 0, {
      opponent1Score: 13,
      opponent2Score: 7,
      winner: "opponent1",
    });
    const updatedMatch = bracket.bracketData.match.find((match) => match.id === 0);
    const nextWinnerMatch = bracket.bracketData.match.find((match) => match.round_id === 1);

    assert.equal(updatedMatch.status, 4);
    assert.equal(updatedMatch.opponent1.result, "win");
    assert.equal(nextWinnerMatch.opponent1.id, updatedMatch.opponent1.id);
  } finally {
    restore();
  }
});
