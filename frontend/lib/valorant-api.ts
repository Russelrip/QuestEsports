import { adminRequest } from "./admin";
import { fetchApiJson } from "./api";
import { mapMatchSummary } from "./valorant";
import type {
  Binding,
  DiscoverResponse,
  FinalizeResult,
  ManualSeriesInput,
  MatchDetail,
  QuestValorantSeries,
  RankingEntry,
  RatingEvent,
  ReconciliationReport,
  RiotId,
  SeriesGame,
  SeriesPreview,
  SeriesViewLite,
  ValorantFormat,
  ValorantMatchSummary,
  ValorantPlayerLeaderboardEntry,
  ValorantPlayerLeaderboardPage,
  ValorantRatingMode,
  ValorantSide,
} from "./valorant";

export type AdminTeamMember = {
  id: string;
  name: string;
  riotId: string | null;
};

// Admin saved-team detail exposes each member's Riot ID under the `gameId` field
// (the backend maps member.riotId -> gameId). Normalize it back to `riotId`.
export const fetchAdminTeamMembers = async (teamId: string): Promise<AdminTeamMember[]> => {
  const data = await adminRequest<{
    team: { members?: Array<{ id: string; name: string; gameId: string | null }> };
  }>(`/api/admin/teams/${encodeURIComponent(teamId)}`);
  return (data.team?.members ?? []).map((member) => ({
    id: member.id,
    name: member.name,
    riotId: member.gameId,
  }));
};

export const valorantAdminRequest = async <T>(
  path: string,
  options?: Parameters<typeof adminRequest>[1]
): Promise<T> => {
  const envelope = options
    ? await adminRequest<{ data: T }>(path, options)
    : await adminRequest<{ data: T }>(path);
  return envelope.data;
};

export const fetchValorantBindings = () =>
  valorantAdminRequest<{ bindings: Binding[] }>("/api/v1/admin/valorant/teams");

export const bindValorantTeam = (savedTeamId: string) =>
  valorantAdminRequest<{ binding: Binding }>("/api/v1/admin/valorant/teams/bind", {
    method: "POST",
    json: { savedTeamId },
  });

export const detachValorantBinding = (bindingId: string) =>
  valorantAdminRequest<{ binding: Binding }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(bindingId)}/detach`,
    { method: "DELETE" }
  );

export const discoverValorant = (input: {
  playerA: RiotId; playerB: RiotId; pageSize?: number; maxPages?: number; map?: string; from?: string;
}) => valorantAdminRequest<DiscoverResponse>("/api/v1/admin/valorant/discover", { method: "POST", json: input });

export const importValorantMatch = (henrikMatchId: string, affinity = "eu") =>
  valorantAdminRequest<{ match: MatchDetail; created: boolean }>("/api/v1/admin/valorant/matches/import", {
    method: "POST",
    json: { henrikMatchId, affinity },
  });

export const fetchValorantMatchByHenrikId = (henrikMatchId: string) =>
  valorantAdminRequest<{ match: MatchDetail }>(
    `/api/v1/admin/valorant/matches/by-henrik-id/${encodeURIComponent(henrikMatchId)}`
  );

export const fetchValorantMatches = async (filters: { cursor?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  const suffix = params.toString() ? `?${params}` : "";
  const raw = await valorantAdminRequest<{
    items: Array<{
      id: string; henrik_match_id: string; affinity: string; platform: string; map_name: string;
      mode?: string | null; queue?: string | null; started_at: string; is_completed: boolean;
      red_score?: number | null; blue_score?: number | null; winning_side?: string | null;
    }>;
    next_cursor: string | null; total: number | null;
  }>(`/api/v1/admin/valorant/matches${suffix}`);
  return { items: raw.items.map(mapMatchSummary), nextCursor: raw.next_cursor, total: raw.total };
};

export const fetchValorantSeriesMatches = (seriesId: string) =>
  valorantAdminRequest<{ matches: ValorantMatchSummary[] }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/matches`
  );

export const createValorantSeries = (input: {
  bindingTeamAId: string; bindingTeamBId: string; format: ValorantFormat; playedAt: string;
  ratingModePreference?: ValorantRatingMode | null; anchorPlayerA: RiotId; anchorPlayerB: RiotId;
  tournamentId?: string | null;
}) => valorantAdminRequest<{ series: QuestValorantSeries }>("/api/v1/admin/valorant/series", {
  method: "POST",
  json: {
    bindingTeamAId: input.bindingTeamAId,
    bindingTeamBId: input.bindingTeamBId,
    format: input.format,
    playedAt: input.playedAt,
    ratingModePreference: input.ratingModePreference,
    anchorPlayerA: input.anchorPlayerA,
    anchorPlayerB: input.anchorPlayerB,
    ...(input.tournamentId ? { tournamentId: input.tournamentId } : {}),
  },
});

export const fetchValorantSeriesList = () =>
  valorantAdminRequest<{ series: QuestValorantSeries[] }>("/api/v1/admin/valorant/series");

export const createManualValorantSeries = (input: ManualSeriesInput) =>
  valorantAdminRequest<FinalizeResult & { series: QuestValorantSeries; operationId?: string | null }>(
    "/api/v1/admin/valorant/series/manual",
    { method: "POST", json: input }
  );

export const fetchValorantSeries = (seriesId: string) =>
  valorantAdminRequest<{ series: QuestValorantSeries }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}`
  );

export const deleteValorantSeries = (seriesId: string) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}`,
    { method: "DELETE" }
  );

export const attachValorantGame = (seriesId: string, input: { gameNumber: number; matchId: string; teamASide?: ValorantSide }) =>
  valorantAdminRequest<{ game: SeriesGame }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games`,
    {
      method: "POST",
      json: {
        gameNumber: input.gameNumber,
        matchId: input.matchId,
        ...(input.teamASide ? { teamASide: input.teamASide } : {}),
      },
    }
  );

export const setValorantGameOrder = (seriesId: string, games: Array<{ gameId: string; gameNumber: number }>) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games/order`,
    { method: "PUT", json: { games } }
  );

export const removeValorantGame = (seriesId: string, gameId: string) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games/${encodeURIComponent(gameId)}`,
    { method: "DELETE" }
  );

export const fetchValorantPreview = (seriesId: string) =>
  valorantAdminRequest<{ preview: SeriesPreview }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/preview`
  );

export const finalizeValorantSeries = (seriesId: string, input: {
  ratingMode: ValorantRatingMode; officialWinnerTeamId?: string | null; overrideReason?: string | null;
}) => valorantAdminRequest<FinalizeResult>(
  `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/finalize`,
  { method: "POST", json: input }
);

export const fetchValorantRankings = () =>
  valorantAdminRequest<{ rankings: RankingEntry[] }>("/api/v1/admin/valorant/rankings");

export const fetchValorantRatingHistory = (teamId: string) =>
  valorantAdminRequest<{ events: RatingEvent[] }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(teamId)}/rating-history`
  );

export const fetchValorantTeamSeries = (teamId: string) =>
  valorantAdminRequest<{ series: SeriesViewLite[] }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(teamId)}/series`
  );

export const fetchValorantReconciliation = () =>
  valorantAdminRequest<{ report: ReconciliationReport }>("/api/v1/admin/valorant/reconciliation");

export const fetchPublicValorantLeaderboard = async (
  page = 1,
  perPage = 50,
): Promise<ValorantPlayerLeaderboardPage> => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  const envelope = await fetchApiJson<{ data: ValorantPlayerLeaderboardPage }>(
    `/api/v1/valorant/leaderboard?${params.toString()}`,
    { next: { revalidate: 60 } },
    "Leaderboard request failed.",
  );
  return envelope.data;
};

export const searchPublicValorantLeaderboard = async (
  query: string,
): Promise<ValorantPlayerLeaderboardEntry | null> => {
  const params = new URLSearchParams();
  params.set("q", query);
  const envelope = await fetchApiJson<{ data: { entry: ValorantPlayerLeaderboardEntry | null } }>(
    `/api/v1/valorant/leaderboard/search?${params.toString()}`,
    { next: { revalidate: 60 } },
    "Leaderboard request failed.",
  );
  return envelope.data.entry;
};
