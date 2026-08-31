const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/matches/match.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const teamLogoPath = path.join(__dirname, "../src/modules/teams/team-logo.js");
const matchRoomPath = path.join(__dirname, "../src/modules/match-rooms/match-room.service.js");

const linkedMatch = (publishResult) => ({
  id: "match-1",
  tournamentId: "tournament-1",
  source: "quest",
  externalId: null,
  identifier: "M-001",
  roundNumber: null,
  status: "completed",
  scheduledAt: null,
  estimatedAt: null,
  station: null,
  checkInDeadline: null,
  vetoStartAt: null,
  localNotes: null,
  scoreData: {},
  winnerSlot: 1,
  completedAt: new Date("2026-08-31T00:05:00.000Z"),
  updatedAt: new Date("2026-08-31T00:05:00.000Z"),
  tournament: { id: "tournament-1", slug: "valorant-cup", title: "Quest Valorant Cup", game: "valorant", status: "published", isPublished: true },
  participants: [
    { id: "participant-1", slot: 1, registrationId: "registration-1", externalParticipantId: null, displayName: "Alpha", seed: 1, score: "2", result: "win", registration: {} },
    { id: "participant-2", slot: 2, registrationId: "registration-2", externalParticipantId: null, displayName: "Bravo", seed: 2, score: "1", result: "loss", registration: {} },
  ],
  assignedStaff: null,
  vetoRoom: {
    code: "ALPHAB",
    status: "completed",
    format: "bo3",
    publishResult,
    tossCall: "heads",
    tossResult: "heads",
    tossWinnerSlot: 1,
    teamASlot: 1,
    completedAt: new Date("2026-08-31T00:04:00.000Z"),
    actions: [{ sequence: 1, kind: "ban", actorSlot: 1, mapSlug: "ascent", mapName: "Ascent", side: null, payload: { seriesIndex: null } }],
  },
});

const loadService = (match) => loadModuleWithMocks(servicePath, {
  [prismaPath]: {
    prisma: {
      match: {
        count: async () => 1,
        findMany: async () => [match],
      },
      $transaction: async (operations) => Promise.all(operations),
    },
  },
  [teamLogoPath]: {
    resolveEffectiveTeamLogoName: () => null,
    getTeamLogoUrl: () => null,
  },
  [matchRoomPath]: { ensureMatchRoom: async () => null, notifyMatchChange: () => null },
});

test("public linked-match projection omits an unpublished veto and exposes a published completed veto", async () => {
  for (const [publishResult, expectedVeto] of [[false, null], [true, { code: "ALPHAB", status: "completed", format: "bo3" }]]) {
    const loaded = loadService(linkedMatch(publishResult));
    try {
      const result = await loaded.module.listPublicMatches({ status: "completed" });
      assert.equal(result.items.length, 1);
      assert.deepEqual(result.items[0].veto && {
        code: result.items[0].veto.code,
        status: result.items[0].veto.status,
        format: result.items[0].veto.format,
      }, expectedVeto);
    } finally {
      loaded.restore();
    }
  }
});
