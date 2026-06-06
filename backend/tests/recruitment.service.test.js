const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/recruitment/recruitment.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

const validSoloBody = {
  applicationType: "solo_player",
  fullName: "Quest Player",
  ign: "QuestIGN",
  birthday: "2002-05-20",
  gender: "other",
  phone: "0760000000",
  discord: "questplayer",
  games: ["VALORANT", "Dota 2"],
  peakAndCurrentRank: "VALORANT: Diamond / Platinum",
  playerId: "Quest#LK",
  tournamentExperience: "Community cup finalist",
  previouslyInOrganization: false,
  canAttendLan: true,
  declarationAccepted: true,
};

test("createRecruitmentApplication stores the expanded recruitment details", async () => {
  const createCalls = [];
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        recruitmentApplication: {
          create: async (args) => {
            createCalls.push(args);
            return { id: "application-1", status: "pending" };
          },
        },
      },
    },
  });

  try {
    await recruitmentService.createRecruitmentApplication({
      user: { id: "user-1", email: "player@example.com" },
      body: validSoloBody,
    });

    const data = createCalls[0].data;
    assert.equal(data.email, "player@example.com");
    assert.equal(data.game, "VALORANT, Dota 2");
    assert.equal(data.applicantIdNumberCiphertext, null);
    assert.equal(data.details.ign, "QuestIGN");
    assert.equal(data.details.declarationAccepted, true);
  } finally {
    restore();
  }
});

test("createRecruitmentApplication requires four additional members for complete teams", async () => {
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
  });

  try {
    await assert.rejects(
      () =>
        recruitmentService.createRecruitmentApplication({
          user: { id: "user-1", email: "captain@example.com" },
          body: {
            ...validSoloBody,
            applicationType: "existing_team",
            teamName: "Quest Five",
            currentRosterSize: 5,
            members: [],
          },
        }),
      (error) =>
        error.name === "HttpError" &&
        error.statusCode === 400 &&
        error.message.includes("at least four additional players")
    );
  } finally {
    restore();
  }
});

test("createRecruitmentApplication rejects unsupported application types", async () => {
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
  });

  try {
    await assert.rejects(
      () =>
        recruitmentService.createRecruitmentApplication({
          user: { id: "user-1", email: "player@example.com" },
          body: { applicationType: "spectator" },
        }),
      (error) =>
        error.name === "HttpError" &&
        error.statusCode === 400 &&
        error.message === "Select a valid recruitment type."
    );
  } finally {
    restore();
  }
});
