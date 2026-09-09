const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const generatedPrismaModulePath = path.join(__dirname, "../src/generated/prisma/index.js");
const noticeModulePath = path.join(__dirname, "../src/modules/teams/invite-notice.service.js");

// Invitations are announced now, not delivered: the row is the invitation and
// these channels only point at it. The mock records what each dispatch asked
// for and reports a reachable invitee, which is the case every test here is
// about — the unreachable one is covered in invite-notice.test.js.
const noticeMock = (collect) => ({
  notifyInvite: async (invite) => {
    if (collect) collect.push(invite);
    return { inApp: true, discord: false, hasQuestAccount: true, invitationUrl: "https://quest.test/profile?tab=invitations" };
  },
  notifyInvites: async (invites = []) => {
    if (collect) invites.forEach((invite) => collect.push(invite));
    return invites.map(() => ({ inApp: true, discord: false, hasQuestAccount: true }));
  },
});
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const uploadCleanupModulePath = path.join(__dirname, "../src/lib/upload-cleanup.js");


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
    [noticeModulePath]: noticeMock(sentInvites),
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
          { role: "PLAYER", name: "Player Two", email: "player2@example.com" },
          {
            role: "COACH",
            name: "Team Coach",
            email: "coach@example.com",
            phone: "0770000000",
            discord: "coach-discord",
            riotId: "CoachName#123",
          },
          { role: "SUBSTITUTE", name: "Sub Player", email: "sub@example.com" },
        ]),
      },
    });

    assert.equal(team.name, "Quest Five");
    assert.equal(createdMembers.length, 4);
    assert.equal(createdMembers[0].role, "CAPTAIN");
    assert.equal(createdMembers[0].inviteStatus, "accepted");
    const createdPlayer = createdMembers.find((member) => member.role === "PLAYER");
    const createdCoach = createdMembers.find((member) => member.role === "COACH");
    const createdSubstitute = createdMembers.find((member) => member.role === "SUBSTITUTE");
    assert.equal(createdPlayer.memberOrder, 1);
    assert.equal(createdCoach.memberOrder, 1);
    // A saved team holds role, name and email. Whatever a captain typed about
    // somebody else's phone, Discord or game identity is their guess about
    // another person's account, and it is not written down as if it were that
    // person's own: the one who accepts brings their real account with them.
    assert.equal(createdCoach.phone, undefined);
    assert.equal(createdCoach.discord, undefined);
    assert.equal(createdCoach.riotId, undefined);
    assert.equal(createdCoach.inviteStatus, "pending");
    // No token is minted any more: the row is the invitation, and it is
    // answered by the identity of whoever signs in to claim it.
    assert.equal(createdCoach.inviteTokenHash, null);
    assert.equal(createdSubstitute.memberOrder, 1);
    assert.equal(sentInvites.length, 3);
    assert.equal(sentInvites[0].tournamentTitle, null);
    // Each notice points at the row it belongs to, so the invitee lands on the
    // invitation itself rather than on a page asking them which one they mean.
    assert.deepEqual(
      sentInvites.map((invite) => invite.invitationId).sort(),
      createdMembers
        .filter((member) => member.role !== "CAPTAIN")
        .map((member) => member.id)
        .sort(),
    );
    assert.ok(sentInvites.every((invite) => invite.rawToken === undefined));
  } finally {
    restore();
  }
});

test("updateSavedTeam lets the captain replace roster details and preserves accepted members", async () => {
  const sentInvites = [];
  const createdMembers = [];
  const registrationMemberUpdates = [];
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
        // Typed by a captain into an older version of this form. Still on the
        // row, and an edit must not quietly drop it.
        phone: "0110000000",
        discord: "legacy-discord",
        riotId: "LegacyName#000",
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
    teamRegistration: {
      findMany: async () => [{ id: "registration-1", savedTeamId: "saved-team-1", paymentStatus: "unpaid" }],
      update: async () => undefined,
    },
    registrationMember: {
      update: async (args) => registrationMemberUpdates.push(args),
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
    [noticeModulePath]: noticeMock(sentInvites),
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
          {
            role: "COACH",
            name: "Accepted Player",
            email: "accepted@example.com",
            phone: "0770000000",
            discord: "coach-discord",
            riotId: "CoachName#123",
          },
          { role: "SUBSTITUTE", name: "Pending Player", email: "pending@example.com" },
          { role: "PLAYER", name: "New Player", email: "coach@example.com" },
        ]),
      },
    });

    assert.equal(team.name, "Quest Six");
    assert.equal(createdMembers.length, 3);
    assert.equal(createdMembers[0].id, "accepted-member");
    assert.equal(createdMembers[0].userId, "user-2");
    assert.equal(createdMembers[0].role, "COACH");
    // These rows are deleted and recreated on every save, so what an older team
    // already carries has to be carried across — but it is carried, not
    // re-collected: the values the request tried to set are ignored.
    assert.equal(createdMembers[0].phone, "0110000000");
    assert.equal(createdMembers[0].discord, "legacy-discord");
    assert.equal(createdMembers[0].riotId, "LegacyName#000");
    assert.equal(createdMembers[0].inviteStatus, "accepted");
    assert.equal(createdMembers[1].inviteStatus, "pending");
    // An outstanding invitation survives the edit, but the stale token on it
    // does not: it authorizes nothing now that invitations are answered by
    // identity, so it is not worth keeping a copy of.
    assert.equal(createdMembers[1].inviteTokenHash, null);
    assert.equal(createdMembers[2].role, "PLAYER");
    assert.equal(createdMembers[2].inviteStatus, "pending");
    assert.equal(createdMembers[2].inviteTokenHash, null);
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].emailNormalized, "coach@example.com");
    assert.equal(sentInvites[0].invitationId, createdMembers[2].id);
    assert.equal(transactionAttempts, 2);
    assert.equal(registrationMemberUpdates.length, 0);
  } finally {
    restore();
  }
});

test("updateSavedTeam propagates a replacement logo to paid and unpaid registrations", async () => {
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
    logoName: "old-logo.png",
    members: [{ id: "captain-member", role: "CAPTAIN", emailNormalized: user.email }],
  };
  const registrations = [
    { id: "paid-registration", paymentStatus: "paid", teamLogoName: "old-logo.png" },
    { id: "unpaid-registration", paymentStatus: "unpaid", teamLogoName: "old-logo.png" },
  ];
  let savedTeamData;
  let registrationUpdate;
  let scheduledLogo;
  const tx = {
    savedTeam: {
      findUnique: async ({ select }) =>
        select ? { logoName: "old-logo.png" } : {
          ...existingTeam,
          country: "Sri Lanka",
          teamTag: "QF",
          organizationRequested: false,
          organizationName: null,
          logoName: "new-logo.png",
          captainUser: user,
          members: [{ id: "captain-member", role: "CAPTAIN", memberOrder: 0, name: "Quest Captain", email: user.email, inviteStatus: "accepted" }],
          _count: { registrations: 2 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      update: async ({ data }) => {
        savedTeamData = data;
        return { ...existingTeam, ...data };
      },
    },
    teamRegistration: {
      updateMany: async ({ where, data }) => {
        registrationUpdate = { where, data };
        registrations.forEach((registration) => {
          registration.teamLogoName = data.teamLogoName;
        });
        return { count: registrations.length };
      },
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async (callback) => callback(tx),
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      teamLogoDirectory: "uploads/team-logos",
    },
    [uploadCleanupModulePath]: {
      removeUploadsQuietly: async () => undefined,
      scheduleTeamLogoCleanup: async ({ filename }) => {
        scheduledLogo = filename;
      },
    },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await teamService.updateSavedTeam({
      teamId: existingTeam.id,
      user,
      file: { originalname: "new-logo.png" },
      body: {
        name: "Quest Five",
        country: "Sri Lanka",
        teamTag: "QF",
        members: "[]",
      },
    });

    assert.equal(savedTeamData.logoName, "new-logo.png");
    assert.deepEqual(registrationUpdate, {
      where: { savedTeamId: existingTeam.id },
      data: { teamLogoName: "new-logo.png" },
    });
    assert.equal(registrations[0].teamLogoName, "new-logo.png");
    assert.equal(registrations[1].teamLogoName, "new-logo.png");
    assert.equal(scheduledLogo, "old-logo.png");
  } finally {
    restore();
  }
});

test("updateSavedTeam removes a logo without resurrecting a stale snapshot", async () => {
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
    logoName: "stale-logo.png",
    members: [{ id: "captain-member", role: "CAPTAIN", emailNormalized: user.email }],
  };
  const registrations = [{ teamLogoName: "current-logo.png" }];
  let savedTeamData;
  let scheduledLogo;
  const tx = {
    savedTeam: {
      findUnique: async ({ select }) =>
        select ? { logoName: "current-logo.png" } : {
          ...existingTeam,
          country: "Sri Lanka",
          teamTag: "QF",
          organizationRequested: false,
          organizationName: null,
          logoName: null,
          captainUser: user,
          members: [{ id: "captain-member", role: "CAPTAIN", memberOrder: 0, name: "Quest Captain", email: user.email, inviteStatus: "accepted" }],
          _count: { registrations: 1 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      update: async ({ data }) => {
        savedTeamData = data;
        return { ...existingTeam, ...data };
      },
    },
    teamRegistration: {
      updateMany: async ({ data }) => {
        registrations.forEach((registration) => {
          registration.teamLogoName = data.teamLogoName;
        });
      },
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async (callback) => callback(tx),
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [uploadCleanupModulePath]: {
      removeUploadsQuietly: async () => undefined,
      scheduleTeamLogoCleanup: async ({ filename }) => {
        scheduledLogo = filename;
      },
    },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await teamService.updateSavedTeam({
      teamId: existingTeam.id,
      user,
      file: null,
      body: {
        name: "Quest Five",
        country: "Sri Lanka",
        teamTag: "QF",
        removeLogo: "true",
        members: "[]",
      },
    });

    assert.equal(savedTeamData.logoName, null);
    assert.equal(registrations[0].teamLogoName, null);
    assert.equal(scheduledLogo, "current-logo.png");
    assert.notEqual(savedTeamData.logoName, existingTeam.logoName);
  } finally {
    restore();
  }
});

test("updateSavedTeam omits logoName and registration propagation for metadata-only edits", async () => {
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
    logoName: "existing-logo.png",
    members: [{ id: "captain-member", role: "CAPTAIN", emailNormalized: user.email }],
  };
  let savedTeamData;
  let logoReadCount = 0;
  let registrationUpdateCount = 0;
  const scheduledLogos = [];
  const tx = {
    savedTeam: {
      findUnique: async ({ select }) => {
        if (select) logoReadCount += 1;
        return {
          ...existingTeam,
          country: "Sri Lanka",
          teamTag: "QF",
          organizationRequested: false,
          organizationName: null,
          captainUser: user,
          members: [{ id: "captain-member", role: "CAPTAIN", memberOrder: 0, name: "Quest Captain", email: user.email, inviteStatus: "accepted" }],
          _count: { registrations: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      update: async ({ data }) => {
        savedTeamData = data;
        return { ...existingTeam, ...data };
      },
    },
    teamRegistration: {
      updateMany: async () => {
        registrationUpdateCount += 1;
      },
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async (callback) => callback(tx),
      },
    },
    [uploadModulePath]: { persistTeamLogoUpload: async () => null },
    [uploadCleanupModulePath]: {
      scheduleTeamLogoCleanup: async ({ filename }) => scheduledLogos.push(filename),
    },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await teamService.updateSavedTeam({
      teamId: existingTeam.id,
      user,
      file: null,
      body: {
        name: "Quest Six",
        country: "Sri Lanka",
        teamTag: "Q6",
        members: "[]",
      },
    });

    assert.deepEqual(savedTeamData, {
      name: "Quest Six",
      country: "Sri Lanka",
      teamTag: "Q6",
      organizationRequested: false,
    });
    assert.equal(Object.hasOwn(savedTeamData, "logoName"), false);
    assert.equal(logoReadCount, 0);
    assert.equal(registrationUpdateCount, 0);
    assert.deepEqual(scheduledLogos, []);
  } finally {
    restore();
  }
});

test("updateSavedTeam removes a newly persisted upload when the transaction fails", async () => {
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
    logoName: "old-logo.png",
    members: [{ id: "captain-member", role: "CAPTAIN", emailNormalized: user.email }],
  };
  const removedUploads = [];
  const scheduledLogos = [];
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async () => {
          throw new Error("transaction failed");
        },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      teamLogoDirectory: "uploads/team-logos",
    },
    [uploadCleanupModulePath]: {
      removeUploadsQuietly: async (uploads) => removedUploads.push(...uploads),
      scheduleTeamLogoCleanup: async ({ filename }) => scheduledLogos.push(filename),
    },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await assert.rejects(
      teamService.updateSavedTeam({
        teamId: existingTeam.id,
        user,
        file: { originalname: "new-logo.png" },
        body: {
          name: "Quest Five",
          country: "Sri Lanka",
          teamTag: "QF",
          members: "[]",
        },
      }),
      (error) => error.message === "transaction failed"
    );
    assert.deepEqual(removedUploads, [
      { directory: "uploads/team-logos", filename: "new-logo.png" },
    ]);
    assert.deepEqual(scheduledLogos, []);
    assert.equal(existingTeam.logoName, "old-logo.png");
  } finally {
    restore();
  }
});

test("updateSavedTeam preserves its P2002 conflict mapping", async () => {
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
    logoName: "old-logo.png",
    members: [{ id: "captain-member", role: "CAPTAIN", emailNormalized: user.email }],
  };
  class TestPrismaClientKnownRequestError extends Error {}
  const conflict = new TestPrismaClientKnownRequestError(
    "Unique constraint failed.",
  );
  conflict.code = "P2002";
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [generatedPrismaModulePath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError: TestPrismaClientKnownRequestError,
      },
    },
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findFirst: async () => existingTeam },
        $transaction: async (callback) => callback({
          savedTeam: {
            findUnique: async () => ({ logoName: existingTeam.logoName }),
            update: async () => { throw conflict; },
          },
        }),
      },
    },
    [uploadModulePath]: { persistTeamLogoUpload: async () => null },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await assert.rejects(
      teamService.updateSavedTeam({
        teamId: existingTeam.id,
        user,
        file: null,
        body: {
          name: "Quest Five",
          country: "Sri Lanka",
          teamTag: "QF",
          members: "[]",
        },
      }),
      (error) =>
        error.statusCode === 409 &&
        error.message === "A team or member already uses these details."
    );
  } finally {
    restore();
  }
});

test("saved-team parsers reject duplicate coach members", async () => {
  const user = {
    id: "user-1",
    firstName: "Quest",
    lastName: "Captain",
    username: "captain",
    email: "captain@example.com",
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [noticeModulePath]: {},
  });
  const duplicateCoaches = JSON.stringify([
    { role: "COACH", name: "Coach One", email: "coach-one@example.com" },
    { role: "COACH", name: "Coach Two", email: "coach-two@example.com" },
  ]);
  try {
    await assert.rejects(
      teamService.createSavedTeam({
        user,
        file: null,
        body: { name: "Quest Five", country: "Sri Lanka", teamTag: "QF", members: duplicateCoaches },
      }),
      (error) => error.statusCode === 400 && /at most one coach/.test(error.message)
    );
    await assert.rejects(
      teamService.updateSavedTeam({
        teamId: "saved-team-1",
        user,
        file: null,
        body: { name: "Quest Five", country: "Sri Lanka", teamTag: "QF", members: duplicateCoaches },
      }),
      (error) => error.statusCode === 400 && /at most one coach/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("registration coach sync persists a pending invite and dispatches the normal team invite", async () => {
  const savedMembers = [];
  const registrationUpdates = [];
  const teamRegistrationUpdates = [];
  const team = {
    id: "saved-team-1",
    captainUserId: "user-1",
    name: "Quest Five",
    members: [],
  };
  const user = {
    id: "user-1",
    firstName: "Quest",
    lastName: "Captain",
    username: "captain",
    email: "captain@example.com",
  };
  const tx = {
    savedTeam: {
      findUnique: async () => null,
      create: async () => team,
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        savedMembers.push(...data);
        return { count: data.length };
      },
    },
    teamRegistration: {
      update: async ({ data }) => {
        teamRegistrationUpdates.push(data);
        return undefined;
      },
    },
    registrationMember: {
      update: async ({ data }) => {
        registrationUpdates.push(data);
        return undefined;
      },
      findMany: async () => [
        { inviteStatus: "accepted" },
        { inviteStatus: "pending" },
      ],
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [noticeModulePath]: {},
  });

  try {
    const invites = await teamService.syncSavedTeamFromRegistration({
      tx,
      registrationId: "registration-1",
      user,
      teamName: "Quest Five",
      country: "Sri Lanka",
      teamTag: "QF",
      organizationRequested: false,
      logoName: null,
      tournamentTitle: "Quest Cup",
      members: [
        {
          role: "CAPTAIN",
          order: 0,
          name: "Quest Captain",
          email: "captain@example.com",
          discord: "captain",
          riotId: "Captain#001",
        },
        {
          role: "COACH",
          order: 1,
          name: "Team Coach",
          email: "coach@example.com",
          discord: "coach",
          riotId: "Coach#001",
        },
      ],
    });

    const coach = savedMembers.find((member) => member.role === "COACH");
    // The registration collected these because that tournament asked for them.
    // They stay on the registration and in its snapshot; carrying them here
    // would turn one event's answer into a property of the team, reused unasked
    // the next time the same roster enters something for a different game.
    assert.equal(coach.phone, undefined);
    assert.equal(coach.discord, undefined);
    assert.equal(coach.riotId, undefined);
    assert.equal(coach.inviteStatus, "pending");
    assert.equal(coach.inviteTokenHash, null);
    // The deadline outlives the token. An invitation still runs out; what
    // changed is that running out is now a state rather than the quiet
    // disappearance of the only thing that could answer it.
    assert.ok(coach.inviteSentAt instanceof Date);
    assert.ok(coach.inviteExpiresAt instanceof Date);
    assert.equal(registrationUpdates[1].inviteStatus, "pending");
    assert.equal(registrationUpdates[1].inviteTokenHash, null);
    assert.equal(invites.length, 1);
    assert.equal(invites[0].emailNormalized, "coach@example.com");
    // A coach is on the roster to be reachable during an event, so they are
    // invited and must accept exactly like a player.
    assert.equal(invites[0].invitationId, coach.id);
    assert.equal(teamRegistrationUpdates[0].savedTeamId, "saved-team-1");
  } finally {
    restore();
  }
});

test("nudgeTeamInvite reopens an unanswered invitation and enforces its cooldown", async () => {
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
    [noticeModulePath]: noticeMock(sentInvites),
  });

  try {
    const result = await teamService.nudgeTeamInvite({
      teamId: "saved-team-1",
      memberId: member.id,
      user: { id: "user-1" },
      now,
    });
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].emailNormalized, member.emailNormalized);
    assert.equal(sentInvites[0].invitationId, member.id);
    // Nothing is minted to replace it, and the stale hash goes: a nudge points
    // at an invitation that already exists rather than issuing a new one.
    assert.equal(updatedMember.inviteTokenHash, null);
    // What the nudge actually reached, so the captain can be told the truth
    // rather than "invitation sent".
    assert.equal(result.delivery.hasQuestAccount, true);
    assert.equal(result.delivery.inApp, true);
    assert.equal(result.member.inviteSentAt.getTime(), now.getTime());
    assert.equal(
      result.resendAvailableAt.getTime(),
      now.getTime() + 60 * 1000
    );

    member.inviteStatus = "declined";
    member.inviteSentAt = new Date(now.getTime() - 2 * 60 * 1000);
    const renewedDecline = await teamService.nudgeTeamInvite({
      teamId: "saved-team-1",
      memberId: member.id,
      user: { id: "user-1" },
      now,
    });
    assert.equal(renewedDecline.member.inviteStatus, "pending");

    // An invitation that ran out is reopened the same way a declined one is.
    // Both are unanswered spots, and neither is the captain's fault.
    member.inviteStatus = "expired";
    member.inviteSentAt = new Date(now.getTime() - 2 * 60 * 1000);
    const renewedExpiry = await teamService.nudgeTeamInvite({
      teamId: "saved-team-1",
      memberId: member.id,
      user: { id: "user-1" },
      now,
    });
    assert.equal(renewedExpiry.member.inviteStatus, "pending");

    // Accepted is not reopenable: that spot is taken, and a captain must not be
    // able to unseat someone who already said yes by clicking a reminder.
    member.inviteStatus = "accepted";
    member.inviteSentAt = new Date(now.getTime() - 2 * 60 * 1000);
    await assert.rejects(
      teamService.nudgeTeamInvite({
        teamId: "saved-team-1",
        memberId: member.id,
        user: { id: "user-1" },
        now,
      }),
      (error) => error.statusCode === 409,
    );

    member.inviteStatus = "pending";
    member.inviteSentAt = new Date(now.getTime() - 30 * 1000);
    await assert.rejects(
      teamService.nudgeTeamInvite({
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
    [noticeModulePath]: noticeMock(),
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
    [noticeModulePath]: noticeMock(),
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
        valorantTeamBinding: { findFirst: async () => null },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
      teamLogoDirectory: "uploads/team-logos",
    },
    [noticeModulePath]: noticeMock(),
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
    [noticeModulePath]: noticeMock(),
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

test("the last accepted invite approves a free registration when the tournament asks for it", async () => {
  const updateCalls = [];
  const audits = [];
  let registration = {
    id: "registration-1",
    status: "pending",
    entryType: "team",
    paymentStatus: "paid",
    verificationStatus: "pending",
    tournament: { game: "Valorant", autoApproveRegistrations: true },
  };
  const tx = {
    registrationMember: {
      findMany: async () => [{ inviteStatus: "accepted" }],
    },
    teamRegistration: {
      findUnique: async () => registration,
      update: async (args) => {
        updateCalls.push(args);
        registration = { ...registration, ...args.data };
        return { ...registration };
      },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
  });

  try {
    const result = await teamService.refreshRegistrationVerificationStatus({
      tx,
      registrationId: "registration-1",
    });

    assert.equal(result, "verified");
    assert.deepEqual(updateCalls[0].data, { verificationStatus: "verified" });
    assert.deepEqual(updateCalls[1].data, { status: "approved" });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].source, "system");
  } finally {
    restore();
  }
});

test("a verified roster with an outstanding fee is left for the payment to approve", async () => {
  const updateCalls = [];
  const registration = {
    id: "registration-1",
    status: "pending",
    entryType: "team",
    paymentStatus: "unpaid",
    verificationStatus: "pending",
    tournament: { game: "Valorant", autoApproveRegistrations: true },
  };
  const tx = {
    registrationMember: {
      findMany: async () => [{ inviteStatus: "accepted" }],
    },
    teamRegistration: {
      findUnique: async () => registration,
      update: async (args) => {
        updateCalls.push(args);
        return args.data;
      },
    },
    auditLog: { create: async ({ data }) => data },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
  });

  try {
    const result = await teamService.refreshRegistrationVerificationStatus({
      tx,
      registrationId: "registration-1",
    });

    assert.equal(result, "verified");
    assert.equal(updateCalls.length, 1);
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
    [noticeModulePath]: noticeMock(),
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

test("sendTeamInvites announces the roster in one batch and never fails the caller", async () => {
  const batches = [];
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: {
      notifyInvite: async () => { throw new Error("the batch path must not fall back to one at a time"); },
      notifyInvites: async (invites) => {
        batches.push(invites);
        return invites.map(() => ({ inApp: true, discord: false, hasQuestAccount: true }));
      },
    },
  });

  try {
    const invites = [
      { invitationId: "invite-1", emailNormalized: "player1@example.com" },
      { invitationId: "invite-2", emailNormalized: "player2@example.com" },
    ];
    const delivered = await teamService.sendTeamInvites(invites);

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], invites);
    assert.equal(delivered.length, 2);
  } finally {
    restore();
  }
});

// The invitation is already written down by the time the notice goes out, so a
// channel that falls over costs a nudge rather than a roster spot. Letting it
// throw would roll back a team that was created successfully.
test("sendTeamInvites swallows a notice failure", async () => {
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: {
      notifyInvite: async () => undefined,
      notifyInvites: async () => { throw new Error("discord is down"); },
    },
  });

  try {
    assert.deepEqual(
      await teamService.sendTeamInvites([{ invitationId: "invite-1" }]),
      [],
    );
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
    [noticeModulePath]: noticeMock(),
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
        {
          role: "COACH",
          order: 1,
          name: "Coach Example",
          email: "coach@example.com",
          phone: "0771111111",
          discord: "coach#0003",
          riotId: "coach-riot",
        },
      ],
    });

    assert.equal(inviteDispatches.length, 2);
    assert.equal(savedMemberCreateCalls.length, 1);

    const [captainRecord, playerRecord, coachRecord] = savedMemberCreateCalls[0].data;
    assert.equal(captainRecord.userId, "user-1");
    assert.equal(captainRecord.phone, undefined);
    assert.equal(captainRecord.riotId, undefined);
    assert.equal(captainRecord.inviteStatus, "accepted");
    assert.equal(playerRecord.userId, undefined);
    assert.equal(playerRecord.inviteStatus, "pending");
    assert.equal(playerRecord.inviteTokenHash, null);
    assert.equal(inviteDispatches[0].invitationId, playerRecord.id);
    assert.ok(playerRecord.inviteSentAt instanceof Date);
    assert.ok(playerRecord.inviteExpiresAt instanceof Date);
    assert.equal(coachRecord.role, "COACH");
    assert.equal(coachRecord.memberOrder, 1);
    assert.equal(coachRecord.phone, undefined);
    assert.equal(coachRecord.inviteStatus, "pending");
    assert.equal(coachRecord.inviteTokenHash, null);
    assert.equal(inviteDispatches[1].invitationId, coachRecord.id);
    assert.ok(coachRecord.inviteSentAt instanceof Date);
    assert.ok(coachRecord.inviteExpiresAt instanceof Date);

    const expiryDeltaMs =
      playerRecord.inviteExpiresAt.getTime() - playerRecord.inviteSentAt.getTime();
    assert.equal(expiryDeltaMs, 72 * 60 * 60 * 1000);

    assert.equal(registrationMemberUpdateCalls.length, 3);
    assert.equal(registrationMemberUpdateCalls[0].data.userId, "user-1");
    assert.equal(registrationMemberUpdateCalls[0].data.inviteStatus, "accepted");
    assert.equal(registrationMemberUpdateCalls[1].data.inviteStatus, "pending");
    assert.equal(
      registrationMemberUpdateCalls[1].data.inviteTokenHash,
      playerRecord.inviteTokenHash
    );
    assert.equal(registrationMemberUpdateCalls[2].data.inviteStatus, "pending");
    assert.equal(
      registrationMemberUpdateCalls[2].data.inviteTokenHash,
      coachRecord.inviteTokenHash
    );
    assert.equal(inviteDispatches.length, 2);
    assert.deepEqual(teamRegistrationUpdateCalls[0].data, {
      savedTeamId: "saved-team-1",
      teamLogoName: null,
    });
    assert.deepEqual(teamRegistrationUpdateCalls.at(-1).data, {
      verificationStatus: "pending",
    });
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration schedules a newly persisted retry logo for a deliberately cleared team", async () => {
  const savedTeamUpdates = [];
  const registrationUpdates = [];
  const scheduledLogos = [];
  // `logoClearedAt` marks a removal the captain or an admin actually made, so
  // the null logo is canonical and a later registration upload must not
  // resurrect it.
  const existingTeam = {
    id: "saved-team-1",
    logoName: null,
    logoClearedAt: new Date("2026-08-01T00:00:00.000Z"),
    members: [],
  };
  const tx = {
    savedTeam: {
      findUnique: async () => existingTeam,
      update: async (args) => savedTeamUpdates.push(args),
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    teamRegistration: {
      update: async (args) => registrationUpdates.push(args),
    },
    registrationMember: {
      findMany: async () => [],
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
    [uploadCleanupModulePath]: {
      scheduleTeamLogoCleanup: async ({ filename, tx: scheduledTx }) => {
        scheduledLogos.push({ filename, tx: scheduledTx });
      },
    },
  });

  try {
    await teamService.syncSavedTeamFromRegistration({
      tx,
      registrationId: "registration-1",
      user: { id: "captain-1", firstName: "Quest", lastName: "Captain", username: "captain" },
      teamName: "Quest Five",
      logoName: "newly-persisted-retry.webp",
      members: [],
      tournamentTitle: "Quest Cup",
    });

    assert.equal(Object.hasOwn(savedTeamUpdates[0].data, "logoName"), false);
    assert.deepEqual(registrationUpdates[0].data, {
      savedTeamId: "saved-team-1",
      teamLogoName: null,
    });
    assert.deepEqual(scheduledLogos, [{ filename: "newly-persisted-retry.webp", tx }]);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration keeps a newer canonical logo over an older retry snapshot", async () => {
  const savedTeamUpdates = [];
  const registrationUpdates = [];
  const scheduledLogos = [];
  const tx = {
    savedTeam: {
      findUnique: async () => ({ id: "saved-team-1", logoName: "current-logo.webp", members: [] }),
      update: async (args) => savedTeamUpdates.push(args),
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    teamRegistration: { update: async (args) => registrationUpdates.push(args) },
    registrationMember: { findMany: async () => [] },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
    [uploadCleanupModulePath]: {
      scheduleTeamLogoCleanup: async ({ filename, tx: scheduledTx }) => {
        scheduledLogos.push({ filename, tx: scheduledTx });
      },
    },
  });

  try {
    await teamService.syncSavedTeamFromRegistration({
      tx,
      registrationId: "registration-2",
      user: { id: "captain-1", firstName: "Quest", lastName: "Captain", username: "captain" },
      teamName: "Quest Five",
      logoName: "old-retry.png",
      members: [],
      tournamentTitle: "Quest Cup",
    });

    assert.equal(Object.hasOwn(savedTeamUpdates[0].data, "logoName"), false);
    assert.equal(registrationUpdates[0].data.teamLogoName, "current-logo.webp");
    assert.deepEqual(scheduledLogos, [{ filename: "old-retry.png", tx }]);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration aborts relinking when retry-logo cleanup enqueue fails", async () => {
  const registrationUpdates = [];
  const tx = {
    savedTeam: {
      // A deliberately cleared team, so the retry logo is still discarded and
      // its cleanup is the step under test.
      findUnique: async () => ({
        id: "saved-team-1",
        logoName: null,
        logoClearedAt: new Date("2026-08-01T00:00:00.000Z"),
        members: [],
      }),
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    teamRegistration: {
      update: async (args) => registrationUpdates.push(args),
    },
    registrationMember: { findMany: async () => [] },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
    [uploadCleanupModulePath]: {
      scheduleTeamLogoCleanup: async () => {
        throw new Error("cleanup queue unavailable");
      },
    },
  });

  try {
    await assert.rejects(
      teamService.syncSavedTeamFromRegistration({
        tx,
        registrationId: "registration-3",
        user: { id: "captain-1", firstName: "Quest", lastName: "Captain", username: "captain" },
        teamName: "Quest Five",
        logoName: "newly-persisted-retry.webp",
        members: [],
        tournamentTitle: "Quest Cup",
      }),
      /cleanup queue unavailable/
    );
    assert.deepEqual(registrationUpdates, []);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration leaves a live invitation alone instead of announcing it twice", async () => {
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
    [noticeModulePath]: noticeMock(),
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
    assert.equal(savedRows[0].phone, undefined);
    assert.equal(savedRows[0].riotId, undefined);
    // Outstanding because nobody answered it and it has not run out — the
    // deadline is what says so, not a token. Any hash left on the old row is
    // dropped, because it can no longer authorize anything.
    assert.equal(savedRows[0].inviteTokenHash, null);
    assert.equal(registrationUpdates[0].inviteTokenHash, null);
    assert.equal(savedRows[0].inviteStatus, "pending");
    assert.equal(savedRows[0].inviteSentAt, inviteSentAt);
    assert.equal(registrationUpdates[0].inviteExpiresAt, inviteExpiresAt);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration preserves an unlinked accepted source member without inviting", async () => {
  const savedRows = [];
  const registrationUpdates = [];
  const sentInvites = [];
  const inviteRespondedAt = new Date("2026-08-20T10:00:00.000Z");
  const tx = {
    savedTeam: {
      findUnique: async () => null,
      create: async () => ({ id: "saved-team-1", members: [] }),
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        savedRows.push(...data);
        return { count: data.length };
      },
    },
    registrationMember: {
      update: async ({ data }) => {
        registrationUpdates.push(data);
        return data;
      },
      findMany: async () => registrationUpdates.map((data) => ({ inviteStatus: data.inviteStatus })),
    },
    teamRegistration: { update: async ({ data }) => data },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(sentInvites),
  });

  try {
    const dispatches = await teamService.syncSavedTeamFromRegistration({
      tx,
      registrationId: "registration-1",
      user: { id: "captain-1", firstName: "Quest", lastName: "Captain" },
      teamName: "Quest Five",
      members: [
        {
          role: "CAPTAIN",
          order: 0,
          name: "Quest Captain",
          email: "captain@example.com",
        },
        {
          role: "PLAYER",
          order: 1,
          name: "Unlinked Player",
          email: "player@example.com",
          userId: null,
          inviteStatus: "accepted",
          inviteSentAt: new Date("2026-08-19T10:00:00.000Z"),
          inviteExpiresAt: null,
          inviteRespondedAt,
          riotId: "Player#001",
        },
      ],
      tournamentTitle: "Quest Cup",
    });

    const player = savedRows.find((member) => member.role === "PLAYER");
    assert.equal(player.userId, null);
    assert.equal(player.inviteStatus, "accepted");
    assert.equal(player.inviteTokenHash, null);
    assert.equal(player.inviteExpiresAt, null);
    assert.equal(player.inviteRespondedAt, inviteRespondedAt);
    assert.equal(registrationUpdates[1].userId, null);
    assert.equal(registrationUpdates[1].inviteStatus, "accepted");
    assert.deepEqual(dispatches, []);
    assert.deepEqual(sentInvites, []);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration preserves a declined source member without re-inviting", async () => {
  const savedRows = [];
  const registrationUpdates = [];
  const sentInvites = [];
  const inviteRespondedAt = new Date("2026-08-20T11:00:00.000Z");
  const tx = {
    savedTeam: {
      findUnique: async () => null,
      create: async () => ({ id: "saved-team-1", members: [] }),
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        savedRows.push(...data);
        return { count: data.length };
      },
    },
    registrationMember: {
      update: async ({ data }) => {
        registrationUpdates.push(data);
        return data;
      },
      findMany: async () => registrationUpdates.map((data) => ({ inviteStatus: data.inviteStatus })),
    },
    teamRegistration: { update: async ({ data }) => data },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(sentInvites),
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
        name: "Declined Player",
        email: "player@example.com",
        userId: null,
        inviteStatus: "declined",
        inviteSentAt: new Date("2026-08-19T10:00:00.000Z"),
        inviteExpiresAt: null,
        inviteRespondedAt,
      }],
      tournamentTitle: "Quest Cup",
    });

    assert.equal(savedRows[0].userId, null);
    assert.equal(savedRows[0].inviteStatus, "declined");
    assert.equal(savedRows[0].inviteTokenHash, null);
    assert.equal(savedRows[0].inviteExpiresAt, null);
    assert.equal(savedRows[0].inviteRespondedAt, inviteRespondedAt);
    assert.equal(registrationUpdates[0].userId, null);
    assert.equal(registrationUpdates[0].inviteStatus, "declined");
    assert.equal(registrationUpdates[0].inviteTokenHash, null);
    assert.equal(registrationUpdates[0].inviteExpiresAt, null);
    assert.equal(registrationUpdates[0].inviteRespondedAt, inviteRespondedAt);
    assert.deepEqual(dispatches, []);
    assert.deepEqual(sentInvites, []);
  } finally {
    restore();
  }
});

test("syncSavedTeamFromRegistration gives an accepted source member precedence over a linked saved member", async () => {
  const savedRows = [];
  const registrationUpdates = [];
  const existingRespondedAt = new Date("2026-08-19T10:00:00.000Z");
  const sourceRespondedAt = new Date("2026-08-20T12:00:00.000Z");
  const tx = {
    savedTeam: {
      findUnique: async () => ({
        id: "saved-team-1",
        members: [{
          role: "PLAYER",
          memberOrder: 1,
          emailNormalized: "player@example.com",
          userId: "different-linked-user",
          inviteStatus: "accepted",
          inviteSentAt: new Date("2026-08-18T10:00:00.000Z"),
          inviteRespondedAt: existingRespondedAt,
        }],
      }),
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async ({ data }) => {
        savedRows.push(...data);
        return { count: data.length };
      },
    },
    registrationMember: {
      update: async ({ data }) => {
        registrationUpdates.push(data);
        return data;
      },
      findMany: async () => registrationUpdates.map((data) => ({ inviteStatus: data.inviteStatus })),
    },
    teamRegistration: { update: async ({ data }) => data },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [noticeModulePath]: noticeMock(),
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
        name: "Accepted Player",
        email: "player@example.com",
        userId: null,
        inviteStatus: "accepted",
        inviteSentAt: new Date("2026-08-19T11:00:00.000Z"),
        inviteExpiresAt: null,
        inviteRespondedAt: sourceRespondedAt,
      }],
      tournamentTitle: "Quest Cup",
    });

    assert.equal(savedRows[0].userId, null);
    assert.equal(savedRows[0].inviteStatus, "accepted");
    assert.equal(savedRows[0].inviteTokenHash, null);
    assert.equal(savedRows[0].inviteExpiresAt, null);
    assert.equal(savedRows[0].inviteRespondedAt, sourceRespondedAt);
    assert.equal(registrationUpdates[0].userId, null);
    assert.equal(registrationUpdates[0].inviteStatus, "accepted");
    assert.equal(registrationUpdates[0].inviteRespondedAt, sourceRespondedAt);
    assert.deepEqual(dispatches, []);
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
    [noticeModulePath]: noticeMock(),
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

test("activatePaidTeamRegistration uses the current transaction roster invite state", async () => {
  const savedRows = [];
  const registrationUpdates = [];
  const initialRegistration = {
    id: "registration-1",
    entryType: "team",
    paymentStatus: "paid",
    savedTeamId: null,
    teamName: "Quest Five",
    country: "Sri Lanka",
    teamTag: "Q5",
    organizationRequested: false,
    teamLogoName: null,
    user: { id: "captain-1", firstName: "Quest", lastName: "Captain", username: "captain" },
    tournament: { title: "Quest Cup" },
    members: [{
      role: "PLAYER",
      memberOrder: 1,
      name: "Player Two",
      email: "player2@example.com",
      inviteStatus: "pending",
      inviteTokenHash: "stale-token",
      inviteExpiresAt: new Date("2026-08-30T10:00:00.000Z"),
    }],
  };
  const currentMembers = [{
    role: "PLAYER",
    memberOrder: 1,
    name: "Player Two",
    email: "player2@example.com",
    inviteStatus: "accepted",
    userId: null,
    inviteTokenHash: null,
    inviteExpiresAt: null,
    inviteRespondedAt: new Date("2026-08-20T10:00:00.000Z"),
  }];
  const tx = {
    teamRegistration: {
      findUnique: async () => ({
        savedTeamId: null,
        paymentStatus: "paid",
        members: currentMembers,
      }),
      update: async ({ data }) => {
        registrationUpdates.push(data);
        return data;
      },
    },
    savedTeam: {
      findUnique: async () => null,
      create: async () => ({ id: "saved-team-1", members: [] }),
      update: async () => undefined,
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        savedRows.push(...data);
        return { count: data.length };
      },
    },
    registrationMember: {
      update: async () => undefined,
      findMany: async () => currentMembers,
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        teamRegistration: {
          findUnique: async () => initialRegistration,
        },
        $transaction: async (work) => work(tx),
      },
    },
    [noticeModulePath]: {
      notifyInvite: async () => { throw new Error("stale pending roster should not be announced"); },
      notifyInvites: async (invites = []) => {
        if (invites.length > 0) throw new Error("stale pending roster should not be announced");
        return [];
      },
    },
  });

  try {
    await teamService.activatePaidTeamRegistration("registration-1");

    assert.equal(savedRows.length, 1);
    assert.equal(savedRows[0].inviteStatus, "accepted");
    assert.equal(savedRows[0].inviteRespondedAt, currentMembers[0].inviteRespondedAt);
    assert.equal(registrationUpdates[0].savedTeamId, "saved-team-1");
  } finally {
    restore();
  }
});

test("deleteSavedTeam rejects 409 when the team has an active VALORANT binding", async () => {
  const team = { id: "saved-team-1", logoName: null, _count: { registrations: 0 } };
  const prismaMock = {
    prisma: {
      savedTeam: {
        findFirst: async () => team,
        delete: async () => { throw new Error("must not reach delete"); },
      },
      valorantTeamBinding: {
        findFirst: async ({ where }) => (where.savedTeamId === team.id && where.status === "active" ? { id: "binding-1" } : null),
      },
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [noticeModulePath]: noticeMock(),
  });

  try {
    await assert.rejects(
      teamService.deleteSavedTeam({ teamId: "saved-team-1", user: { id: "user-1" } }),
      (error) => error.name === "HttpError" && error.statusCode === 409 && /VALORANT binding/.test(error.message),
    );
  } finally {
    restore();
  }
});

const buildAdoptionHarness = (existingTeam) => {
  const savedTeamUpdates = [];
  const registrationUpdates = [];
  const scheduledLogos = [];
  const createdTeams = [];
  const tx = {
    savedTeam: {
      findUnique: async () => existingTeam,
      create: async ({ data }) => { createdTeams.push(data); return { ...data, members: [] }; },
      update: async (args) => { savedTeamUpdates.push(args); return { ...existingTeam, ...args.data }; },
    },
    savedTeamMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    teamRegistration: { update: async (args) => registrationUpdates.push(args) },
    registrationMember: { findMany: async () => [] },
  };
  const logoUpdate = () => registrationUpdates
    .map((entry) => entry.data)
    .find((data) => Object.prototype.hasOwnProperty.call(data, "teamLogoName"));
  return { tx, savedTeamUpdates, registrationUpdates, scheduledLogos, createdTeams, logoUpdate };
};

const loadAdoptionService = (harness) => loadModuleWithMocks(servicePath, {
  [prismaModulePath]: { prisma: {} },
  [noticeModulePath]: noticeMock(),
  [uploadCleanupModulePath]: {
    scheduleTeamLogoCleanup: async ({ filename }) => { harness.scheduledLogos.push(filename); },
  },
});

const adoptionSyncArguments = (harness, logoName) => ({
  tx: harness.tx,
  registrationId: "registration-1",
  user: { id: "captain-1", firstName: "Quest", lastName: "Captain", username: "captain" },
  teamName: "Quest Five",
  logoName,
  members: [],
  tournamentTitle: "Quest Cup",
});

test("a saved team that has never had a logo adopts the one a registration supplies", async () => {
  const harness = buildAdoptionHarness({
    id: "saved-team-1",
    logoName: null,
    logoClearedAt: null,
    members: [],
  });
  const { module: teamService, restore } = loadAdoptionService(harness);

  try {
    await teamService.syncSavedTeamFromRegistration(adoptionSyncArguments(harness, "first-logo.webp"));

    assert.equal(
      harness.savedTeamUpdates[0].data.logoName,
      "first-logo.webp",
      "the team adopts the logo so every linked projection can render it",
    );
    assert.equal(harness.logoUpdate().teamLogoName, "first-logo.webp");
    assert.deepEqual(harness.scheduledLogos, [], "an adopted logo is never scheduled for deletion");
  } finally {
    restore();
  }
});

test("a saved team with its own logo keeps it and discards the registration upload", async () => {
  const harness = buildAdoptionHarness({
    id: "saved-team-1",
    logoName: "team-logo.webp",
    logoClearedAt: null,
    members: [],
  });
  const { module: teamService, restore } = loadAdoptionService(harness);

  try {
    await teamService.syncSavedTeamFromRegistration(adoptionSyncArguments(harness, "upload.webp"));

    assert.equal(
      Object.hasOwn(harness.savedTeamUpdates[0].data, "logoName"),
      false,
      "an existing saved team logo is authoritative and is never overwritten",
    );
    assert.equal(harness.logoUpdate().teamLogoName, "team-logo.webp");
    assert.deepEqual(harness.scheduledLogos, ["upload.webp"]);
  } finally {
    restore();
  }
});

test("a never-logoed team with no registration upload stays logo-less", async () => {
  const harness = buildAdoptionHarness({
    id: "saved-team-1",
    logoName: null,
    logoClearedAt: null,
    members: [],
  });
  const { module: teamService, restore } = loadAdoptionService(harness);

  try {
    await teamService.syncSavedTeamFromRegistration(adoptionSyncArguments(harness, null));

    assert.equal(Object.hasOwn(harness.savedTeamUpdates[0].data, "logoName"), false);
    assert.equal(harness.logoUpdate().teamLogoName, null);
    assert.deepEqual(harness.scheduledLogos, []);
  } finally {
    restore();
  }
});

test("removing a saved team logo records the removal so it cannot be resurrected", async () => {
  const savedTeamUpdates = [];
  const existingTeam = {
    id: "saved-team-1",
    captainUserId: "captain-1",
    name: "Quest Five",
    logoName: "team-logo.webp",
    logoClearedAt: null,
    members: [],
    registrations: [],
  };
  const captain = {
    id: "captain-1",
    firstName: "Quest",
    lastName: "Captain",
    username: "captain",
    email: "captain@example.com",
  };
  const tx = {
    savedTeam: {
      findUnique: async ({ select }) => (select ? { logoName: "team-logo.webp" } : {
        ...existingTeam,
        country: "Sri Lanka",
        teamTag: "Q5",
        organizationRequested: false,
        organizationName: null,
        logoName: null,
        captainUser: captain,
        members: [{ id: "captain-member", role: "CAPTAIN", memberOrder: 0, name: "Quest Captain", email: captain.email, inviteStatus: "accepted" }],
        _count: { registrations: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: async ({ data }) => { savedTeamUpdates.push(data); return { ...existingTeam, ...data }; },
    },
    savedTeamMember: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    teamRegistration: { updateMany: async () => ({ count: 0 }) },
  };
  const prisma = {
    savedTeam: { findFirst: async () => existingTeam },
    $transaction: async (callback) => callback(tx),
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [noticeModulePath]: noticeMock(),
    [uploadModulePath]: {},
    [uploadCleanupModulePath]: {
      scheduleTeamLogoCleanup: async () => undefined,
      removeUploadsQuietly: async () => undefined,
    },
  });

  try {
    await teamService.updateSavedTeam({
      user: captain,
      teamId: "saved-team-1",
      body: {
        name: "Quest Five",
        country: "Sri Lanka",
        teamTag: "Q5",
        organizationRequested: "false",
        removeLogo: "true",
        members: JSON.stringify([]),
      },
      file: null,
    });

    const cleared = savedTeamUpdates.find((data) => Object.prototype.hasOwnProperty.call(data, "logoName"));
    assert.ok(cleared, "the logo removal is persisted");
    assert.equal(cleared.logoName, null);
    assert.ok(cleared.logoClearedAt instanceof Date, "the removal is timestamped so it reads as deliberate");
  } finally {
    restore();
  }
});

test("roster readiness follows the linked account, not the address the captain typed", async () => {
  const userQueries = [];
  const prismaMock = {
    prisma: {
      savedTeam: {
        findMany: async () => [
          {
            id: "saved-team-1",
            captainUserId: "captain-user",
            name: "Quest Five",
            logoName: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            captainUser: { firstName: "Quest", lastName: "Captain", username: "captain" },
            members: [
              {
                id: "accepted-member",
                userId: "user-2",
                role: "PLAYER",
                memberOrder: 1,
                name: "Accepted Player",
                // They accepted, then changed the address on their account.
                // Resolving by address alone would report them as having no
                // Quest account at all, on a roster they are already on.
                email: "old@example.com",
                discord: "captain-typed-this",
                inviteStatus: "accepted",
              },
              {
                id: "stranger-member",
                userId: null,
                role: "SUBSTITUTE",
                memberOrder: 1,
                name: "No Account Yet",
                email: "nobody@example.com",
                discord: "also-typed",
                inviteStatus: "pending",
              },
            ],
          },
        ],
      },
      user: {
        findMany: async (args) => {
          userQueries.push(args);
          return [
            {
              id: "user-2",
              emailNormalized: "new@example.com",
              emailVerified: true,
              discordTag: "realhandle",
            },
          ];
        },
      },
      oAuthAccount: {
        findMany: async () => [{ userId: "user-2" }],
      },
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [noticeModulePath]: noticeMock(),
  });

  try {
    const [team] = await teamService.listProfileTeams({ user: { id: "captain-user" } });
    const [accepted, stranger] = team.members;

    assert.equal(accepted.hasQuestAccount, true);
    assert.equal(accepted.hasDiscord, true);
    // The handle comes from the connected account. What the captain typed was
    // a guess about somebody else's Discord and could have said anything.
    assert.equal(accepted.discord, "realhandle");
    // The join key is not something the roster publishes.
    assert.equal(accepted.userId, undefined);

    assert.equal(stranger.hasQuestAccount, false);
    assert.equal(stranger.hasDiscord, false);
    // Nothing live to replace it with, so the stored value is left alone rather
    // than blanked: losing data to say nothing helps nobody.
    assert.equal(stranger.discord, "also-typed");

    assert.deepEqual(userQueries[0].where.OR[1], { id: { in: ["user-2"] } });
  } finally {
    restore();
  }
});


// A roster spot is filled by a person saying yes. Nothing here goes looking a
// player up — not on Riot, not on the leaderboard, not on Discord beyond the
// account they connected themselves — because a lookup would put a guess about
// somebody's identity back on the roster by a different route, and this whole
// module exists to stop that. The game identifier a tournament needs is asked
// for by that tournament's own form.
test("nothing in the invitation path looks a player up anywhere", async () => {
  const fs = require("node:fs");
  const moduleDirectory = path.join(__dirname, "../src/modules/teams");

  for (const entry of fs.readdirSync(moduleDirectory).filter((name) => name.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(moduleDirectory, entry), "utf8");
    assert.doesNotMatch(
      source,
      /require\([^)]*(valorant|riot|leaderboard|game-accounts?)[^)]*\)/i,
      `${entry} must not reach for an identity lookup`
    );
  }
});

// The invitation is a row, and every notice is best effort on top of it. That
// only stays true if nothing in this module quietly acquires a mail dependency
// again: the moment a roster spot depends on a delivery, an email that never
// arrives is a spot nobody can take.
test("nothing in the invitation path can enqueue mail", async () => {
  const fs = require("node:fs");
  const moduleDirectory = path.join(__dirname, "../src/modules/teams");
  const sources = fs
    .readdirSync(moduleDirectory)
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => ({
      entry,
      source: fs.readFileSync(path.join(moduleDirectory, entry), "utf8"),
    }));

  assert.ok(sources.length > 0);
  for (const { entry, source } of sources) {
    assert.doesNotMatch(
      source,
      /require\([^)]*(mail|email)[^)]*\)/i,
      `${entry} must not reach for the mail queue`
    );
    assert.doesNotMatch(
      source,
      /EMAIL_TEMPLATE_TYPES|["']teamInvite["']/,
      `${entry} must not name the retired mail template`
    );
  }
});
