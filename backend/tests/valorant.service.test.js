const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");
const validationPath = path.join(__dirname, "../src/modules/valorant/valorant.validation.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);
const envPath = path.join(__dirname, "../src/config/env.js");

const envMock = { env: {
  VALORANT_INTERNAL_BASE_URL: "http://localhost:8000",
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
  VALORANT_TIMEOUT_MS: 15000,
  VALORANT_READ_RETRIES: 2,
} };

class FastApiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "FastApiError";
    Object.assign(this, options);
  }
}

class InternalServiceError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "InternalServiceError";
    Object.assign(this, options);
  }
}

const { mapTeamResponse } = require("../src/modules/valorant/valorant.mapper");

test("bindTeam writes an operation and stores the returned VALORANT team UUID on the binding", async () => {
  const savedTeam = { id: "saved-team-1", name: "Quest Five", teamTag: "QF" };
  const existingTeam = {
    id: "val-team-1",
    name: "Quest Five",
    short_name: "QF",
    matches_played: 0,
    series_wins: 0,
    series_losses: 0,
    is_active: true,
  };
  const statuses = [];
  let operationId;
  const prismaMock = {
    prisma: {
      savedTeam: {
        findUnique: async ({ where }) => (where.id === savedTeam.id ? savedTeam : null),
      },
      valorantTeamBinding: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: "binding-1", ...data }),
      },
      questValorantOperation: {
        create: async ({ data }) => {
          operationId = data.operationId;
          return { id: "op-row-1", ...data };
        },
        update: async ({ where, data }) => {
          statuses.push(data.status);
          return { id: where.id, ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body, externalKey, idempotent }) => {
      assert.equal(path, "/api/v1/teams");
      assert.equal(body.quest_saved_team_id, "saved-team-1");
      assert.equal(externalKey, "saved-team-1");
      assert.equal(idempotent, true);
      return { status: 200, data: existingTeam, requestId: "fastapi-req-1" };
    },
  };

  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const binding = await service.bindTeam({ savedTeamId: savedTeam.id, actorUserId: "user-1", requestId: "req-1", ipAddress: "127.0.0.1" });
    assert.equal(binding.valorantTeamUuid, "val-team-1");
    assert.equal(binding.status, "active");
    assert.equal(binding.boundByUserId, "user-1");
    assert.ok(operationId);
    assert.deepEqual(statuses, ["in_flight", "succeeded"]);
  } finally {
    restore();
  }
});

test("bindTeam refuses a second active binding for the same SavedTeam", async () => {
  const prismaMock = {
    prisma: {
      savedTeam: { findUnique: async () => ({ id: "saved-team-1", name: "Q", teamTag: null }) },
      valorantTeamBinding: { findFirst: async () => ({ id: "binding-1" }) },
      questValorantOperation: {},
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: { valorantRequest: async () => { throw new Error("must not call"); } },
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.bindTeam({ savedTeamId: "saved-team-1", actorUserId: "user-1", requestId: "req-2", ipAddress: "127.0.0.1" }),
      (error) => error instanceof HttpError && error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("bindTeam classifies a transport failure as reconciliation_required", async () => {
  const statuses = [];
  const prismaMock = {
    prisma: {
      savedTeam: { findUnique: async () => ({ id: "saved-team-1", name: "Q", teamTag: null }) },
      valorantTeamBinding: { findFirst: async () => null, create: async ({ data }) => ({ id: "b", ...data }) },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-2", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-2", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async () => { throw new InternalServiceError("down", { code: "valorant_unreachable", status: 502 }); },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.bindTeam({ savedTeamId: "saved-team-1", actorUserId: "user-1", requestId: "req-3", ipAddress: "127.0.0.1" }),
      (error) => error instanceof InternalServiceError,
    );
    assert.deepEqual(statuses, ["in_flight", "reconciliation_required"]);
  } finally {
    restore();
  }
});

test("detachBinding is a Quest-local status change that never calls FastAPI", async () => {
  let clientCalls = 0;
  const prismaMock = {
    prisma: {
      valorantTeamBinding: {
        findUnique: async () => ({ id: "binding-1", savedTeamId: "saved-team-1", valorantTeamUuid: "val-team-1", status: "active" }),
        update: async ({ where, data }) => ({ id: where.id, ...data }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-3", ...data }),
        update: async () => ({}),
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: { valorantRequest: async () => { clientCalls += 1; } },
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const binding = await service.detachBinding({ bindingId: "binding-1", actorUserId: "user-1", requestId: "req-4", ipAddress: "127.0.0.1" });
    assert.equal(binding.status, "detached");
    assert.ok(binding.detachedAt instanceof Date);
    assert.equal(clientCalls, 0);
  } finally {
    restore();
  }
});

test("listTeams fetches the FastAPI team catalog and joins it onto each binding", async () => {
  const bindings = [
    {
      id: "binding-1",
      savedTeamId: "saved-team-1",
      valorantTeamUuid: "val-team-1",
      status: "active",
      boundByUserId: "user-1",
      savedTeam: { id: "saved-team-1", name: "Quest Five", teamTag: "QF" },
      boundByUser: { id: "user-1", username: "admin" },
    },
    {
      id: "binding-2",
      savedTeamId: "saved-team-2",
      valorantTeamUuid: "val-team-missing",
      status: "active",
      boundByUserId: "user-1",
      savedTeam: { id: "saved-team-2", name: "Quest Six", teamTag: "QS" },
      boundByUser: { id: "user-1", username: "admin" },
    },
  ];
  const fastapiTeams = [
    { id: "val-team-1", name: "Quest Five", short_name: "QF", slug: "quest-five", matches_played: 3, series_wins: 2, series_losses: 1, is_active: true },
  ];
  const prismaMock = {
    prisma: {
      valorantTeamBinding: {
        findMany: async () => bindings,
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, actorUserId, idempotent }) => {
      assert.equal(path, "/api/v1/teams");
      assert.equal(actorUserId, "user-1", "the admin team list read signs the acting admin as sub");
      assert.equal(idempotent, true);
      return { status: 200, data: fastapiTeams, requestId: "fastapi-req-20" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.listTeams({ actorUserId: "user-1" });
    assert.equal(result.length, 2);
    assert.equal(result[0].valorantTeam.id, "val-team-1", "joined team carries the FastAPI id");
    assert.equal(result[0].valorantTeam.name, "Quest Five");
    assert.equal(result[0].valorantTeam.matchesPlayed, 3, "joined team goes through mapTeamResponse");
    assert.equal(result[1].valorantTeam, null, "a binding whose team is absent upstream gets null");
  } finally {
    restore();
  }
});

test("discover proxies the two-player search and maps candidates (matchId pass-through, no winningSide)", async () => {
  const candidate = require("./fixtures/valorant/match-candidate.json");
  let capturedBody;
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      capturedBody = body;
      assert.equal(path, "/api/v1/match-search/two-player");
      return {
        status: 200,
        data: {
          players: { a: { id: "p-a", puuid: "puuid-a", name: "TenZ", tag: "SEN", affinity: "eu" } },
          candidates: [candidate],
        },
        requestId: "fastapi-req-7",
      };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchCandidate: (c) => ({ matchId: c.match_id, henrikMatchId: c.henrik_match_id, map: c.map, isCompleted: c.is_completed, alreadyImported: c.already_imported }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.discover({
      playerA: { name: "TenZ", tag: "SEN" },
      playerB: { name: "Demon1", tag: "NA" },
      pageSize: 10,
      maxPages: 1,
      actorUserId: "user-1",
      requestId: "req-7",
    });
    assert.equal(capturedBody.page_size, 10);
    assert.equal(capturedBody.max_pages, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].henrikMatchId, candidate.henrik_match_id);
    assert.equal(result.candidates[0].matchId, candidate.match_id);
    assert.equal("winningSide" in result.candidates[0], false);
  } finally {
    restore();
  }
});

test("discover returns an empty list, not an error, when there is no overlap", async () => {
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async () => ({ status: 200, data: { players: {}, candidates: [] }, requestId: "r" }),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchCandidate: (c) => c },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.discover({
      playerA: { name: "TenZ", tag: "SEN" },
      playerB: { name: "Demon1", tag: "NA" },
      actorUserId: "user-1",
      requestId: "req-8",
    });
    assert.deepEqual(result.candidates, []);
  } finally {
    restore();
  }
});

test("importMatch imports once, upserts the projection, and reports created from the status", async () => {
  const detail = {
    id: "00000000-0000-4000-8000-00000000000e",
    henrik_match_id: "abcdef0123",
    affinity: "eu",
    platform: "pc",
    map_name: "Ascent",
    started_at: "2026-08-01T14:30:00Z",
    is_completed: true,
    red_score: 13,
    blue_score: 8,
    winning_side: "red",
    players: [],
    raw_payload_available: true,
  };
  const upserts = [];
  const prismaMock = {
    prisma: {
      questValorantMatch: {
        upsert: async ({ where, create }) => {
          upserts.push({ where, create });
          return { ...create, id: "projection-1" };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/matches/import");
      assert.equal(body.match_id, detail.henrik_match_id);
      // Real FastAPI MatchImportResponse shape: { match: MatchDetailResponse, created: bool }
      return { status: 201, data: { match: detail, created: true }, requestId: "fastapi-req-9" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchDetail: (d) => ({ matchId: d.id, henrikMatchId: d.henrik_match_id, mapName: d.map_name, startedAt: d.started_at, winningSide: d.winning_side }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.importMatch({ henrikMatchId: detail.henrik_match_id, affinity: "eu", actorUserId: "user-1", requestId: "req-9", ipAddress: "127.0.0.1" });
    assert.equal(result.created, true);
    assert.equal(result.match.henrikMatchId, detail.henrik_match_id);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].create.henrikMatchId, detail.henrik_match_id);
  } finally {
    restore();
  }
});

test("getMatchByHenrikId uses the by-henrik-id endpoint for already-imported matches", async () => {
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/matches/by-henrik-id/abcdef0123");
      return { status: 200, data: { id: "m-1", henrik_match_id: "abcdef0123", map_name: "Ascent", started_at: "2026-08-01T14:30:00Z", is_completed: true, players: [], raw_payload_available: true }, requestId: "r" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchDetail: (d) => ({ matchId: d.id, mapName: d.map_name }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.getMatchByHenrikId({ henrikMatchId: "abcdef0123" });
    assert.equal(result.matchId, "m-1");
  } finally {
    restore();
  }
});

test("createSeries writes an operation, sends external_quest_series_id and anchors, and stores the projection", async () => {
  const seriesView = {
    id: "00000000-0000-4000-8000-00000000000a",
    team_a_id: "val-team-1",
    team_b_id: "val-team-2",
    format: "bo3",
    importance: "regular",
    status: "draft",
    team_a_maps_won: 0,
    team_b_maps_won: 0,
    games: [],
  };
  let sentBody;
  let sentKey;
  const prismaMock = {
    prisma: {
      valorantTeamBinding: {
        findUnique: async ({ where }) => {
          const map = {
            "binding-a": { id: "binding-a", status: "active", valorantTeamUuid: "val-team-1" },
            "binding-b": { id: "binding-b", status: "active", valorantTeamUuid: "val-team-2" },
          };
          return map[where.id] || null;
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-10", ...data }),
        update: async () => ({}),
      },
      questValorantSeries: {
        create: async ({ data }) => ({ id: "quest-series-1", ...data }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body, externalKey, idempotent }) => {
      assert.equal(path, "/api/v1/series");
      assert.equal(idempotent, true);
      sentBody = body;
      sentKey = externalKey;
      return { status: 201, data: seriesView, requestId: "fastapi-req-10" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapSeriesView: (s) => ({ id: s.id, teamAId: s.team_a_id, teamBId: s.team_b_id, status: s.status, games: [] }) },
    [validationPath]: { assertSupportedFormat: () => {}, generateExternalKey: () => "quest-ext-key-1", normalizeRiotId: (r) => r },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const series = await service.createSeries({
      bindingTeamAId: "binding-a",
      bindingTeamBId: "binding-b",
      format: "bo3",
      playedAt: new Date("2026-08-02T18:00:00Z"),
      anchorPlayerA: { name: "TenZ", tag: "SEN" },
      anchorPlayerB: { name: "Demon1", tag: "NA" },
      actorUserId: "user-1",
      requestId: "req-10",
      ipAddress: "127.0.0.1",
    });
    assert.equal(series.valorantSeriesUuid, seriesView.id);
    assert.equal(series.externalKey, "quest-ext-key-1");
    assert.equal(series.status, "draft");
    assert.equal(sentKey, "quest-ext-key-1");
    assert.equal(sentBody.external_quest_series_id, "quest-ext-key-1");
    assert.deepEqual(sentBody.anchor_player_a, { name: "TenZ", tag: "SEN" });
    assert.equal(sentBody.played_at, "2026-08-02T18:00:00.000Z");
  } finally {
    restore();
  }
});

test("attachGame sends the VAL match UUID as match_id and mirrors the returned game", async () => {
  const gameView = {
    id: "game-1",
    game_number: 1,
    match_id: "00000000-0000-4000-8000-00000000000e",
    map_name: "Ascent",
    team_a_side: "red",
    team_b_side: "blue",
    team_a_rounds: 13,
    team_b_rounds: 8,
    winner_team_id: "val-team-1",
  };
  let sentBody;
  let createdGameData;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "00000000-0000-4000-8000-00000000000a", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-11", ...data }),
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        create: async ({ data }) => {
          createdGameData = data;
          return { id: "mirror-game-1", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/00000000-0000-4000-8000-00000000000a/games");
      sentBody = body;
      return { status: 201, data: gameView, requestId: "fastapi-req-11" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {
      mapGameView: (g) => ({ id: g.id, gameNumber: g.game_number, matchId: g.match_id, mapName: g.map_name, teamASide: g.team_a_side, teamBSide: g.team_b_side }),
      mapSeriesView: () => ({}),
    },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const mirrored = await service.attachGame({
      seriesId: "quest-series-1",
      gameNumber: 1,
      matchId: "00000000-0000-4000-8000-00000000000e",
      teamASide: "red",
      actorUserId: "user-1",
      requestId: "req-11",
      ipAddress: "127.0.0.1",
    });
    assert.deepEqual(sentBody, { match_id: "00000000-0000-4000-8000-00000000000e", game_number: 1, team_a_side: "red" });
    assert.equal(createdGameData.valorantGameUuid, "game-1");
    assert.equal(mirrored.teamASide, "red");
    assert.equal(mirrored.teamBSide, "blue");
  } finally {
    restore();
  }
});

test("listSeriesMatches proxies the series matches endpoint and maps each summary with anchorASide", async () => {
  const rawMatches = [
    {
      id: "00000000-0000-4000-8000-00000000000e",
      henrik_match_id: "abcdef0123456789",
      affinity: "eu",
      platform: "pc",
      map_name: "Ascent",
      mode: "Standard",
      queue: "unrated",
      started_at: "2026-08-01T14:30:00Z",
      is_completed: true,
      red_score: 13,
      blue_score: 8,
      winning_side: "red",
      anchor_a_side: "red",
    },
    {
      id: "00000000-0000-4000-8000-00000000000f",
      henrik_match_id: "fedcba9876543210",
      affinity: "eu",
      platform: "pc",
      map_name: "Bind",
      started_at: "2026-08-01T15:00:00Z",
      is_completed: false,
      anchor_a_side: null,
    },
  ];
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, actorUserId, idempotent }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/matches");
      assert.equal(actorUserId, "user-1");
      assert.equal(idempotent, true);
      return { status: 200, data: { matches: rawMatches }, requestId: "fastapi-req-18" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchSummary: (m) => ({ matchId: m.id, henrikMatchId: m.henrik_match_id, anchorASide: m.anchor_a_side }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const matches = await service.listSeriesMatches({ seriesId: "quest-series-1", actorUserId: "user-1" });
    assert.equal(matches.length, 2);
    assert.equal(matches[0].henrikMatchId, "abcdef0123456789");
    assert.equal(matches[0].anchorASide, "red");
    assert.equal(matches[1].anchorASide, null);
  } finally {
    restore();
  }
});

test("listSeriesMatches 404s when the Quest series has no VALORANT series yet", async () => {
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: null }),
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: { valorantRequest: async () => { throw new Error("must not call"); } },
    [mapperPath]: {},
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    await assert.rejects(
      service.listSeriesMatches({ seriesId: "quest-series-1", actorUserId: "user-1" }),
      (error) => error instanceof HttpError && error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("attachGame omits team_a_side from the request body when the caller omits it", async () => {
  const gameView = {
    id: "game-2",
    game_number: 1,
    match_id: "00000000-0000-4000-8000-00000000000e",
    map_name: "Ascent",
    team_a_side: "red",
    team_b_side: "blue",
    team_a_rounds: 13,
    team_b_rounds: 8,
    winner_team_id: "val-team-1",
  };
  let sentBody;
  let operationRequestBodyHash;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => {
          operationRequestBodyHash = data.requestBodyHash;
          return { id: "op-row-19", ...data };
        },
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        create: async ({ data }) => ({ id: "mirror-game-2", ...data }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/games");
      sentBody = body;
      return { status: 201, data: gameView, requestId: "fastapi-req-19" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {
      mapGameView: (g) => ({ id: g.id, gameNumber: g.game_number, matchId: g.match_id, mapName: g.map_name, teamASide: g.team_a_side, teamBSide: g.team_b_side }),
      mapSeriesView: () => ({}),
    },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const mirrored = await service.attachGame({
      seriesId: "quest-series-1",
      gameNumber: 1,
      matchId: "00000000-0000-4000-8000-00000000000e",
      teamASide: undefined,
      actorUserId: "user-1",
      requestId: "req-19",
      ipAddress: "127.0.0.1",
    });
    assert.deepEqual(sentBody, { match_id: "00000000-0000-4000-8000-00000000000e", game_number: 1 });
    assert.equal(
      operationRequestBodyHash,
      crypto.createHash("sha256").update(JSON.stringify({ match_id: "00000000-0000-4000-8000-00000000000e", game_number: 1 })).digest("hex"),
      "the operation records the exact body sent upstream (no team_a_side)",
    );
    assert.equal(mirrored.teamASide, "red", "the derived side still lands on the mirrored projection");
  } finally {
    restore();
  }
});

test("setGameOrder sends the full absolute desired order and converges on retry", async () => {
  let orderBodies = 0;
  const updatedOrder = [];
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-12", ...data }),
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        findMany: async () => [
          { id: "g2-uuid", valorantGameUuid: "val-g2" },
          { id: "g1-uuid", valorantGameUuid: "val-g1" },
        ],
        update: async ({ where, data }) => {
          updatedOrder.push({ id: where.id, gameNumber: data.gameNumber });
          return {};
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/games/order");
      orderBodies += 1;
      assert.deepEqual(body.games, [
        { game_id: "val-g2", game_number: 1 },
        { game_id: "val-g1", game_number: 2 },
      ]);
      return { status: 200, data: [], requestId: "fastapi-req-12" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {},
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const order = [{ gameId: "g2-uuid", gameNumber: 1 }, { gameId: "g1-uuid", gameNumber: 2 }];
    await service.setGameOrder({ seriesId: "quest-series-1", games: order, actorUserId: "user-1", requestId: "req-12", ipAddress: "127.0.0.1" });
    updatedOrder.length = 0;
    await service.setGameOrder({ seriesId: "quest-series-1", games: order, actorUserId: "user-1", requestId: "req-12b", ipAddress: "127.0.0.1" });
    assert.equal(orderBodies, 2, "the same absolute body converges on retry");
    assert.deepEqual(updatedOrder, [
      { id: "g2-uuid", gameNumber: 1 },
      { id: "g1-uuid", gameNumber: 2 },
    ]);
  } finally {
    restore();
  }
});

test("removeGame deletes the mirrored projection after a 204", async () => {
  let deletedGame;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-13", ...data }),
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        findUnique: async ({ where }) => {
          assert.equal(where.id, "game-1");
          return { id: "game-1", valorantGameUuid: "val-game-1" };
        },
        delete: async ({ where }) => { deletedGame = where.id; return { id: where.id }; },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/games/val-game-1");
      return { status: 204, data: null, requestId: "fastapi-req-13" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {},
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await service.removeGame({ seriesId: "quest-series-1", gameId: "game-1", actorUserId: "user-1", requestId: "req-13", ipAddress: "127.0.0.1" });
    assert.equal(deletedGame, "game-1");
  } finally {
    restore();
  }
});

test("previewSeries returns the mapped FastAPI preview", async () => {
  const preview = { valid: true, team_a_maps_won: 2, team_b_maps_won: 0, calculated_winner_id: "val-team-1", games: [], errors: [] };
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1" }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/preview");
      return { status: 200, data: preview, requestId: "r" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapPreview: (p) => ({ valid: p.valid, teamAMapsWon: p.team_a_maps_won, errors: p.errors }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.previewSeries({ seriesId: "quest-series-1" });
    assert.equal(result.valid, true);
    assert.equal(result.teamAMapsWon, 2);
  } finally {
    restore();
  }
});

test("finalizeSeries marks the operation in_flight before the call and adopts the committed result", async () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const statuses = [];
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async ({ where, data }) => {
          assert.equal(where.id, "quest-series-1");
          assert.equal(data.status, "finalized");
          assert.equal(data.finalizedById, "user-1");
          return { id: where.id, ...data };
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-14", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-14", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/finalize");
      assert.deepEqual(body, {
        official_winner_id: null,
        override_reason: null,
        rating_mode: "normal",
      });
      return { status: 200, data: fixture, requestId: "fastapi-req-14" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapFinalizeResult: (r) => ({ seriesId: r.series_id, status: r.status, ratingMode: r.rating_mode }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.finalizeSeries({
      seriesId: "quest-series-1",
      ratingMode: "normal",
      actorUserId: "user-1",
      requestId: "req-14",
      ipAddress: "127.0.0.1",
    });
    assert.equal(result.status, "finalized");
    assert.equal(result.ratingMode, "normal");
    assert.deepEqual(statuses, ["in_flight", "succeeded"]);
  } finally {
    restore();
  }
});

test("finalizeSeries marks the operation failed and reconciles on SERIES_ALREADY_FINALIZED", async () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const statuses = [];
  let adoptionCalls = 0;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async ({ data }) => {
          if (data.status === "finalized") adoptionCalls += 1;
          return { id: "quest-series-1", ...data };
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-15", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-15", ...data };
        },
      },
    },
  };
  let callCount = 0;
  const clientMock = {
    valorantRequest: async ({ path }) => {
      callCount += 1;
      if (path.endsWith("/finalize")) {
        throw new FastApiError("already finalized", { code: "SERIES_ALREADY_FINALIZED", status: 409, requestId: "fastapi-req-15" });
      }
      assert.equal(path, "/api/v1/series/series-uuid-1");
      return { status: 200, data: { ...fixture, status: "finalized" }, requestId: "fastapi-req-15" };
    },
    FastApiError,
    InternalServiceError,
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {
      mapFinalizeResult: (r) => ({ seriesId: r.series_id, status: r.status, ratingMode: r.rating_mode }),
      mapSeriesView: (s) => ({ id: s.id, status: s.status }),
    },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.finalizeSeries({ seriesId: "quest-series-1", ratingMode: "normal", actorUserId: "user-1", requestId: "req-15", ipAddress: "127.0.0.1" }),
      (error) => error instanceof FastApiError && error.code === "SERIES_ALREADY_FINALIZED",
    );
    assert.ok(statuses.includes("failed"));
    assert.equal(callCount, 2, "finalize attempt + one reconcile read, no blind retry");
    assert.equal(adoptionCalls, 1, "the committed finalized state is adopted");
  } finally {
    restore();
  }
});

test("finalizeSeries marks reconciliation_required on timeout and never blind-retries", async () => {
  let calls = 0;
  const statuses = [];
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async () => ({}),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-16", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-16", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async () => {
      calls += 1;
      throw new InternalServiceError("timed out", { code: "valorant_unreachable", status: 502 });
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapFinalizeResult: () => ({}) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.finalizeSeries({ seriesId: "quest-series-1", ratingMode: "normal", actorUserId: "user-1", requestId: "req-16", ipAddress: "127.0.0.1" }),
      (error) => error instanceof InternalServiceError,
    );
    assert.equal(calls, 1, "finalize is never blind-retried");
    assert.deepEqual(statuses, ["in_flight", "reconciliation_required"]);
  } finally {
    restore();
  }
});

test("getReconciliationReport classifies missing FastAPI series as orphaned via reads only", async () => {
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findMany: async () => [
          { id: "qs-1", externalKey: "ext-1", valorantSeriesUuid: "series-uuid-1", status: "draft" },
          { id: "qs-2", externalKey: "ext-2", valorantSeriesUuid: null, status: "reconciliation_required" },
        ],
      },
      valorantTeamBinding: { findMany: async () => [] },
      questValorantMatch: { findMany: async () => [] },
      questValorantOperation: {
        findMany: async () => [{ id: "op-1", operationId: "op-1", type: "finalize", status: "reconciliation_required", questSeriesId: "qs-1" }],
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/series");
      return { status: 200, data: [{ id: "series-uuid-1", external_quest_series_id: "ext-1", status: "draft" }], requestId: "r" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapSeriesView: (s) => ({ id: s.id, status: s.status }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const report = await service.getReconciliationReport({ actorUserId: "user-1" });
    assert.ok(report.orphaned.some((row) => row.id === "qs-2"));
    assert.ok(report.stuckOperations.length === 1);
  } finally {
    restore();
  }
});
