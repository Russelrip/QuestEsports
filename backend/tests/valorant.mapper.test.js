const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");

const loadMapper = () => loadModuleWithMocks(mapperPath, {});

test("mapMatchSummary mirrors the GET /matches summary plus anchorASide", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchSummary({
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
  });
  assert.deepEqual(mapped, {
    matchId: "00000000-0000-4000-8000-00000000000e",
    henrikMatchId: "abcdef0123456789",
    affinity: "eu",
    platform: "pc",
    mapName: "Ascent",
    mode: "Standard",
    queue: "unrated",
    startedAt: "2026-08-01T14:30:00Z",
    isCompleted: true,
    redScore: 13,
    blueScore: 8,
    winningSide: "red",
    anchorASide: "red",
  });
});

test("mapMatchSummary normalizes unknown sides to null", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchSummary({
    id: "00000000-0000-4000-8000-00000000000f",
    henrik_match_id: "fedcba9876543210",
    affinity: "eu",
    platform: "pc",
    map_name: "Bind",
    started_at: "2026-08-01T15:00:00Z",
    is_completed: false,
    winning_side: "spectator",
    anchor_a_side: null,
  });
  assert.equal(mapped.winningSide, null);
  assert.equal(mapped.anchorASide, null);
  assert.equal(mapped.redScore, null);
  assert.equal(mapped.blueScore, null);
  assert.equal(mapped.mode, null);
  assert.equal(mapped.queue, null);
});

test("mapMatchCandidate keeps only the fields the current MatchCandidate returns", () => {
  const candidate = require("./fixtures/valorant/match-candidate.json");
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchCandidate(candidate);
  assert.deepEqual(mapped, {
    henrikMatchId: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    affinity: "eu",
    map: "Ascent",
    startedAt: "2026-08-01T14:30:00Z",
    mode: "Standard",
    queue: "unrated",
    isCompleted: true,
    redScore: 13,
    blueScore: 8,
    alreadyImported: false,
  });
  assert.equal("winningSide" in mapped, false);
  assert.equal("players" in mapped, false);
});

test("mapSeriesView maps a FastAPI draft series with games", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapSeriesView({
    id: "00000000-0000-4000-8000-00000000000a",
    team_a_id: "00000000-0000-4000-8000-00000000000b",
    team_b_id: "00000000-0000-4000-8000-00000000000c",
    format: "bo3",
    importance: "regular",
    status: "draft",
    team_a_maps_won: 0,
    team_b_maps_won: 0,
    played_at: "2026-08-02T18:00:00Z",
    games: [{
      id: "00000000-0000-4000-8000-00000000000d",
      game_number: 1,
      match_id: "00000000-0000-4000-8000-00000000000e",
      map_name: "Ascent",
      team_a_side: "red",
      team_b_side: "blue",
      team_a_rounds: 13,
      team_b_rounds: 8,
      winner_team_id: "00000000-0000-4000-8000-00000000000b",
    }],
  });
  assert.equal(mapped.id, "00000000-0000-4000-8000-00000000000a");
  assert.equal(mapped.teamAId, "00000000-0000-4000-8000-00000000000b");
  assert.equal(mapped.teamBId, "00000000-0000-4000-8000-00000000000c");
  assert.equal(mapped.status, "draft");
  assert.equal(mapped.games[0].gameNumber, 1);
  assert.equal(mapped.games[0].matchId, "00000000-0000-4000-8000-00000000000e");
  assert.equal(mapped.games[0].teamASide, "red");
  assert.equal(mapped.games[0].winnerTeamId, "00000000-0000-4000-8000-00000000000b");
});

test("mapFinalizeResult maps the recorded FinalizeResult fixture", () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapFinalizeResult(fixture);
  assert.equal(mapped.seriesId, fixture.series_id);
  assert.equal(mapped.status, "finalized");
  assert.equal(mapped.ratingMode, "normal");
  assert.equal(mapped.events.length, 1);
  assert.equal(mapped.events[0].eloBefore, "1200.00");
  assert.equal(mapped.events[0].eloAfter, "1218.00");
  assert.equal(mapped.events[0].calculationDetails.mode, "normal");
  assert.equal(mapped.teamACurrentElo, 1218);
  assert.equal(mapped.teamBCurrentElo, 1180);
});
