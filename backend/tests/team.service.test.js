const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const mailModulePath = path.join(__dirname, "../src/lib/mail/sendTeamInviteEmail.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");

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

test("createSavedTeam stores the captain and sends standalone member invites", async () => {
  const createdMembers = [];
  const sentInvites = [];
  const user = {
    id: "user-1",
    firstName: "Quest",
    lastName: "Captain",
    username: "captain",
    email: "captain@example.com",
  };
  const createdTeam = {
    id: "saved-team-1",
    captainUserId: user.id,
    name: "Quest Five",
    country: "Sri Lanka",
    teamTag: "QF",
    organizationRequested: true,
    logoName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    captainUser: user,
    members: [],
  };
  const tx = {
    savedTeam: {
      create: async () => createdTeam,
      findUnique: async () => ({ ...createdTeam, members: createdMembers }),
    },
    savedTeamMember: {
      createMany: async ({ data }) => {
        createdMembers.push(...data);
        return { count: data.length };
      },
    },
  };
  const prismaMock = {
    prisma: {
      $transaction: async (callback) => callback(tx),
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [mailModulePath]: {
      sendTeamInviteEmail: async (invite) => sentInvites.push(invite),
    },
  });

  try {
    const team = await teamService.createSavedTeam({
      user,
      file: null,
      body: {
        name: "Quest Five",
        country: "Sri Lanka",
        teamTag: "QF",
        organizationRequested: "true",
        members: JSON.stringify([
          { name: "Player Two", email: "player2@example.com" },
        ]),
      },
    });

    assert.equal(team.name, "Quest Five");
    assert.equal(createdMembers.length, 2);
    assert.equal(createdMembers[0].role, "CAPTAIN");
    assert.equal(createdMembers[0].inviteStatus, "accepted");
    assert.equal(createdMembers[1].role, "PLAYER");
    assert.equal(createdMembers[1].inviteStatus, "pending");
    assert.ok(createdMembers[1].inviteTokenHash);
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].tournamentTitle, null);
  } finally {
    restore();
  }
});

test("updateSavedTeam lets the captain replace roster details and preserves accepted members", async () => {
  const sentInvites = [];
  const createdMembers = [];
  const user = {
    id: "user-1",
    firstName: "Quest",
    lastName: "Captain",
    username: "captain",
    email: "captain@example.com",
  };
  const existingTeam = {
    id: "saved-team-1",
    captainUserId: user.id,
    name: "Quest Five",
    logoName: null,
    members: [
      { id: "captain-member", role: "CAPTAIN", emailNormalized: user.email },
      {
        id: "accepted-member",
        userId: "user-2",
        role: "PLAYER",
        memberOrder: 1,
        emailNormalized: "accepted@example.com",
        inviteStatus: "accepted",
        inviteSentAt: new Date("2026-01-01"),
        inviteRespondedAt: new Date("2026-01-02"),
      },
      {
        id: "pending-member",
        userId: null,
        role: "SUBSTITUTE",
        memberOrder: 1,
        emailNormalized: "pending@example.com",
        inviteStatus: "pending",
        inviteTokenHash: "existing-pending-token",
        inviteSentAt: new Date("2026-01-03"),
        inviteExpiresAt: new Date("2026-01-06"),
        inviteRespondedAt: null,
      },
    ],
  };
  const tx = {
    savedTeam: {
      update: async () => existingTeam,
      findUnique: async () => ({
        ...existingTeam,
        name: "Quest Six",
        country: "Sri Lanka",
        teamTag: "Q6",
        organizationRequested: false,
        organizationName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        captainUser: user,
        members: [
          {
            id: "captain-member",
            role: "CAPTAIN",
            memberOrder: 0,
            name: "Quest Captain",
            email: user.email,
            inviteStatus: "accepted",
          },
          ...createdMembers,
        ],
      }),
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async ({ data }) => {
        createdMembers.push(...data);
        return { count: data.length };
      },
    },
  };
  let transactionAttempts = 0;
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async (callback) => {
          transactionAttempts += 1;
          if (transactionAttempts === 1) {
            const error = new Error("Timed out while acquiring a connection.");
            error.code = "P2024";
            throw error;
          }
          return callback(tx);
        },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [mailModulePath]: {
      sendTeamInviteEmail: async (invite) => sentInvites.push(invite),
    },
  });

  try {
    const team = await teamService.updateSavedTeam({
      teamId: existingTeam.id,
      user,
      file: null,
      body: {
        name: "Quest Six",
        country: "Sri Lanka",
        teamTag: "Q6",
        organizationRequested: "false",
        members: JSON.stringify([
          { role: "PLAYER", name: "Accepted Player", email: "accepted@example.com" },
          { role: "SUBSTITUTE", name: "Pending Player", email: "pending@example.com" },
          { role: "COACH", name: "New Coach", email: "coach@example.com" },
        ]),
      },
    });

    assert.equal(team.name, "Quest Six");
    assert.equal(createdMembers.length, 3);
    assert.equal(createdMembers[0].userId, "user-2");
    assert.equal(createdMembers[0].inviteStatus, "accepted");
    assert.equal(createdMembers[1].inviteStatus, "pending");
    assert.equal(createdMembers[1].inviteTokenHash, "existing-pending-token");
    assert.equal(createdMembers[2].role, "COACH");
    assert.equal(createdMembers[2].inviteStatus, "pending");
    assert.ok(createdMembers[2].inviteTokenHash);
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].email, "coach@example.com");
    assert.equal(transactionAttempts, 2);
  } finally {
    restore();
  }
});

test("resendSavedTeamInvite renews pending or declined invites and enforces its cooldown", async () => {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const sentInvites = [];
  const member = {
    id: "pending-member",
    teamId: "saved-team-1",
    userId: null,
    role: "PLAYER",
    memberOrder: 1,
    name: "Pending Player",
    email: "pending@example.com",
    emailNormalized: "pending@example.com",
    discord: null,
    riotId: null,
    inviteStatus: "pending",
    inviteTokenHash: "old-token",
    inviteSentAt: new Date("2026-07-17T09:58:00.000Z"),
    inviteExpiresAt: new Date("2026-07-20T09:58:00.000Z"),
    inviteRespondedAt: null,
    team: {
      name: "Quest Five",
      captainUser: {
        firstName: "Quest",
        lastName: "Captain",
        username: "captain",
      },
    },
  };
  let updatedMember;
  const tx = {
    savedTeamMember: {
      update: async ({ data }) => {
        updatedMember = { ...member, ...data };
        return updatedMember;
      },
    },
  };
  const prisma = {
    savedTeamMember: { findFirst: async () => member },
    registrationMember: { findFirst: async () => null },
    $transaction: async (callback) => callback(tx),
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [mailModulePath]: {
      sendTeamInviteEmail: async (invite) => sentInvites.push(invite),
    },
  });

  try {
    const result = await teamService.resendSavedTeamInvite({
      teamId: "saved-team-1",
      memberId: member.id,
      user: { id: "user-1" },
      now,
    });
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].email, member.email);
    assert.notEqual(updatedMember.inviteTokenHash, "old-token");
    assert.equal(result.member.inviteSentAt.getTime(), now.getTime());
    assert.equal(
      result.resendAvailableAt.getTime(),
      now.getTime() + 60 * 1000
    );

    member.inviteStatus = "declined";
    member.inviteSentAt = new Date(now.getTime() - 2 * 60 * 1000);
    const renewedDecline = await teamService.resendSavedTeamInvite({
      teamId: "saved-team-1",
      memberId: member.id,
      user: { id: "user-1" },
      now,
    });
    assert.equal(renewedDecline.member.inviteStatus, "pending");

    member.inviteStatus = "pending";
    member.inviteSentAt = new Date(now.getTime() - 30 * 1000);
    await assert.rejects(
      teamService.resendSavedTeamInvite({
        teamId: "saved-team-1",
        memberId: member.id,
        user: { id: "user-1" },
        now,
      }),
      (error) => error.statusCode === 429 && error.details.retryAfterSeconds === 30
    );
  } finally {
    restore();
  }
});

test("deleteSavedTeam refuses members who are not the captain", async () => {
  let deleteCalls = 0;
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: {
          findFirst: async () => null,
          delete: async () => { deleteCalls += 1; },
        },
      },
    },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await assert.rejects(
      () => teamService.deleteSavedTeam({ teamId: "saved-team-1", user: { id: "member-user" } }),
      (error) => error.statusCode === 404 && error.message.includes("permission")
    );
    assert.equal(deleteCalls, 0);
  } finally {
    restore();
  }
});

test("deleteSavedTeam refuses to delete a registered team", async () => {
  let deleteCalls = 0;
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: {
          findFirst: async () => ({
            id: "saved-team-1",
            logoName: "registered-logo.png",
            _count: { registrations: 1 },
          }),
          delete: async () => { deleteCalls += 1; },
        },
      },
    },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await assert.rejects(
      () => teamService.deleteSavedTeam({
        teamId: "saved-team-1",
        user: { id: "captain-user" },
      }),
      (error) => error.statusCode === 409 && error.message.includes("tournament registration")
    );
    assert.equal(deleteCalls, 0);
  } finally {
    restore();
  }
});

test("deleteSavedTeam preserves a logo referenced by an unrelated tournament registration", async () => {
  const removedUploads = [];
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: {
          findFirst: async () => ({
            id: "saved-team-1",
            logoName: "shared-logo.png",
            _count: { registrations: 0 },
          }),
          delete: async () => ({ id: "saved-team-1" }),
          count: async () => 0,
        },
        teamRegistration: { count: async () => 1 },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
      teamLogoDirectory: "uploads/team-logos",
    },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await teamService.deleteSavedTeam({
      teamId: "saved-team-1",
      user: { id: "captain-user" },
    });
    assert.deepEqual(removedUploads, []);
  } finally {
    restore();
  }
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

test("sendTeamInvites queues the roster in one batch", async () => {
  const batches = [];
  let singleInviteCalls = 0;
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [mailModulePath]: {
      sendTeamInviteEmail: async () => {
        singleInviteCalls += 1;
      },
      sendTeamInviteEmails: async (invites) => {
        batches.push(invites);
      },
    },
  });

  try {
    const invites = [
      { email: "player1@example.com", rawToken: "token-one" },
      { email: "player2@example.com", rawToken: "token-two" },
    ];
    await teamService.sendTeamInvites(invites);

    assert.equal(singleInviteCalls, 0);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], invites);
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

test("syncSavedTeamFromRegistration preserves an active pending invite without emailing twice", async () => {
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(inviteSentAt.getTime() + 60 * 60 * 1000);
  const savedRows = [];
  const registrationUpdates = [];
  const tx = {
    savedTeam: {
      findUnique: async () => ({
        id: "saved-team-1",
        members: [{
          role: "PLAYER",
          memberOrder: 1,
          emailNormalized: "player@example.com",
          inviteStatus: "pending",
          inviteTokenHash: "existing-token-hash",
          inviteSentAt,
          inviteExpiresAt,
          userId: null,
        }],
      }),
      update: async () => null,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async ({ data }) => { savedRows.push(...data); return { count: data.length }; },
    },
    registrationMember: {
      update: async ({ data }) => { registrationUpdates.push(data); return data; },
      findMany: async () => registrationUpdates.map((data) => ({ inviteStatus: data.inviteStatus })),
    },
    teamRegistration: { update: async ({ data }) => data },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    const dispatches = await teamService.syncSavedTeamFromRegistration({
      tx,
      registrationId: "registration-1",
      user: { id: "captain-1", firstName: "Quest", lastName: "Captain" },
      teamName: "Quest Five",
      members: [{
        role: "PLAYER",
        order: 1,
        name: "Player Two",
        email: "player@example.com",
        riotId: "PlayerTwo#456",
      }],
      tournamentTitle: "Quest Cup",
    });

    assert.deepEqual(dispatches, []);
    assert.equal(savedRows[0].inviteTokenHash, "existing-token-hash");
    assert.equal(registrationUpdates[0].inviteTokenHash, "existing-token-hash");
    assert.equal(registrationUpdates[0].inviteExpiresAt, inviteExpiresAt);
  } finally {
    restore();
  }
});

test("ensureTeamRegistrationSaved retries a transient database-pool timeout", async () => {
  let registrationLookupAttempts = 0;
  let transactionAttempts = 0;
  let transactionOptions;
  const registration = {
    id: "registration-1",
    entryType: "team",
    paymentStatus: "unpaid",
    savedTeamId: null,
    teamName: "Quest Five",
    country: "Sri Lanka",
    teamTag: "Q5",
    organizationRequested: false,
    teamLogoName: null,
    user: { id: "captain-1" },
    tournament: { title: "Quest Cup" },
    members: [],
  };
  const prisma = {
    teamRegistration: {
      findUnique: async () => {
        registrationLookupAttempts += 1;
        if (registrationLookupAttempts === 1) {
          const error = new Error("Timed out while acquiring a connection.");
          error.code = "P2024";
          throw error;
        }
        return registration;
      },
    },
    $transaction: async (work, options) => {
      transactionAttempts += 1;
      transactionOptions = options;
      if (transactionAttempts === 1) {
        const error = new Error("Timed out while acquiring a connection.");
        error.code = "P2024";
        throw error;
      }
      return work({
        teamRegistration: {
          findUnique: async () => ({
            savedTeamId: "saved-team-created-by-another-attempt",
            paymentStatus: "unpaid",
          }),
        },
      });
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [mailModulePath]: { sendTeamInviteEmail: async () => true },
  });

  try {
    await teamService.ensureTeamRegistrationSaved(registration.id);

    assert.equal(registrationLookupAttempts, 2);
    assert.equal(transactionAttempts, 2);
    assert.equal(transactionOptions.maxWait, 15_000);
    assert.equal(transactionOptions.timeout, 30_000);
  } finally {
    restore();
  }
});
