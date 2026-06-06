const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/recruitment/recruitment.service.js"
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const secretBoxModulePath = path.join(__dirname, "../src/lib/secret-box.js");

test("createRecruitmentApplication encrypts applicant and team member ID numbers", async () => {
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
    [secretBoxModulePath]: {
      encryptSecret: (value) => `encrypted:${value}`,
    },
  });

  try {
    await recruitmentService.createRecruitmentApplication({
      user: { id: "user-1", email: "captain@example.com" },
      body: {
        applicationType: "existing_team",
        fullName: "Quest Captain",
        phone: "0760000000",
        discord: "captain",
        game: "VALORANT",
        playerId: "Captain#LK",
        idNumber: "captain-id",
        teamName: "Quest Five",
        currentRosterSize: 2,
        members: [
          {
            name: "Player Two",
            email: "player2@example.com",
            discord: "player2",
            playerId: "Player2#LK",
            idNumber: "member-id",
          },
        ],
      },
    });

    const data = createCalls[0].data;
    assert.equal(data.email, "captain@example.com");
    assert.equal(data.applicantIdNumberCiphertext, "encrypted:captain-id");
    assert.equal(data.members[0].idNumberCiphertext, "encrypted:member-id");
    assert.equal(JSON.stringify(data).includes('"idNumber":"'), false);
  } finally {
    restore();
  }
});

test("createRecruitmentApplication rejects unsupported application types", async () => {
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [secretBoxModulePath]: { encryptSecret: (value) => value },
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
