const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/veto/veto.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const loadService = () => loadModuleWithMocks(servicePath, { [prismaPath]: { prisma: {} } });

test("built-in veto formats expose complete deterministic series", () => {
  const { module: service, restore } = loadService();
  try {
    for (const [format, played] of [["bo1", 1], ["bo3", 3], ["bo5", 5]]) {
      const steps = service.getBuiltInSteps(format);
      assert.equal(steps.filter((step) => ["pick", "decider"].includes(step.kind)).length, played);
      assert.doesNotThrow(() => service.validateSteps(steps, format, 7));
      assert.equal(steps.at(-1).kind, "side");
    }
    assert.deepEqual(service.getBuiltInSteps("premier"), [
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "ban", actor: "A", seriesIndex: null },
      { kind: "ban", actor: "B", seriesIndex: null },
      { kind: "decider", actor: null, seriesIndex: 1 },
    ]);
  } finally { restore(); }
});

test("Premier validation accepts seven maps and rejects post-decider or extra played maps", () => {
  const { module: service, restore } = loadService();
  try {
    assert.doesNotThrow(() => service.validateSteps(service.getBuiltInSteps("premier"), "premier", 7));
    const incorrectlyAlternated = service.getBuiltInSteps("premier");
    incorrectlyAlternated[1].actor = "A";
    assert.throws(() => service.validateSteps(incorrectlyAlternated, "premier", 7), /Premier ban 2 must be made by Team B/i);
    assert.throws(() => service.validateSteps([
      ...service.getBuiltInSteps("premier"),
      { kind: "ban", actor: "A", seriesIndex: null },
    ], "premier", 7), /manual step can follow/i);
    assert.throws(() => service.validateSteps([
      { kind: "ban", actor: "A" },
      { kind: "ban", actor: "B" },
      { kind: "ban", actor: "A" },
      { kind: "ban", actor: "B" },
      { kind: "ban", actor: "A" },
      { kind: "ban", actor: "B" },
      { kind: "pick", actor: "A", seriesIndex: 1 },
      { kind: "pick", actor: "B", seriesIndex: 2 },
    ], "premier", 7), /requires 1 played map/i);
  } finally { restore(); }
});

test("preset validation rejects non-deterministic and over-sized definitions", () => {
  const { module: service, restore } = loadService();
  try {
    assert.throws(() => service.validateSteps([{ kind: "pick", actor: "A", seriesIndex: 1 }], "bo3", 7), /requires 3 played maps/i);
    assert.throws(() => service.validateSteps([
      { kind: "ban", actor: "A" },
      { kind: "ban", actor: "B" },
      { kind: "pick", actor: "A", seriesIndex: 1 },
    ], "bo1", 2), /consumes more maps/i);
    assert.throws(() => service.validateSteps([{ kind: "side", actor: "C", seriesIndex: 1 }], "custom", 7), /Team A or Team B/i);
    assert.throws(() => service.validateSteps([
      { kind: "ban", actor: "A" },
      { kind: "decider", seriesIndex: 1 },
    ], "bo1", 7), /leave exactly one map/i);
    assert.throws(() => service.validateSteps([
      { kind: "pick", actor: "A", seriesIndex: 1 },
      { kind: "pick", actor: "B", seriesIndex: 1 },
      { kind: "pick", actor: "A", seriesIndex: 3 },
    ], "bo3", 7), /selected more than once/i);
  } finally { restore(); }
});

test("veto access rejects wrong tournament staff, wrong team captains, and expired grants", async () => {
  const room = {
    id: "access-room",
    code: "access-room",
    tournamentId: "tournament-1",
    status: "open",
    controlMode: "staff_only",
    publishResult: false,
    participants: [{ registrationId: "registration-1", slot: 1 }],
    actions: [],
    configSnapshot: { maps: [], steps: [] },
  };
  const prisma = {
    vetoRoom: { findUnique: async () => room },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => {
        if (where.tournamentId === "tournament-1" && where.userId === "staff-admin" && where.role.in.includes("tournament_admin")) return { id: "assignment-admin" };
        if (where.tournamentId === "tournament-2" && where.userId === "wrong-tournament-staff") return { id: "assignment-other" };
        return null;
      },
    },
    teamRegistration: { findMany: async () => [] },
    vetoAccessGrant: { findFirst: async () => ({ expiresAt: new Date(Date.now() - 1000), role: "team_1" }) },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(service.getRoom({ code: room.code, user: { id: "wrong-tournament-staff" }, token: "" }), (error) => error.statusCode === 403);
    room.controlMode = "captain_or_link";
    await assert.rejects(service.getRoom({ code: room.code, user: { id: "wrong-team" }, token: "" }), (error) => error.statusCode === 403);
    room.controlMode = "link_only";
    await assert.rejects(service.getRoom({ code: room.code, user: null, token: "expired-grant" }), (error) => error.statusCode === 401);
  } finally {
    restore();
  }
});

test("veto access permits captain accounts, valid grants, and published completed rooms", async () => {
  const validToken = "valid-grant";
  const validTokenHash = crypto.createHash("sha256").update(validToken).digest("hex");
  const room = {
    id: "access-success-room",
    code: "access-success",
    tournamentId: "tournament-1",
    title: "Captain Room",
    format: "bo1",
    status: "open",
    revision: 1,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 2,
    tossCall: null,
    tossResult: null,
    tossWinnerSlot: null,
    teamASlot: null,
    currentStep: 0,
    turnSeconds: null,
    turnDeadline: null,
    viewerEnabled: true,
    publishResult: false,
    participants: [{ id: "participant-1", slot: 1, registrationId: "registration-1", displayName: "Captain Team", seed: 1, accentColor: "#22d3ee", readyAt: null, joinedAt: null }],
    actions: [],
    configSnapshot: { maps: [], steps: [] },
    tournament: null,
    match: null,
    openedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
  };
  const prisma = {
    vetoRoom: { findUnique: async () => room },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => where.tournamentId === "tournament-1"
        && where.userId === "staff-admin"
        && where.role.in.includes("tournament_admin")
        ? { id: "assignment-admin" }
        : null,
    },
    teamRegistration: { findMany: async ({ where }) => where.OR?.some((entry) => entry.userId === "captain-1") ? [{ id: "registration-1" }] : [] },
    vetoAccessGrant: {
      findFirst: async ({ where }) => where.tokenHash === validTokenHash
        ? { id: "grant-1", role: "team_1", expiresAt: new Date(Date.now() + 60_000) }
        : null,
      update: async () => undefined,
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const tournamentAdmin = await service.getRoom({ code: room.code, user: { id: "staff-admin" }, token: "" });
    assert.equal(tournamentAdmin.access.kind, "staff");
    const captain = await service.getRoom({ code: room.code, user: { id: "captain-1" }, token: "" });
    assert.equal(captain.access.kind, "team");
    assert.equal(captain.access.slot, 1);

    room.controlMode = "link_only";
    const grant = await service.getRoom({ code: room.code, user: null, token: validToken });
    assert.equal(grant.access.kind, "team");
    assert.equal(grant.access.slot, 1);

    room.status = "completed";
    room.publishResult = true;
    const published = await service.getRoom({ code: room.code, user: null, token: "" });
    assert.equal(published.access.kind, "public");
  } finally {
    restore();
  }
});

test("veto access resolves a live caster grant from its hashed token", async () => {
  const room = {
    id: "caster-room",
    code: "caster-room",
    tournamentId: "tournament-1",
    status: "open",
    controlMode: "link_only",
    publishResult: false,
    participants: [],
    actions: [],
    configSnapshot: { maps: [], steps: [] },
  };
  const casterTokenHash = crypto.createHash("sha256").update("caster-grant").digest("hex");
  const prisma = {
    vetoRoom: { findUnique: async () => room },
    tournamentStaffAssignment: { findFirst: async () => null },
    teamRegistration: { findMany: async () => [] },
    vetoAccessGrant: {
      findFirst: async ({ where }) => where.tokenHash === casterTokenHash
        ? { id: "caster-grant-1", role: "caster", expiresAt: new Date(Date.now() + 60_000) }
        : null,
      update: async () => undefined,
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.getRoom({ code: room.code, user: null, token: "caster-grant" });
    assert.deepEqual(result.access, { kind: "caster", slot: null });
  } finally { restore(); }
});

test("an authorized slot-2 captain cannot submit slot-1's current veto action", async () => {
  const room = {
    id: "wrong-turn-room",
    code: "wrong-turn",
    tournamentId: "tournament-1",
    status: "in_progress",
    revision: 0,
    controlMode: "captain_or_link",
    teamASlot: 1,
    currentStep: 0,
    configSnapshot: {
      maps: [{ slug: "ascent", name: "Ascent" }],
      steps: [{ kind: "ban", actor: "A", seriesIndex: null }],
    },
    participants: [
      { registrationId: "registration-1", slot: 1 },
      { registrationId: "registration-2", slot: 2 },
    ],
    actions: [],
  };
  let transactionCalls = 0;
  const prisma = {
    vetoRoom: { findUnique: async () => room },
    tournamentStaffAssignment: { findFirst: async () => null },
    teamRegistration: {
      findMany: async ({ where }) => where.OR?.some((entry) => entry.userId === "captain-2")
        ? [{ id: "registration-2" }]
        : [],
    },
    $transaction: async () => {
      transactionCalls += 1;
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(
      service.submitAction({
        code: room.code,
        user: { id: "captain-2" },
        token: "",
        body: { mapSlug: "ascent", expectedRevision: 0 },
      }),
      (error) => error.statusCode === 403 && /not your team’s turn/.test(error.message),
    );
    assert.equal(transactionCalls, 0);
  } finally {
    restore();
  }
});

test("the toss winner's position choice starts the veto immediately", async () => {
  const room = {
    id: "room-1",
    code: "clean-flow",
    tournamentId: null,
    matchId: null,
    title: "Team One vs Team Two",
    format: "bo1",
    status: "toss_pending",
    revision: 4,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 2,
    tossCall: "heads",
    tossResult: "heads",
    tossWinnerSlot: 2,
    teamASlot: null,
    currentStep: 0,
    turnSeconds: 45,
    turnDeadline: null,
    viewerEnabled: false,
    publishResult: false,
    configSnapshot: { maps: [], steps: [{ kind: "ban", actor: "A", seriesIndex: null }] },
    participants: [
      { id: "participant-1", slot: 1, displayName: "Team One", accentColor: "#22d3ee", readyAt: new Date(), joinedAt: new Date() },
      { id: "participant-2", slot: 2, displayName: "Team Two", accentColor: "#fb7185", readyAt: new Date(), joinedAt: new Date() },
    ],
    actions: [],
    tournament: null,
    match: null,
    openedAt: new Date(),
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
  };
  let updateData = null;
  const prisma = {
    vetoRoom: {
      findUnique: async () => room,
      updateMany: async ({ data }) => {
        updateData = data;
        Object.assign(room, { ...data, revision: room.revision + 1 });
        return { count: 1 };
      },
    },
    $transaction: async (callback) => callback(prisma),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.chooseTeamA({
      code: room.code,
      user: { id: "admin-1", role: "admin" },
      token: "",
      body: { choice: "A", expectedRevision: 4 },
    });
    assert.equal(updateData.status, "in_progress");
    assert.equal(updateData.teamASlot, 2);
    assert.ok(updateData.startedAt instanceof Date);
    assert.ok(updateData.turnDeadline instanceof Date);
    assert.equal(result.status, "in_progress");
    assert.equal(result.toss.teamASlot, 2);
  } finally { restore(); }
});

test("Premier automatically selects the last map and completes after six bans", async () => {
  const maps = ["ascent", "bind", "breeze", "icebox", "lotus", "sunset", "haven"].map((slug) => ({ slug, name: slug }));
  const room = {
    id: "premier-room",
    code: "premier-flow",
    tournamentId: null,
    matchId: null,
    title: "Premier Match",
    format: "premier",
    status: "in_progress",
    revision: 0,
    controlMode: "captain_or_link",
    teamOrderMethod: "slot_order",
    tossMethod: "digital",
    tossCallerSlot: 2,
    tossCall: null,
    tossResult: null,
    tossWinnerSlot: null,
    teamASlot: 1,
    currentStep: 5,
    turnSeconds: null,
    turnDeadline: null,
    viewerEnabled: false,
    publishResult: false,
    configSnapshot: { maps, steps: serviceSteps() },
    participants: [],
    actions: [0, 1, 2, 3, 4].map((index) => ({
      sequence: index + 1,
      kind: "ban",
      actorSlot: index % 2 ? 2 : 1,
      mapSlug: maps[index].slug,
      mapName: maps[index].name,
      side: null,
      payload: { seriesIndex: null },
      invalidatedAt: null,
    })),
    tournament: null,
    match: null,
    openedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
  };
  let createdAction = null;
  let updateData = null;
  const prisma = {
    vetoRoom: {
      findUnique: async () => room,
      updateMany: async ({ data }) => {
        Object.assign(room, data, { revision: room.revision + 1 });
        return { count: 1 };
      },
      update: async ({ data }) => {
        updateData = data;
        Object.assign(room, data);
        return room;
      },
    },
    vetoRoomAction: {
      create: async ({ data }) => {
        createdAction = data;
        return data;
      },
    },
    vetoAccessGrant: { updateMany: async () => ({ count: 0 }) },
    match: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback) => callback(prisma),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.submitAction({
      code: room.code,
      user: { id: "admin-1", role: "admin" },
      token: "",
      body: { mapSlug: maps[5].slug, expectedRevision: 0 },
    });
    assert.deepEqual(createdAction, {
      roomId: room.id,
      sequence: 7,
      kind: "decider",
      mapSlug: maps[6].slug,
      mapName: maps[6].name,
      payload: { seriesIndex: 1 },
    });
    assert.equal(updateData.currentStep, 7);
    assert.equal(updateData.status, "completed");
    assert.equal(result.status, "completed");
    assert.equal(result.currentStep, 7);
    assert.equal(result.actions.at(-1).kind, "decider");
    assert.equal(result.actions.some((action) => action.kind === "side"), false);
  } finally { restore(); }
});

function serviceSteps() {
  return [
    { kind: "ban", actor: "A", seriesIndex: null },
    { kind: "ban", actor: "B", seriesIndex: null },
    { kind: "ban", actor: "A", seriesIndex: null },
    { kind: "ban", actor: "B", seriesIndex: null },
    { kind: "ban", actor: "A", seriesIndex: null },
    { kind: "ban", actor: "B", seriesIndex: null },
    { kind: "decider", actor: null, seriesIndex: 1 },
  ];
}

test("admin can enable and disable a map without touching rooms or snapshots", async () => {
  const map = {
    id: "map-1",
    slug: "ascent",
    name: "Ascent",
    isActive: true,
    artworkUrl: null,
    accentColor: "#d6a568",
  };
  const roomSnapshot = { maps: [{ slug: "ascent", name: "Ascent" }] };
  let updateArgs = null;
  const prisma = {
    vetoMap: {
      findUnique: async () => map,
      update: async (args) => {
        updateArgs = args;
        map.isActive = args.data.isActive;
        return map;
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const disabled = await service.updateMapAvailability({ user: { id: "admin-1", role: "admin" }, mapId: map.id, isActive: false });
    assert.equal(disabled.isActive, false);
    assert.deepEqual(updateArgs, { where: { id: map.id }, data: { isActive: false } });
    assert.deepEqual(roomSnapshot, { maps: [{ slug: "ascent", name: "Ascent" }] });
    const enabled = await service.updateMapAvailability({ user: { id: "admin-1", role: "admin" }, mapId: map.id, isActive: true });
    assert.equal(enabled.isActive, true);
  } finally { restore(); }
});

test("createMap accepts project-relative artwork paths and rejects remote artwork", async () => {
  const created = [];
  const prisma = {
    vetoMap: {
      create: async ({ data }) => {
        created.push(data);
        return data;
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const uploadArtwork = await service.createMap({ user: { id: "admin-1", role: "admin" }, body: { name: "Ascent", artworkUrl: "  /api/uploads/maps/ascent.webp  " } });
    const imageArtwork = await service.createMap({ user: { id: "admin-1", role: "admin" }, body: { name: "Bind", artworkUrl: "/images/maps/bind.webp" } });
    const noArtwork = await service.createMap({ user: { id: "admin-1", role: "admin" }, body: { name: "Haven" } });
    assert.equal(uploadArtwork.artworkUrl, "/api/uploads/maps/ascent.webp");
    assert.equal(imageArtwork.artworkUrl, "/images/maps/bind.webp");
    assert.equal(noArtwork.artworkUrl, null);

    for (const artworkUrl of [
      "http://example.com/ascent.webp",
      "https://example.com/bind.webp",
      "//example.com/haven.webp",
      "data:image/png;base64,abc",
      "maps/ascent.webp",
      "/other-assets/ascent.webp",
    ]) {
      await assert.rejects(
        () => service.createMap({ user: { id: "admin-1", role: "admin" }, body: { name: "Invalid Map", artworkUrl } }),
        { statusCode: 400 },
      );
    }
    assert.equal(created.length, 3);
  } finally { restore(); }
});

test("manually created Premier rooms reject pools with anything other than seven active Valorant maps", async () => {
  const maps = (count) => Array.from({ length: count }, (_, index) => ({
    map: { slug: `map-${index + 1}`, name: `Map ${index + 1}`, game: "valorant", isActive: true },
    displayOrder: index,
  }));
  let createCount = 0;
  const prisma = {
    vetoMapPool: { findUnique: async () => ({ id: "pool-1", name: "Premier pool", version: 1, game: "valorant", tournamentId: null, maps: maps(8) }) },
    vetoRulePreset: { findUnique: async () => ({ id: "preset-1", name: "Premier", version: 1, format: "premier", tournamentId: null, steps: [] }) },
    $transaction: async () => {
      createCount += 1;
      return null;
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(
      () => service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { format: "premier", mapPoolId: "pool-1", rulePresetId: "preset-1" } }),
      { statusCode: 400, message: "Premier rooms require exactly seven active Valorant maps." },
    );
    assert.equal(createCount, 0);
  } finally { restore(); }
});

test("manually created Premier rooms accept exactly seven active Valorant maps and store the canonical sequence", async () => {
  const maps = Array.from({ length: 7 }, (_, index) => ({
    map: { slug: `map-${index + 1}`, name: `Map ${index + 1}`, game: "valorant", isActive: true },
    displayOrder: index,
  }));
  let createArgs = null;
  const prisma = {
    vetoMapPool: { findUnique: async () => ({ id: "pool-1", name: "Premier pool", version: 1, game: "valorant", tournamentId: null, maps }) },
    vetoRulePreset: { findUnique: async () => ({ id: "preset-1", name: "Premier", version: 1, format: "premier", tournamentId: null, steps: [{ kind: "ban", actor: "B" }] }) },
    $transaction: async (callback) => callback({
      vetoRoom: {
        create: async ({ data }) => {
          createArgs = { data };
          return {
            ...data,
            participants: data.participants.create,
            actions: [],
            tournament: null,
            match: null,
          };
        },
      },
    }),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { format: "premier", mapPoolId: "pool-1", rulePresetId: "preset-1" } });
    assert.equal(result.room.format, "premier");
    assert.ok(result.issuedTokens.caster);
    assert.ok(createArgs.data.grants.create.some((grant) => grant.role === "caster"));
    assert.deepEqual(createArgs.data.configSnapshot.steps, service.getBuiltInSteps("premier"));
    assert.equal(createArgs.data.configSnapshot.maps.length, 7);
  } finally { restore(); }
});

test("linked Valorant rooms use match participants and snapshot registration logos", async () => {
  const match = {
    id: "match-valorant",
    tournamentId: "tournament-valorant",
    status: "scheduled",
    tournament: { id: "tournament-valorant", title: "Valorant Cup", game: "Valorant" },
    participants: [
      {
        slot: 1,
        registrationId: "registration-alpha",
        displayName: "Alpha",
        seed: 1,
        registration: { id: "registration-alpha", teamName: "Alpha", teamLogoName: "alpha.svg", savedTeam: null },
      },
      {
        slot: 2,
        registrationId: "registration-bravo",
        displayName: "Bravo",
        seed: null,
        registration: { id: "registration-bravo", teamName: "Bravo", teamLogoName: "old.svg", savedTeam: { logoName: "bravo.svg" } },
      },
    ],
    vetoRoom: null,
  };
  const maps = Array.from({ length: 7 }, (_, index) => ({
    displayOrder: index,
    map: { slug: `valorant-map-${index + 1}`, name: `Valorant Map ${index + 1}`, game: "Valorant", artworkUrl: null, accentColor: "#8b5cf6", isActive: true },
  }));
  const created = [];
  const prisma = {
    match: { findUnique: async () => match },
    tournamentStaffAssignment: { findFirst: async () => ({ id: "assignment-1" }) },
    vetoMapPool: { findUnique: async () => ({ id: "pool-valorant", name: "Valorant Seven", version: 1, game: "Valorant", tournamentId: null, maps }) },
    vetoRulePreset: { findUnique: async () => ({ id: "preset-bo1", name: "BO1", version: 1, format: "bo1", steps: [
      ...serviceSteps().slice(0, 6),
      { kind: "decider", actor: null, seriesIndex: 1 },
      { kind: "side", actor: "A", seriesIndex: 1 },
    ] }) },
    $transaction: async (callback) => callback({
      vetoRoom: {
        create: async ({ data }) => {
          created.push(data);
          return { ...data, participants: data.participants.create, actions: [], tournament: match.tournament, match };
        },
      },
    }),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.createRoom({
      user: { id: "admin-1", role: "admin" },
      body: {
        matchId: match.id,
        format: "bo1",
        mapPoolId: "pool-valorant",
        rulePresetId: "preset-bo1",
        participants: [{ displayName: "Client replacement", seed: 99 }, { displayName: "Another replacement" }],
      },
    });
    assert.equal(result.room.participants[0].displayName, "Alpha");
    assert.equal(result.room.participants[1].seed, null);
    assert.equal(created[0].configSnapshot.participants[0].logoUrl, "/api/uploads/team-logos/alpha.svg");
    assert.equal(created[0].configSnapshot.participants[1].logoUrl, "/api/uploads/team-logos/bravo.svg");
    assert.equal(created[0].configSnapshot.participants[1].seed, null);
    assert.equal(result.room.participants[0].logoUrl, "/api/uploads/team-logos/alpha.svg");
  } finally { restore(); }
});

test("linked rooms reject non-Valorant matches, incomplete participants, and non-Valorant pools without transactions", async () => {
  const baseMatch = {
    id: "match-linked",
    tournamentId: "tournament-linked",
    status: "scheduled",
    tournament: { id: "tournament-linked", title: "Linked Cup", game: "Valorant" },
    participants: [
      { slot: 1, registrationId: "registration-1", displayName: "Alpha", seed: 1, registration: null },
      { slot: 2, registrationId: "registration-2", displayName: "Bravo", seed: 2, registration: null },
    ],
    vetoRoom: null,
  };
  const maps = Array.from({ length: 7 }, (_, index) => ({
    displayOrder: index,
    map: { slug: `map-${index + 1}`, name: `Map ${index + 1}`, game: "Valorant", isActive: true },
  }));
  let currentMatch = baseMatch;
  let currentPool = { id: "pool-1", name: "Pool", version: 1, game: "Valorant", tournamentId: null, maps };
  let transactionCalls = 0;
  const prisma = {
    match: { findUnique: async () => currentMatch },
    tournamentStaffAssignment: { findFirst: async () => ({ id: "assignment-1" }) },
    vetoMapPool: { findUnique: async () => currentPool },
    vetoRulePreset: { findUnique: async () => ({ id: "preset-1", name: "BO1", version: 1, format: "bo1", steps: [
      ...serviceSteps().slice(0, 6),
      { kind: "decider", actor: null, seriesIndex: 1 },
      { kind: "side", actor: "A", seriesIndex: 1 },
    ] }) },
    $transaction: async () => { transactionCalls += 1; },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  const body = { matchId: baseMatch.id, format: "bo1", mapPoolId: "pool-1", rulePresetId: "preset-1" };
  try {
    currentMatch = { ...baseMatch, tournament: { ...baseMatch.tournament, game: "CS2" } };
    await assert.rejects(() => service.createRoom({ user: { id: "admin-1", role: "admin" }, body }), { statusCode: 400 });

    currentMatch = { ...baseMatch, participants: [baseMatch.participants[0]] };
    await assert.rejects(() => service.createRoom({ user: { id: "admin-1", role: "admin" }, body }), { statusCode: 400 });

    currentMatch = baseMatch;
    currentPool = { ...currentPool, game: "CS2" };
    await assert.rejects(() => service.createRoom({ user: { id: "admin-1", role: "admin" }, body }), { statusCode: 400 });

    currentPool = { ...currentPool, game: "Valorant", maps: [...maps.slice(0, 6), { displayOrder: 6, map: { ...maps[6].map, game: "CS2" } }] };
    await assert.rejects(() => service.createRoom({ user: { id: "admin-1", role: "admin" }, body }), { statusCode: 400 });

    currentPool = { ...currentPool, game: "CS2" };
    await assert.rejects(() => service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { ...body, matchId: null } }), { statusCode: 400 });
    assert.equal(transactionCalls, 0);
  } finally { restore(); }
});

test("linked rooms reject unsupported formats and terminal matches before creating a room", async () => {
  const match = {
    id: "match-ineligible",
    tournamentId: "tournament-linked",
    status: "scheduled",
    tournament: { id: "tournament-linked", title: "Linked Cup", game: "Valorant" },
    participants: [
      { slot: 1, registrationId: "registration-1", displayName: "Alpha", seed: 1, registration: null },
      { slot: 2, registrationId: "registration-2", displayName: "Bravo", seed: 2, registration: null },
    ],
    vetoRoom: null,
  };
  const maps = Array.from({ length: 7 }, (_, index) => ({
    displayOrder: index,
    map: { slug: `map-${index + 1}`, name: `Map ${index + 1}`, game: "Valorant", isActive: true },
  }));
  let currentMatch = match;
  let transactionCalls = 0;
  const prisma = {
    match: { findUnique: async () => currentMatch },
    tournamentStaffAssignment: { findFirst: async () => ({ id: "assignment-1" }) },
    vetoMapPool: { findUnique: async () => ({ id: "pool-1", name: "Pool", version: 1, game: "Valorant", tournamentId: null, maps }) },
    vetoRulePreset: { findUnique: async ({ where }) => ({ id: where.id, name: where.id, version: 1, format: where.id === "preset-premier" ? "premier" : where.id === "preset-custom" ? "custom" : "bo1", steps: serviceSteps() }) },
    $transaction: async () => { transactionCalls += 1; },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    for (const format of ["premier", "custom"]) {
      await assert.rejects(
        () => service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { matchId: match.id, format, mapPoolId: "pool-1", rulePresetId: `preset-${format}` } }),
        { statusCode: 400 },
      );
    }
    currentMatch = { ...match, status: "completed" };
    await assert.rejects(
      () => service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { matchId: match.id, format: "bo1", mapPoolId: "pool-1", rulePresetId: "preset-bo1" } }),
      { statusCode: 400 },
    );
    assert.equal(transactionCalls, 0);
  } finally { restore(); }
});

test("linked room duplicate keeps the existing 409 contract", async () => {
  let transactionCalls = 0;
  const prisma = {
    match: { findUnique: async () => ({ id: "match-duplicate", tournamentId: "tournament-1", vetoRoom: { id: "room-existing" } }) },
    $transaction: async () => { transactionCalls += 1; },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(
      () => service.createRoom({ user: { id: "admin-1", role: "admin" }, body: { matchId: "match-duplicate" } }),
      { statusCode: 409, message: "This match already has a veto room." },
    );
    assert.equal(transactionCalls, 0);
  } finally { restore(); }
});

test("old veto room snapshots map missing participant logos to null", () => {
  const { module: service, restore } = loadService();
  try {
    const room = service.mapRoom({
      id: "old-room",
      participants: [{ id: "participant-1", slot: 1, registrationId: null, displayName: "Alpha", seed: 1, accentColor: "#22d3ee" }],
      actions: [],
      configSnapshot: { maps: [], steps: [] },
    });
    assert.equal(room.participants[0].logoUrl, null);
  } finally { restore(); }
});

test("caster access grants can be rotated", async () => {
  const grants = [];
  const room = { id: "rotate-room", tournamentId: null };
  const prisma = {
    vetoRoom: { findUnique: async () => room },
    vetoAccessGrant: {
      updateMany: async ({ where }) => { grants.push({ operation: "revoke", where }); return { count: 1 }; },
      create: async ({ data }) => { grants.push({ operation: "create", data }); return data; },
    },
    $transaction: async (callback) => callback(prisma),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.rotateGrant({ user: { id: "admin-1", role: "admin" }, roomId: room.id, role: "caster" });
    assert.equal(result.role, "caster");
    assert.ok(result.token);
    assert.equal(grants[0].where.role, "caster");
    assert.equal(grants[1].data.role, "caster");
  } finally { restore(); }
});

test("map availability rejects non-admins and non-boolean input", async () => {
  let findCount = 0;
  const prisma = { vetoMap: { findUnique: async () => { findCount += 1; return { id: "map-1" }; } } };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(() => service.updateMapAvailability({ user: { id: "staff-1", role: "user" }, mapId: "map-1", isActive: false }), { statusCode: 403 });
    await assert.rejects(() => service.updateMapAvailability({ user: { id: "admin-1", role: "admin" }, mapId: "map-1", isActive: "false" }), { statusCode: 400 });
    assert.equal(findCount, 0);
  } finally { restore(); }
});

test("map availability returns 404 for an unknown map", async () => {
  const prisma = { vetoMap: { findUnique: async () => null } };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await assert.rejects(() => service.updateMapAvailability({ user: { id: "admin-1", role: "admin" }, mapId: "missing-map", isActive: false }), { statusCode: 404 });
  } finally { restore(); }
});

test("catalog exposes inactive maps but only active maps in future pool choices", async () => {
  const active = { id: "map-1", slug: "ascent", name: "Ascent", isActive: true };
  const inactive = { id: "map-2", slug: "bind", name: "Bind", isActive: false };
  let poolQuery = null;
  const prisma = {
    vetoMap: { findMany: async () => [active, inactive] },
    vetoMapPool: { findMany: async (args) => { poolQuery = args; return [{ id: "pool-1", maps: [{ map: active }] }]; } },
    vetoRulePreset: { findMany: async () => [] },
    vetoRoomTemplate: { findMany: async () => [] },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const catalog = await service.listCatalog();
    assert.deepEqual(catalog.maps, [active, inactive]);
    assert.deepEqual(catalog.pools[0].maps, [active]);
    assert.deepEqual(poolQuery.include.maps.where, { map: { isActive: true } });
  } finally { restore(); }
});

test("new map pool versions reject inactive map IDs while preserving version lookup", async () => {
  let latestQuery = null;
  let createArgs = null;
  const prisma = {
    vetoMap: { findMany: async () => [{ id: "map-1" }] },
    vetoMapPool: {
      findFirst: async (args) => { latestQuery = args; return { version: 3 }; },
      create: async (args) => { createArgs = args; return args.data; },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await service.createPool({ user: { id: "admin-1", role: "admin" }, body: { name: "Quest Standard 7", mapIds: ["map-1"], tournamentId: "tournament-1" } });
    assert.equal(result.version, 4);
    assert.deepEqual(latestQuery.where, { name: "Quest Standard 7", tournamentId: "tournament-1" });
    assert.deepEqual(createArgs.data.maps.create, [{ mapId: "map-1", displayOrder: 0 }]);
  } finally { restore(); }

  const inactivePrisma = { vetoMap: { findMany: async () => [] } };
  const inactiveLoaded = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma: inactivePrisma } });
  try {
    await assert.rejects(() => inactiveLoaded.module.createPool({ user: { id: "admin-1", role: "admin" }, body: { name: "New pool", mapIds: ["map-2"] } }), { statusCode: 400 });
  } finally { inactiveLoaded.restore(); }
});

test("staff public veto choice fails closed on audit failure while captain paths remain best effort", async () => {
  const room = {
    id: "room-audit",
    code: "audit-flow",
    tournamentId: null,
    matchId: null,
    status: "toss_pending",
    revision: 1,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 1,
    tossWinnerSlot: 1,
    teamASlot: null,
    turnSeconds: null,
    configSnapshot: { maps: [], steps: [] },
    participants: [{ slot: 1, registrationId: "registration-1" }, { slot: 2, registrationId: "registration-2" }],
    actions: [],
    tournament: null,
    match: null,
  };
  const prisma = {
    vetoRoom: {
      findUnique: async () => room,
      updateMany: async () => ({ count: 1 }),
    },
    tournamentStaffAssignment: { findFirst: async () => null },
    teamRegistration: { findMany: async () => [] },
    match: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback) => callback(prisma),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [auditPath]: { recordAuditInTransaction: async () => { throw new Error("veto audit unavailable"); } },
  });
  try {
    await assert.rejects(
      service.chooseTeamA({
        code: room.code,
        user: { id: "admin-1", role: "admin" },
        token: "",
        body: { choice: "A", expectedRevision: 1 },
        auditContext: { actorUserId: "admin-1", requestId: "req-veto", ipAddress: "127.0.0.1" },
      }),
      /veto audit unavailable/,
    );
  } finally { restore(); }
});

test("captain veto choice does not fail when optional staff audit context is unavailable", async () => {
  const room = {
    id: "room-captain-audit",
    code: "captain-audit-flow",
    tournamentId: null,
    matchId: null,
    status: "toss_pending",
    revision: 1,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 1,
    tossWinnerSlot: 1,
    teamASlot: null,
    turnSeconds: null,
    configSnapshot: { maps: [], steps: [] },
    participants: [{ slot: 1, registrationId: "registration-1" }, { slot: 2, registrationId: "registration-2" }],
    actions: [],
    tournament: null,
    match: null,
  };
  let auditCalls = 0;
  const prisma = {
    vetoRoom: {
      findUnique: async () => room,
      updateMany: async ({ data }) => { Object.assign(room, data, { revision: room.revision + 1 }); return { count: 1 }; },
    },
    tournamentStaffAssignment: { findFirst: async () => null },
    teamRegistration: { findMany: async ({ where }) => where.OR?.some((entry) => entry.userId === "captain-1") ? [{ id: "registration-1" }] : [] },
    match: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (callback) => callback(prisma),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [auditPath]: { recordAuditInTransaction: async () => { auditCalls += 1; throw new Error("optional audit unavailable"); } },
  });
  try {
    const result = await service.chooseTeamA({
      code: room.code,
      user: { id: "captain-1", role: "user" },
      token: "",
      body: { choice: "A", expectedRevision: 1 },
      auditContext: { actorUserId: "captain-1", requestId: "req-captain", ipAddress: "127.0.0.1" },
    });
    assert.equal(result.status, "in_progress");
    assert.equal(auditCalls, 0, "captain self-service does not invoke staff audit telemetry");
  } finally { restore(); }
});

test("veto catalog writes enforce global super-admin and tournament-admin roles in the service", async () => {
  const writes = [];
  const prisma = {
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => where.userId === "tournament-admin"
        && where.tournamentId === "tournament-1"
        && where.role.in.includes("tournament_admin")
        ? { id: "assignment-1" }
        : null,
    },
    vetoMap: {
      findMany: async () => [{ id: "map-1" }],
    },
    vetoMapPool: {
      findFirst: async () => ({ version: 1 }),
      create: async ({ data }) => { writes.push(["pool", data]); return data; },
      findUnique: async ({ where }) => where.id === "global-pool" ? { tournamentId: null } : null,
    },
    vetoRulePreset: {
      findFirst: async () => ({ version: 1 }),
      create: async ({ data }) => { writes.push(["preset", data]); return data; },
      findUnique: async ({ where }) => where.id === "global-preset" ? { tournamentId: null, format: "bo1" } : null,
    },
    vetoRoomTemplate: {
      findFirst: async () => ({ version: 1 }),
      create: async ({ data }) => { writes.push(["template", data]); return data; },
    },
    tournamentVetoConfig: {
      upsert: async ({ create }) => { writes.push(["config", create]); return create; },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const globalBody = { name: "Global Catalog", mapIds: ["map-1"] };
    await assert.rejects(() => service.createPool({ user: { id: "user-1", role: "user" }, body: globalBody }), { statusCode: 403 });
    await assert.rejects(() => service.createPreset({ user: { id: "user-1", role: "user" }, body: { name: "Global Preset", format: "bo1", steps: service.getBuiltInSteps("bo1") } }), { statusCode: 403 });
    await assert.rejects(() => service.createTemplate({ user: { id: "user-1", role: "user" }, body: { name: "Global Template", format: "bo1", mapPoolId: "global-pool", rulePresetId: "global-preset" } }), { statusCode: 403 });

    await service.createPool({ user: { id: "admin-1", role: "admin" }, body: globalBody });
    await service.createPreset({ user: { id: "admin-1", role: "admin" }, body: { name: "Global Preset", format: "bo1", steps: service.getBuiltInSteps("bo1") } });
    await service.createTemplate({ user: { id: "admin-1", role: "admin" }, body: { name: "Global Template", format: "bo1", mapPoolId: "global-pool", rulePresetId: "global-preset" } });

    await assert.rejects(() => service.createPool({ user: { id: "referee-1", role: "referee" }, body: { ...globalBody, tournamentId: "tournament-1" } }), { statusCode: 403 });
    await assert.rejects(() => service.saveTournamentConfig({ user: { id: "referee-1", role: "referee" }, tournamentId: "tournament-1", body: {} }), { statusCode: 403 });
    await service.saveTournamentConfig({ user: { id: "tournament-admin", role: "user" }, tournamentId: "tournament-1", body: {} });
    assert.deepEqual(writes.map(([kind]) => kind), ["pool", "preset", "template", "config"]);
  } finally { restore(); }
});
