const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/match-rooms/match-room.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const notificationPath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const realtimePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");

const loadService = (prisma = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [notificationPath]: { createNotification: async () => null },
  [realtimePath]: { publishRealtimeEvent: () => null },
});

test("room roster promotes captains and staff without duplicate memberships", () => {
  const { module: service, restore } = loadService();
  try {
    const captain = { id: "captain-1" };
    const player = { id: "player-1" };
    const match = {
      assignedStaff: { id: "staff-1" },
      tournament: { staffAssignments: [{ userId: "staff-2" }] },
      participants: [{
        slot: 1,
        registration: {
          user: captain,
          savedTeam: { captainUser: captain, members: [{ role: "PLAYER", user: player }] },
          members: [{ role: "CAPTAIN", user: player }],
        },
      }, { slot: 2, registration: null }],
    };
    const members = service.collectRoomMembers(match);
    assert.deepEqual(members.find((entry) => entry.userId === captain.id), { userId: captain.id, role: "captain", teamSlot: 1 });
    assert.deepEqual(members.find((entry) => entry.userId === player.id), { userId: player.id, role: "captain", teamSlot: 1 });
    assert.equal(members.filter((entry) => entry.userId === captain.id).length, 1);
    assert.equal(members.filter((entry) => entry.role === "staff").length, 2);
  } finally { restore(); }
});

const premierMatch = (overrides = {}) => ({
  id: "match-1",
  tournamentId: "tournament-1",
  status: "scheduled",
  tournament: { id: "tournament-1", game: "Valorant" },
  participants: [
    { slot: 1, registrationId: "registration-1", displayName: "Alpha", seed: 3 },
    { slot: 2, registrationId: "registration-2", displayName: "Bravo", seed: 4 },
  ],
  vetoRoom: null,
  ...overrides,
});

const provisioningPrisma = ({ vetoRoom = null, create, config = null, pool = null, preset = null, missingPreset = false } = {}) => {
  const maps = ["ascent", "bind", "haven", "lotus", "pearl", "split", "sunset"].map((slug, index) => ({
    map: { slug, name: slug[0].toUpperCase() + slug.slice(1), game: "valorant", isActive: true, accentColor: "#8b5cf6" },
    displayOrder: index + 1,
  }));
  const room = vetoRoom || { id: "veto-1", matchId: "match-1", status: "open" };
  return {
    tournamentVetoConfig: { findUnique: async () => config },
    vetoMapPool: { findFirst: async () => pool || ({ id: "pool-1", name: "Quest Standard 7", version: 1, game: "valorant", isBuiltIn: true, isArchived: false, maps }) },
    vetoRulePreset: { findFirst: async ({ where }) => where.format === "premier"
      ? (missingPreset ? null : (preset || { id: "preset-premier", name: "Premier", version: 1, game: "valorant", format: "premier", steps: premierSteps() }))
      : null },
    vetoRoom: {
      create: create || (async () => room),
      findUnique: async () => room,
    },
  };
};

test("match veto provisioning is idempotent and returns an existing linked room", async () => {
  const existing = { id: "existing-veto", status: "completed" };
  let createCount = 0;
  const prisma = provisioningPrisma({ vetoRoom: existing, create: async () => { createCount += 1; return existing; } });
  const { module: service, restore } = loadService(prisma);
  try {
    const match = premierMatch({ vetoRoom: existing });
    assert.equal(await service.ensureMatchVetoRoom({ match, user: { id: "staff-1" } }), existing);
    assert.equal(await service.ensureMatchVetoRoom({ match, user: { id: "staff-1" } }), existing);
    assert.equal(createCount, 0);
  } finally { restore(); }
});

test("match veto provisioning excludes non-Valorant and terminal matches", async () => {
  for (const match of [
    premierMatch({ tournament: { id: "tournament-1", game: "Rocket League" } }),
    premierMatch({ status: "completed" }),
    premierMatch({ status: "cancelled" }),
  ]) {
    let createCount = 0;
    const prisma = provisioningPrisma({ create: async () => { createCount += 1; return null; } });
    const { module: service, restore } = loadService(prisma);
    try {
      assert.equal(await service.ensureMatchVetoRoom({ match, user: { id: "staff-1" } }), null);
      assert.equal(createCount, 0);
    } finally { restore(); }
  }
});

test("eligible Valorant matches receive an open Premier veto with copied participants", async () => {
  let createArgs;
  const prisma = provisioningPrisma({ create: async (args) => {
    createArgs = args;
    return { id: "veto-1", matchId: "match-1", status: "open" };
  } });
  const { module: service, restore } = loadService(prisma);
  try {
    const result = await service.ensureMatchVetoRoom({ match: premierMatch(), user: { id: "staff-1" } });
    assert.equal(result.status, "open");
    assert.equal(createArgs.data.matchId, "match-1");
    assert.equal(createArgs.data.format, "premier");
    assert.equal(createArgs.data.mapPoolId, "pool-1");
    assert.equal(createArgs.data.rulePresetId, "preset-premier");
    assert.deepEqual(createArgs.data.configSnapshot.steps, [
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "decider", actor: null, seriesIndex: 1 },
    ]);
    assert.deepEqual(createArgs.data.participants.create.map(({ slot, registrationId, displayName, seed }) => ({ slot, registrationId, displayName, seed })), [
      { slot: 1, registrationId: "registration-1", displayName: "Alpha", seed: 3 },
      { slot: 2, registrationId: "registration-2", displayName: "Bravo", seed: 4 },
    ]);
  } finally { restore(); }
});

test("match-room access provisions and returns the linked Premier veto", async () => {
  const linkedVeto = { id: "veto-1", code: "premier-room", status: "open", format: "premier", revision: 0 };
  const logoParticipants = [
    {
      id: "participant-1",
      slot: 1,
      registrationId: "registration-1",
      displayName: "Alpha",
      seed: 3,
      score: null,
      result: null,
      registration: {
        user: null,
        savedTeam: { logoName: "replacement.webp", captainUser: null, members: [] },
        members: [],
      },
    },
    {
      id: "participant-2",
      slot: 2,
      registrationId: "registration-2",
      displayName: "Bravo",
      seed: 4,
      score: null,
      result: null,
      registration: {
        user: null,
        teamLogoName: "stale.png",
        savedTeam: { logoName: null, captainUser: null, members: [] },
        members: [],
      },
    },
  ];
  const match = premierMatch({
    assignedStaffId: "staff-1",
    assignedStaff: null,
    tournament: { id: "tournament-1", game: "Valorant", staffAssignments: [] },
    participants: logoParticipants,
  });
  const room = {
    id: "match-room-1",
    code: "match-room",
    matchId: match.id,
    chatLockedAt: null,
    lastMessageAt: null,
    members: [{ userId: "staff-1", id: "member-1", role: "staff", teamSlot: null, mutedUntil: null, user: null }],
    match: {
      ...match,
      identifier: "M1",
      externalId: null,
      scheduledAt: null,
      estimatedAt: null,
      station: null,
      vetoRoom: null,
    },
  };
  let created = false;
  const prisma = provisioningPrisma({ create: async () => {
    created = true;
    room.match.vetoRoom = linkedVeto;
    return linkedVeto;
  } });
  prisma.match = { findUnique: async () => ({
    ...match,
    assignedStaff: null,
    tournament: { id: "tournament-1", game: "Valorant", staffAssignments: [] },
    participants: logoParticipants,
  }) };
  prisma.matchRoom = {
    findUnique: async () => room,
    create: async () => ({ id: room.id, code: room.code }),
  };
  prisma.matchRoomMember = {
    upsert: async () => room.members[0],
    deleteMany: async () => ({ count: 0 }),
  };
  prisma.$transaction = async (callback) => callback(prisma);
  const { module: service, restore } = loadService(prisma);
  try {
    const result = await service.getRoom({ code: room.code, user: { id: "staff-1", role: "player" } });
    assert.equal(created, true);
    assert.deepEqual(result.match.veto, linkedVeto);
    assert.equal(result.access.role, "staff");
    assert.equal(result.match.participants[0].logoUrl, "/api/uploads/team-logos/replacement.webp");
    assert.equal(result.match.participants[1].logoUrl, null);
    logoParticipants[1].registration = {
      user: null,
      teamLogoName: "historical.png",
      savedTeam: null,
      members: [],
    };
    const unlinkedResult = await service.getRoom({ code: room.code, user: { id: "staff-1", role: "player" } });
    assert.equal(unlinkedResult.match.participants[1].logoUrl, "/api/uploads/team-logos/historical.png");
  } finally { restore(); }
});

test("missing persisted Premier preset fails safely without creating a room", async () => {
  let createCount = 0;
  const prisma = provisioningPrisma({ missingPreset: true, create: async () => {
    createCount += 1;
    return null;
  } });
  const { module: service, restore } = loadService(prisma);
  try {
    assert.equal(await service.ensureMatchVetoRoom({ match: premierMatch(), user: { id: "staff-1" } }), null);
    assert.equal(createCount, 0);
  } finally { restore(); }
});

test("a concurrent match veto unique race reloads the linked room", async () => {
  const raced = { id: "raced-veto", matchId: "match-1", status: "open" };
  let createCount = 0;
  const prisma = provisioningPrisma({
    vetoRoom: raced,
    create: async () => {
      createCount += 1;
      const error = new Error("unique matchId");
      error.code = "P2002";
      throw error;
    },
  });
  const { module: service, restore } = loadService(prisma);
  try {
    assert.equal(await service.ensureMatchVetoRoom({ match: premierMatch(), user: { id: "staff-1" } }), raced);
    assert.equal(createCount, 1);
  } finally { restore(); }
});

function premierSteps() {
  return [
    { kind: "ban", actor: "A" },
    { kind: "ban", actor: "B" },
    { kind: "ban", actor: "A" },
    { kind: "ban", actor: "B" },
    { kind: "ban", actor: "A" },
    { kind: "ban", actor: "B" },
    { kind: "decider", actor: null, seriesIndex: 1 },
  ];
}
