// FastAPI snake_case payloads -> Quest camelCase projections (spec §6.4).
// Field names come from the recorded contract (app/schemas/*.py); never invent fields.

const mapMatchCandidate = (candidate) => ({
  henrikMatchId: candidate.match_id,
  affinity: candidate.affinity,
  map: candidate.map ?? null,
  startedAt: candidate.started_at ?? null,
  mode: candidate.mode ?? null,
  queue: candidate.queue ?? null,
  isCompleted: candidate.is_completed,
  redScore: candidate.red_score ?? null,
  blueScore: candidate.blue_score ?? null,
  alreadyImported: candidate.already_imported,
});

const mapMatchPlayer = (player) => ({
  puuid: player.puuid,
  name: player.name,
  tag: player.tag,
  side: player.side,
  agentName: player.agent_name ?? null,
  kills: player.kills ?? null,
  deaths: player.deaths ?? null,
  assists: player.assists ?? null,
});

const mapMatchDetail = (detail) => ({
  matchId: detail.id,
  henrikMatchId: detail.henrik_match_id,
  affinity: detail.affinity,
  platform: detail.platform,
  mapName: detail.map_name,
  mode: detail.mode ?? null,
  queue: detail.queue ?? null,
  startedAt: detail.started_at,
  isCompleted: detail.is_completed,
  redScore: detail.red_score ?? null,
  blueScore: detail.blue_score ?? null,
  winningSide: detail.winning_side ?? null,
  players: (detail.players || []).map(mapMatchPlayer),
  rawPayloadAvailable: detail.raw_payload_available,
});

const mapGameView = (game) => ({
  id: game.id,
  gameNumber: game.game_number,
  matchId: game.match_id,
  mapName: game.map_name ?? null,
  teamASide: game.team_a_side,
  teamBSide: game.team_b_side,
  teamARounds: game.team_a_rounds,
  teamBRounds: game.team_b_rounds,
  winnerTeamId: game.winner_team_id ?? null,
});

const mapSeriesView = (series) => ({
  id: series.id,
  teamAId: series.team_a_id,
  teamBId: series.team_b_id,
  format: series.format,
  importance: series.importance,
  status: series.status,
  calculatedWinnerId: series.calculated_winner_id ?? null,
  officialWinnerId: series.official_winner_id ?? null,
  winnerOverrideReason: series.winner_override_reason ?? null,
  teamAMapsWon: series.team_a_maps_won,
  teamBMapsWon: series.team_b_maps_won,
  playedAt: series.played_at ?? null,
  finalizedAt: series.finalized_at ?? null,
  ratingMode: series.rating_mode ?? null,
  notes: series.notes ?? null,
  games: (series.games || []).map(mapGameView),
});

const mapPreview = (preview) => ({
  valid: preview.valid,
  teamAMapsWon: preview.team_a_maps_won,
  teamBMapsWon: preview.team_b_maps_won,
  calculatedWinnerId: preview.calculated_winner_id ?? null,
  games: (preview.games || []).map(mapGameView),
  errors: preview.errors || [],
});

const mapRatingEvent = (event) => ({
  id: event.id,
  runId: event.run_id,
  seriesId: event.series_id,
  teamId: event.team_id,
  eloBefore: event.elo_before,
  eloAfter: event.elo_after,
  result: event.result,
  sequence: event.sequence,
  kFactor: event.k_factor ?? null,
  calculationDetails: event.calculation_details || {},
});

const mapFinalizeResult = (result) => ({
  seriesId: result.series_id,
  status: result.status,
  calculatedWinnerId: result.calculated_winner_id ?? null,
  officialWinnerId: result.official_winner_id ?? null,
  winnerOverrideReason: result.winner_override_reason ?? null,
  ratingMode: result.rating_mode ?? null,
  events: (result.events || []).map(mapRatingEvent),
  teamACurrentElo: result.team_a_current_elo,
  teamBCurrentElo: result.team_b_current_elo,
});

const mapTeamResponse = (team) => ({
  id: team.id,
  name: team.name,
  shortName: team.short_name ?? null,
  slug: team.slug ?? null,
  logoUrl: team.logo_url ?? null,
  seedingElo: team.seeding_elo ?? null,
  matchesPlayed: team.matches_played,
  seriesWins: team.series_wins,
  seriesLosses: team.series_losses,
  isActive: team.is_active,
});

const mapRankingEntry = (entry) => ({
  teamId: entry.team_id,
  rank: entry.rank,
  elo: entry.elo,
  seriesWins: entry.series_wins,
  seriesLosses: entry.series_losses,
});

module.exports = {
  mapMatchCandidate,
  mapMatchDetail,
  mapGameView,
  mapSeriesView,
  mapPreview,
  mapRatingEvent,
  mapFinalizeResult,
  mapTeamResponse,
  mapRankingEntry,
};
