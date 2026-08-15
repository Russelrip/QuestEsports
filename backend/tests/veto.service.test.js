const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/veto/veto.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

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
