const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { HttpError } = require("../src/lib/http-error");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const mailModulePath = path.join(__dirname, "../src/lib/mail/sendTeamInviteEmail.js");

const buildPendingInvite = () => ({
  id: "registration-member-1",
  role: "PLAYER",
  memberOrder: 2,
  name: "Player Two",
  email: "player2@example.com",
  emailNormalized: "player2@example.com",
  inviteStatus: "pending",
  registration: {
    id: "registration-1",
    teamName: "Quest Five",
    captainName: "Quest Captain",
    savedTeamId: "saved-team-1",
    tournament: {
      title: "Quest Cup",
    },
  },
});

test("getTeamInvitePreview rejects expired or invalid registration invite tokens", async () => {
  const findFirstCalls = [];
  const prismaMock = {
    prisma: {
      registrationMember: {
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

test("respondToTeamInvite requires a verified account using the invited email", async () => {
  const invite = buildPendingInvite();
  const prismaMock = {
    prisma: {
      registrationMember: {
        findFirst: async () => invite,
      },
    },
  };

  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await assert.rejects(
      () =>
        teamService.respondToTeamInvite({
          token: "valid-token",
          decision: "accept",
          user: {
            id: "wrong-user",
            email: "someone-else@example.com",
            emailVerified: true,
          },
        }),
      (error) =>
        error.statusCode === 403 &&
        error.message.includes("player2@example.com")
    );
  } finally {
    restore();
  }
});

test("respondToTeamInvite links the account and verifies a fully accepted registration", async () => {
  const invite = buildPendingInvite();
  const registrationUpdateCalls = [];
  const savedMemberUpdateCalls = [];
  const teamRegistrationUpdateCalls = [];
  const tx = {
    registrationMember: {
      updateMany: async (args) => {
        registrationUpdateCalls.push(args);
        return { count: 1 };
      },
      findUnique: async () => {
        return {
          ...invite,
          inviteStatus: "accepted",
        };
      },
      findMany: async () => [
        { inviteStatus: "accepted" },
        { inviteStatus: "accepted" },
      ],
    },
    savedTeamMember: {
      updateMany: async (args) => {
        savedMemberUpdateCalls.push(args);
        return { count: 1 };
      },
    },
    teamRegistration: {
      update: async (args) => {
        teamRegistrationUpdateCalls.push(args);
        return args.data;
      },
    },
  };
  const prismaMock = {
    prisma: {
      registrationMember: {
        findFirst: async () => invite,
      },
      $transaction: async (callback) => callback(tx),
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
      user: {
        id: "user-2",
        email: "player2@example.com",
        emailVerified: true,
      },
    });

    assert.equal(result.inviteStatus, "accepted");
    assert.equal(registrationUpdateCalls[0].data.userId, "user-2");
    assert.equal(registrationUpdateCalls[0].data.inviteTokenHash, null);
    assert.equal(registrationUpdateCalls[0].data.inviteExpiresAt, null);
    assert.ok(registrationUpdateCalls[0].data.inviteRespondedAt instanceof Date);
    assert.equal(savedMemberUpdateCalls[0].data.userId, "user-2");
    assert.equal(savedMemberUpdateCalls[0].data.inviteStatus, "accepted");
    assert.deepEqual(teamRegistrationUpdateCalls.at(-1).data, {
      verificationStatus: "verified",
    });
  } finally {
    restore();
  }
});

test("refreshRegistrationVerificationStatus flags registrations with a declined member", async () => {
  const updateCalls = [];
  const tx = {
    registrationMember: {
      findMany: async () => [
        { inviteStatus: "accepted" },
        { inviteStatus: "declined" },
      ],
    },
    teamRegistration: {
      update: async (args) => {
        updateCalls.push(args);
        return args.data;
      },
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    const result = await teamService.refreshRegistrationVerificationStatus({
      tx,
      registrationId: "registration-1",
    });

    assert.equal(result, "flagged");
    assert.deepEqual(updateCalls[0].data, { verificationStatus: "flagged" });
  } finally {
    restore();
  }
});

test("listProfileTeams returns accepted memberships as non-captain teams", async () => {
  const findManyCalls = [];
  const prismaMock = {
    prisma: {
      savedTeam: {
        findMany: async (args) => {
          findManyCalls.push(args);
          return [
            {
              id: "saved-team-1",
              captainUserId: "captain-user",
              name: "Quest Five",
              logoName: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              captainUser: {
                firstName: "Quest",
                lastName: "Captain",
                username: "captain",
              },
              members: [],
            },
          ];
        },
      },
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    const teams = await teamService.listProfileTeams({
      user: { id: "member-user" },
    });

    assert.equal(teams.length, 1);
    assert.equal(teams[0].isCaptain, false);
    assert.equal(teams[0].captainName, "Quest Captain");
    assert.deepEqual(findManyCalls[0].where.OR[1], {
      members: {
        some: {
          userId: "member-user",
          inviteStatus: "accepted",
        },
      },
    });
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration links the registration and creates account-bound invites", async () => {
  const savedMemberCreateCalls = [];
  const registrationMemberUpdateCalls = [];
  const teamRegistrationUpdateCalls = [];
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
        savedMemberCreateCalls.push(args);
        return { count: args.data.length };
      },
    },
    registrationMember: {
      update: async (args) => {
        registrationMemberUpdateCalls.push(args);
        return args.data;
      },
      findMany: async () =>
        registrationMemberUpdateCalls.map((call) => ({
          inviteStatus: call.data.inviteStatus,
        })),
    },
    teamRegistration: {
      update: async (args) => {
        teamRegistrationUpdateCalls.push(args);
        return args.data;
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
      registrationId: "registration-1",
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
    assert.equal(savedMemberCreateCalls.length, 1);

    const [captainRecord, playerRecord] = savedMemberCreateCalls[0].data;
    assert.equal(captainRecord.userId, "user-1");
    assert.equal(captainRecord.inviteStatus, "accepted");
    assert.equal(playerRecord.userId, undefined);
    assert.equal(playerRecord.inviteStatus, "pending");
    assert.ok(playerRecord.inviteTokenHash);
    assert.ok(playerRecord.inviteSentAt instanceof Date);
    assert.ok(playerRecord.inviteExpiresAt instanceof Date);

    const expiryDeltaMs =
      playerRecord.inviteExpiresAt.getTime() - playerRecord.inviteSentAt.getTime();
    assert.equal(expiryDeltaMs, 72 * 60 * 60 * 1000);

    assert.equal(registrationMemberUpdateCalls.length, 2);
    assert.equal(registrationMemberUpdateCalls[0].data.userId, "user-1");
    assert.equal(registrationMemberUpdateCalls[0].data.inviteStatus, "accepted");
    assert.equal(registrationMemberUpdateCalls[1].data.inviteStatus, "pending");
    assert.equal(
      registrationMemberUpdateCalls[1].data.inviteTokenHash,
      playerRecord.inviteTokenHash
    );
    assert.deepEqual(teamRegistrationUpdateCalls[0].data, {
      savedTeamId: "saved-team-1",
    });
    assert.deepEqual(teamRegistrationUpdateCalls.at(-1).data, {
      verificationStatus: "pending",
    });
  } finally {
    restore();
  }
});
