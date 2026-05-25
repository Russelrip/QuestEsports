const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { HttpError } = require("../src/lib/http-error");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const mailModulePath = path.join(__dirname, "../src/lib/mail/sendTeamInviteEmail.js");

test("getTeamInvitePreview rejects expired or invalid invite tokens", async () => {
  const findFirstCalls = [];
  const prismaMock = {
    prisma: {
      savedTeamMember: {
        findFirst: async (args) => {
          findFirstCalls.push(args);
          return null;
        },
      },
    },
  };

  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await assert.rejects(
      () => teamService.getTeamInvitePreview({ token: "expired-token" }),
      (error) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.message === "This team invite link is invalid or has expired."
    );

    assert.equal(findFirstCalls.length, 1);
    assert.equal(findFirstCalls[0].where.inviteStatus, "pending");
    assert.ok(findFirstCalls[0].where.inviteExpiresAt.gt instanceof Date);
  } finally {
    restore();
  }
});

test("respondToTeamInvite clears the token and expiry after an accepted invite", async () => {
  const updateCalls = [];
  const prismaMock = {
    prisma: {
      savedTeamMember: {
        findFirst: async () => ({
          id: "member-1",
          name: "Player Two",
          email: "player2@example.com",
          inviteStatus: "pending",
          team: {
            id: "team-1",
            name: "Quest Five",
            captainUser: {
              firstName: "Quest",
              lastName: "Captain",
              username: "captain",
            },
          },
        }),
        update: async (args) => {
          updateCalls.push(args);
          return {
            id: "member-1",
            name: "Player Two",
            email: "player2@example.com",
            inviteStatus: args.data.inviteStatus,
            team: {
              id: "team-1",
              name: "Quest Five",
              captainUser: {
                firstName: "Quest",
                lastName: "Captain",
                username: "captain",
              },
            },
          };
        },
      },
    },
  };

  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    const result = await teamService.respondToTeamInvite({
      token: "valid-token",
      decision: "accept",
    });

    assert.equal(result.inviteStatus, "accepted");
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].data.inviteTokenHash, null);
    assert.equal(updateCalls[0].data.inviteExpiresAt, null);
    assert.ok(updateCalls[0].data.inviteRespondedAt instanceof Date);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration sets a 72 hour expiry for pending invites", async () => {
  const createManyCalls = [];
  const tx = {
    savedTeam: {
      findUnique: async () => null,
      create: async () => ({
        id: "saved-team-1",
        members: [],
      }),
      update: async () => null,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async (args) => {
        createManyCalls.push(args);
        return { count: args.data.length };
      },
    },
  };

  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    const inviteDispatches = await teamService.syncSavedTeamFromRegistration({
      tx,
      user: {
        id: "user-1",
        firstName: "Quest",
        lastName: "Captain",
        username: "captain",
      },
      teamName: "Quest Five",
      logoName: null,
      tournamentTitle: "Quest Cup",
      members: [
        {
          role: "CAPTAIN",
          order: 1,
          name: "Quest Captain",
          email: "captain@example.com",
          discord: "captain#0001",
          riotId: "captain-riot",
        },
        {
          role: "PLAYER",
          order: 2,
          name: "Player Two",
          email: "player2@example.com",
          discord: "player2#0002",
          riotId: "player2-riot",
        },
      ],
    });

    assert.equal(inviteDispatches.length, 1);
    assert.equal(createManyCalls.length, 1);

    const [captainRecord, playerRecord] = createManyCalls[0].data;
    assert.equal(captainRecord.inviteStatus, "accepted");
    assert.equal(captainRecord.inviteExpiresAt, null);
    assert.equal(playerRecord.inviteStatus, "pending");
    assert.ok(playerRecord.inviteSentAt instanceof Date);
    assert.ok(playerRecord.inviteExpiresAt instanceof Date);

    const expiryDeltaMs =
      playerRecord.inviteExpiresAt.getTime() - playerRecord.inviteSentAt.getTime();
    assert.equal(expiryDeltaMs, 72 * 60 * 60 * 1000);
  } finally {
    restore();
  }
});
