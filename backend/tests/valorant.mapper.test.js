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
    matchId: null,
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

test("mapMatchCandidate maps the nullable VAL match_id to matchId when present", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchCandidate({
    match_id: "00000000-0000-4000-8000-00000000000e",
    henrik_match_id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    affinity: "eu",
    map: "Ascent",
    started_at: "2026-08-01T14:30:00Z",
    mode: "Standard",
    queue: "unrated",
    is_completed: true,
    red_score: 13,
    blue_score: 8,
    already_imported: true,
  });
  assert.equal(mapped.matchId, "00000000-0000-4000-8000-00000000000e");
  assert.equal(mapped.alreadyImported, true);
  assert.equal(mapped.henrikMatchId, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567");
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

test("mapManualFinalizeResult maps the manual-result FinalizeResult shape", () => {
  const fixture = require("./fixtures/valorant/series-manual-finalize.json");
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapManualFinalizeResult(fixture);
  assert.equal(mapped.seriesId, fixture.series_id);
  assert.equal(mapped.status, "finalized");
  assert.equal(mapped.ratingMode, "manual_override");
  assert.equal(mapped.winnerOverrideReason, "manual result entered by admin");
  assert.equal(mapped.calculatedWinnerId, fixture.calculated_winner_id);
  assert.equal(mapped.officialWinnerId, fixture.official_winner_id);
  assert.equal(mapped.events.length, 1);
  assert.equal(mapped.events[0].calculationDetails.mode, "manual_override");
  assert.equal(mapped.teamACurrentElo, 1218);
  assert.equal(mapped.teamBCurrentElo, 1180);
});

test("mapRankingEntry maps elo from current_elo as a number", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapRankingEntry({
    team_id: "00000000-0000-4000-8000-00000000000b",
    rank: 1,
    current_elo: "1031.0",
    peak_elo: "1150.0",
    series_wins: 12,
    series_losses: 3,
  });
  assert.deepEqual(mapped, {
    teamId: "00000000-0000-4000-8000-00000000000b",
    rank: 1,
    elo: 1031,
    seriesWins: 12,
    seriesLosses: 3,
  });
  assert.equal("peakElo" in mapped, false);
});

test("mapRankingEntry does not read a top-level elo field", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapRankingEntry({
    team_id: "00000000-0000-4000-8000-00000000000c",
    rank: 2,
    elo: 999,
    current_elo: "1111.0",
    series_wins: 5,
    series_losses: 7,
  });
  assert.equal(mapped.elo, 1111);
});

test("mapMatchDetail projects the per-player scoreboard stats and the match metadata", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchDetail({
    id: "00000000-0000-4000-8000-00000000000e",
    henrik_match_id: "abcdef0123456789",
    affinity: "eu",
    platform: "pc",
    map_name: "Ascent",
    map_id: "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319",
    mode: "Standard",
    queue: "unrated",
    started_at: "2026-08-01T14:30:00Z",
    duration_ms: 2_142_000,
    is_completed: true,
    red_score: 13,
    blue_score: 8,
    winning_side: "red",
    game_version: "release-11.04",
    raw_payload_available: true,
    players: [{
      puuid: "11111111-1111-4111-8111-111111111111",
      name: "Quester",
      tag: "QST",
      side: "red",
      agent_id: "add6443a-41bd-e414-f6ad-e58d267f4e95",
      agent_name: "Jett",
      score_total: 5_460,
      kills: 24,
      deaths: 13,
      assists: 4,
      damage_dealt: 4_368,
      damage_received: 3_010,
      headshots: 30,
      bodyshots: 62,
      legshots: 8,
    }],
  });
  assert.equal(mapped.mapId, "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319");
  assert.equal(mapped.durationMs, 2_142_000);
  assert.equal(mapped.gameVersion, "release-11.04");
  assert.deepEqual(mapped.players[0], {
    puuid: "11111111-1111-4111-8111-111111111111",
    name: "Quester",
    tag: "QST",
    side: "red",
    agentName: "Jett",
    scoreTotal: 5_460,
    kills: 24,
    deaths: 13,
    assists: 4,
    damageDealt: 4_368,
    damageReceived: 3_010,
    headshots: 30,
    bodyshots: 62,
    legshots: 8,
  });
  // agent_id is returned upstream but deliberately not projected.
  assert.equal("agentId" in mapped.players[0], false);
});

test("mapMatchDetail carries enough per player to derive ACS, ADR and HS%", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchDetail({
    id: "00000000-0000-4000-8000-00000000000e",
    henrik_match_id: "abcdef0123456789",
    affinity: "eu",
    platform: "pc",
    map_name: "Ascent",
    started_at: "2026-08-01T14:30:00Z",
    is_completed: true,
    red_score: 13,
    blue_score: 8,
    raw_payload_available: true,
    players: [{
      puuid: "11111111-1111-4111-8111-111111111111",
      name: "Quester",
      tag: "QST",
      side: "red",
      agent_name: "Jett",
      score_total: 5_460,
      kills: 24,
      deaths: 13,
      assists: 4,
      damage_dealt: 4_368,
      damage_received: 3_010,
      headshots: 30,
      bodyshots: 62,
      legshots: 8,
    }],
  });
  const rounds = mapped.redScore + mapped.blueScore;
  const player = mapped.players[0];
  assert.equal(rounds, 21);
  assert.equal(player.scoreTotal / rounds, 260);
  assert.equal(player.damageDealt / rounds, 208);
  assert.equal(player.headshots / (player.headshots + player.bodyshots + player.legshots), 0.3);
});

test("mapMatchDetail nulls the scoreboard stats an in-progress match has not reported", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchDetail({
    id: "00000000-0000-4000-8000-00000000000f",
    henrik_match_id: "fedcba9876543210",
    affinity: "eu",
    platform: "pc",
    map_name: "Bind",
    started_at: "2026-08-01T15:00:00Z",
    is_completed: false,
    raw_payload_available: false,
    players: [{
      puuid: "22222222-2222-4222-8222-222222222222",
      name: "Rookie",
      tag: "QST",
      side: "blue",
    }],
  });
  assert.equal(mapped.mapId, null);
  assert.equal(mapped.durationMs, null);
  assert.equal(mapped.gameVersion, null);
  assert.deepEqual(mapped.players[0], {
    puuid: "22222222-2222-4222-8222-222222222222",
    name: "Rookie",
    tag: "QST",
    side: "blue",
    agentName: null,
    scoreTotal: null,
    kills: null,
    deaths: null,
    assists: null,
    damageDealt: null,
    damageReceived: null,
    headshots: null,
    bodyshots: null,
    legshots: null,
  });
});
