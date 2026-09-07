const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/recruitment/recruitment.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const discordLinkPath = path.join(__dirname, "../src/modules/auth/discord-link.service.js");
const secretBoxModulePath = path.join(__dirname, "../src/lib/secret-box.js");

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
  nic: "200212345678",
  tournamentExperience: "Community cup finalist",
  previouslyInOrganization: false,
  canAttendLan: true,
  declarationAccepted: true,
  privacyAccepted: true,
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
        user: { findMany: async () => [] },
      },
    },
    // The applicant's handle comes from their connected account, so the flow
    // cannot run without one. Resolution itself is covered in
    // discord-link.service.test.js.
    [discordLinkPath]: {
      requireLinkedDiscord: async () => ({
        discordId: "900000000000000001",
        discordUsername: "applicant-discord",
      }),
      getLinkedDiscordForUsers: async () => new Map(),
    },
    [secretBoxModulePath]: {
      encryptSecret: (value) => `encrypted:${value}`,
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
    assert.equal(data.playerId, null);
    assert.equal(data.applicantIdNumberCiphertext, "encrypted:200212345678");
    assert.equal(data.details.ign, "QuestIGN");
    assert.equal(data.details.declarationAccepted, true);
    assert.equal(data.privacyPolicyVersion, recruitmentService.PRIVACY_POLICY_VERSION);
    assert.ok(data.privacyAcceptedAt instanceof Date);
  } finally {
    restore();
  }
});

test("createRecruitmentApplication rejects missing privacy consent", async () => {
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [secretBoxModulePath]: { encryptSecret: (value) => `encrypted:${value}` },
  });

  try {
    await assert.rejects(
      () =>
        recruitmentService.createRecruitmentApplication({
          user: { id: "user-1", email: "player@example.com" },
          body: { ...validSoloBody, privacyAccepted: false },
        }),
      (error) =>
        error.name === "HttpError" &&
        error.statusCode === 400 &&
        error.message === "Privacy Policy agreement is required."
    );
  } finally {
    restore();
  }
});

test("createRecruitmentApplication encrypts team member NICs", async () => {
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
        user: { findMany: async () => [] },
      },
    },
    // The applicant's handle comes from their connected account, so the flow
    // cannot run without one. Resolution itself is covered in
    // discord-link.service.test.js.
    [discordLinkPath]: {
      requireLinkedDiscord: async () => ({
        discordId: "900000000000000001",
        discordUsername: "applicant-discord",
      }),
      getLinkedDiscordForUsers: async () => new Map(),
    },
    [secretBoxModulePath]: {
      encryptSecret: (value) => `encrypted:${value}`,
    },
  });

  try {
    await recruitmentService.createRecruitmentApplication({
      user: { id: "user-1", email: "captain@example.com" },
      body: {
        ...validSoloBody,
        applicationType: "incomplete_team",
        teamName: "Quest Duo",
        currentRosterSize: 2,
        members: [
          {
            name: "Player Two",
            ign: "QuestTwo",
            nic: "200298765432",
            discord: "questtwo",
            email: "player2@example.com",
            phone: "0770000000",
            role: "player",
            privacyAccepted: true,
          },
        ],
      },
    });

    const member = createCalls[0].data.members[0];
    assert.equal(member.idNumberCiphertext, "encrypted:200298765432");
    assert.equal("nic" in member, false);
    assert.match(member.privacyAcceptedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    restore();
  }
});

test("createRecruitmentApplication requires permission for every submitted team member", async () => {
  const { module: recruitmentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [secretBoxModulePath]: { encryptSecret: (value) => `encrypted:${value}` },
  });

  try {
    await assert.rejects(
      () =>
        recruitmentService.createRecruitmentApplication({
          user: { id: "user-1", email: "captain@example.com" },
          body: {
            ...validSoloBody,
            applicationType: "incomplete_team",
            teamName: "Quest Duo",
            currentRosterSize: 2,
            members: [
              {
                name: "Player Two",
                ign: "QuestTwo",
                nic: "200298765432",
                discord: "questtwo",
                email: "player2@example.com",
                phone: "0770000000",
                role: "player",
                privacyAccepted: false,
              },
            ],
          },
        }),
      (error) =>
        error.name === "HttpError" &&
        error.statusCode === 400 &&
        error.message === "Team member 1 privacy permission is required."
    );
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
