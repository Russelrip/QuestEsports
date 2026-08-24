import { adminRequest } from "./admin";
import { buildApiUrl, fetchApiJson } from "./api";
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
  ValorantCheckPuuidResult,
  ValorantDiscordCallbackResult,
  ValorantFormat,
  ValorantMatchSummary,
  ValorantPlayerLeaderboardPage,
  ValorantPlayerLeaderboardSearchEntry,
  ValorantRatingMode,
  ValorantRegistrationPreview,
  ValorantRegistrationSubmitResult,
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

export const updateValorantSeriesPlayedAt = (seriesId: string, playedAt: string) =>
  valorantAdminRequest<{ series: QuestValorantSeries }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}`,
    { method: "PATCH", json: { playedAt } }
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
  limit = 25,
): Promise<ValorantPlayerLeaderboardSearchEntry[]> => {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  const envelope = await fetchApiJson<{ data: { entries: ValorantPlayerLeaderboardSearchEntry[] } }>(
    `/api/v1/valorant/leaderboard/search?${params.toString()}`,
    { next: { revalidate: 60 } },
    "Leaderboard request failed.",
  );
  return envelope.data.entries ?? [];
};

// Registration flow helpers. These run in the browser, so they use plain fetch
// against NEXT_PUBLIC_API_URL (no next.revalidate / ISR). Every helper throws
// an Error carrying the HTTP `status` on a non-ok response so the registration
// component can branch on 409/404/other before falling back to the message.
const registrationRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const response = await fetch(buildApiUrl(path), options);
  const payload = (await response
    .json()
    .catch(() => null)) as
    | { data?: T; message?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error?.message ||
      `Request failed with status ${response.status}.`;
    throw Object.assign(new Error(message), { status: response.status });
  }

  return payload?.data as T;
};

export const requestDiscordLogin = () =>
  registrationRequest<{ url: string }>(
    "/api/v1/valorant/leaderboard/register/discord/login",
  );

export const requestDiscordCallback = (code: string) =>
  registrationRequest<ValorantDiscordCallbackResult>(
    `/api/v1/valorant/leaderboard/register/discord/callback?code=${encodeURIComponent(code)}`,
  );

export const checkPuuidRegistered = (puuid: string) =>
  registrationRequest<ValorantCheckPuuidResult>(
    "/api/v1/valorant/leaderboard/register/check-puuid",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puuid }),
    },
  );

export const previewValorantRegistration = (puuid: string) =>
  registrationRequest<ValorantRegistrationPreview>(
    "/api/v1/valorant/leaderboard/register/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puuid }),
    },
  );

export const submitValorantRegistration = (input: {
  discord_id: number;
  discord_username: string;
  puuid: string;
}) =>
  registrationRequest<ValorantRegistrationSubmitResult>(
    "/api/v1/valorant/leaderboard/register/submit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
