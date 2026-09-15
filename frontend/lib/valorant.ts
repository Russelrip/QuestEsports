export const VALORANT_FORMATS = ["bo1", "bo3", "bo5"] as const;
export type ValorantFormat = (typeof VALORANT_FORMATS)[number];
export type ValorantSide = "red" | "blue";
export type ValorantSeriesStatus = "draft" | "finalized" | "orphaned" | "reconciliation_required";
export type ValorantBindingStatus = "active" | "detached";
export type ValorantOperationStatus = "pending" | "in_flight" | "succeeded" | "failed" | "reconciliation_required";
export type ValorantRatingMode = "normal" | "unrated" | "forfeit_no_rating" | "forfeit_result_only" | "manual_override";

export type RiotId = { name: string; tag: string };
export type ResolvedPlayer = { id: string; puuid: string; name: string; tag: string; affinity: string };
export type MatchCandidate = {
  henrikMatchId: string; affinity: string; map: string | null; startedAt: string | null;
  mode: string | null; queue: string | null; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; alreadyImported: boolean;
  matchId?: string | null;
};
export type MatchPlayer = {
  puuid: string; name: string; tag: string; side: ValorantSide;
  agentName: string | null; kills: number | null; deaths: number | null; assists: number | null;
};
export type MatchDetail = {
  matchId: string; henrikMatchId: string; affinity: string; platform: string; mapName: string;
  mode: string | null; queue: string | null; startedAt: string; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; winningSide: ValorantSide | null;
  players: MatchPlayer[]; rawPayloadAvailable: boolean;
};
export type ValorantMatchSummary = {
  matchId: string; henrikMatchId: string; affinity: string; platform: string; mapName: string;
  mode: string | null; queue: string | null; startedAt: string; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; winningSide: ValorantSide | null;
  anchorASide?: ValorantSide | null;
};
export type Binding = {
  id: string; savedTeamId: string | null; valorantTeamUuid: string; status: ValorantBindingStatus;
  boundByUserId: string | null; boundAt: string; detachedAt: string | null;
  savedTeam: { id: string; name: string; teamTag: string | null } | null;
  boundByUser: { id: string; username: string } | null;
};
export type SeriesGame = {
  id: string; questSeriesId: string; gameNumber: number; matchId: string;
  teamASide: ValorantSide; teamBSide: ValorantSide; mapName: string | null;
};
export type QuestValorantSeries = {
  id: string; externalKey: string; bindingAId: string; bindingBId: string; format: ValorantFormat;
  playedAt: string; ratingModePreference: ValorantRatingMode | null; ratingMode: ValorantRatingMode | null;
  anchorPlayerAName: string | null; anchorPlayerATag: string | null;
  anchorPlayerBName: string | null; anchorPlayerBTag: string | null;
  status: ValorantSeriesStatus;
  valorantSeriesUuid: string | null; finalizedById: string | null; lastOperationId: string | null;
  bindingA: Binding; bindingB: Binding; games: SeriesGame[];
  lastOperation: QuestValorantOperation | null;
  tournament?: { id: string; title: string } | null;
};
export type QuestValorantOperation = {
  id: string; operationId: string; type: string; externalKey: string | null; questSeriesId: string | null;
  status: ValorantOperationStatus; fastapiRequestId: string | null; responseCode: number | null;
  errorCode: string | null; responseSummary: Record<string, unknown> | null;
};
export type GameView = {
  id: string; gameNumber: number; matchId: string; mapName: string | null;
  teamASide: ValorantSide; teamBSide: ValorantSide;
  teamARounds: number; teamBRounds: number; winnerTeamId: string | null;
};
export type SeriesPreview = {
  valid: boolean; teamAMapsWon: number; teamBMapsWon: number;
  calculatedWinnerId: string | null; games: GameView[]; errors: string[];
};
export type RatingEvent = {
  id: string; runId: string; seriesId: string; teamId: string; eloBefore: string; eloAfter: string;
  result: string; sequence: number; kFactor: number | null; calculationDetails: Record<string, unknown>;
};
export type FinalizeResult = {
  seriesId: string; status: string; calculatedWinnerId: string | null; officialWinnerId: string | null;
  winnerOverrideReason: string | null; ratingMode: ValorantRatingMode | null;
  events: RatingEvent[]; teamACurrentElo: number; teamBCurrentElo: number; operationId: string;
};
export type ManualSeriesInput = {
  bindingTeamAId: string;
  bindingTeamBId: string;
  format: ValorantFormat;
  playedAt: string;
  ratingMode: ValorantRatingMode;
  winnerTeamId: string;
  teamAMapsWon: number;
  teamBMapsWon: number;
  tournamentId?: string | null;
};
export type RankingEntry = { teamId: string; rank: number; elo: number; seriesWins: number; seriesLosses: number };
export type SeriesViewLite = {
  id: string; teamAId: string; teamBId: string; format: ValorantFormat; status: string;
  teamAMapsWon: number; teamBMapsWon: number; playedAt: string | null; ratingMode: ValorantRatingMode | null;
};
export type ReconciliationReport = {
  orphaned: Array<{ id: string; externalKey: string; valorantSeriesUuid: string | null; status: ValorantSeriesStatus }>;
  unprojected: Array<{ id: string; externalQuestSeriesId: string | null }>;
  teamMissing: Binding[];
  matchMissing: Array<{ id: string; matchId: string; henrikMatchId: string }>;
  stuckOperations: Array<{ id: string; operationId: string; type: string; status: ValorantOperationStatus; questSeriesId: string | null }>;
};
export type DiscoverResponse = {
  players: { a: ResolvedPlayer; b: ResolvedPlayer };
  candidates: MatchCandidate[];
  search: { pagesExamined: number; pageSize: number };
};

export const mapsForFormat = (format: ValorantFormat): number =>
  ({ bo1: 1, bo3: 3, bo5: 5 })[format];

export const REQUIRES_REASON_RATING_MODES: ReadonlySet<ValorantRatingMode> = new Set([
  "manual_override",
  "forfeit_no_rating",
  "forfeit_result_only",
]);

export const ratingModeLabel = (mode: ValorantRatingMode | null): string => {
  switch (mode) {
    case "normal": return "Rated";
    case "unrated": return "Unrated";
    case "forfeit_no_rating": return "Forfeit — no rating";
    case "forfeit_result_only": return "Forfeit — result only";
    case "manual_override": return "Manual override";
    default: return "Not set";
  }
};

export const seriesStatusLabel = (status: ValorantSeriesStatus): string =>
  ({ draft: "Draft", finalized: "Finalized", orphaned: "Orphaned", reconciliation_required: "Reconciliation required" })[status];

export const operationStatusLabel = (status: ValorantOperationStatus): string =>
  ({ pending: "Pending", in_flight: "In progress", succeeded: "Succeeded", failed: "Failed", reconciliation_required: "Reconciliation required" })[status];

const RIOT_ID_PATTERN = /^([^#\s]{1,32})#([^#\s]{1,16})$/;

export const parseRiotIdInput = (value: string): RiotId | null => {
  const match = RIOT_ID_PATTERN.exec(String(value || "").trim());
  return match ? { name: match[1], tag: match[2] } : null;
};

// Stored roster Riot IDs may carry loose spacing around the separator (e.g. "Jiren #JAANU").
// Split on the FIRST "#" and trim both sides so the stored value still resolves to a RiotId.
export const parseStoredRiotId = (value: string): RiotId | null => {
  const trimmed = String(value || "").trim();
  const separatorIndex = trimmed.indexOf("#");
  if (separatorIndex === -1) return null;
  const name = trimmed.slice(0, separatorIndex).trim();
  const tag = trimmed.slice(separatorIndex + 1).trim();
  return name && tag ? { name, tag } : null;
};

export const formatRiotId = (id: RiotId): string => `${id.name}#${id.tag}`;

export const buildValorantTrackerProfileUrl = (name: string, tag: string): string | null => {
  const trimmedName = String(name || "").trim();
  const trimmedTag = String(tag || "").trim();
  if (!trimmedName || !trimmedTag) return null;
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(`${trimmedName}#${trimmedTag}`)}/overview`;
};

export const teamValuesFromSide = <T>(
  anchorASide: ValorantSide | null | undefined,
  onRed: T,
  onBlue: T,
): { teamA: T; teamB: T } | null =>
  anchorASide === "red"
    ? { teamA: onRed, teamB: onBlue }
    : anchorASide === "blue"
      ? { teamA: onBlue, teamB: onRed }
      : null;

export const mapMatchSummary = (raw: {
  id: string; henrik_match_id: string; affinity: string; platform: string; map_name: string;
  mode?: string | null; queue?: string | null; started_at: string; is_completed: boolean;
  red_score?: number | null; blue_score?: number | null; winning_side?: string | null;
  anchor_a_side?: string | null;
}): ValorantMatchSummary => ({
  matchId: raw.id,
  henrikMatchId: raw.henrik_match_id,
  affinity: raw.affinity,
  platform: raw.platform,
  mapName: raw.map_name,
  mode: raw.mode ?? null,
  queue: raw.queue ?? null,
  startedAt: raw.started_at,
  isCompleted: raw.is_completed,
  redScore: raw.red_score ?? null,
  blueScore: raw.blue_score ?? null,
  winningSide: raw.winning_side === "red" || raw.winning_side === "blue" ? raw.winning_side : null,
  anchorASide: raw.anchor_a_side === "red" || raw.anchor_a_side === "blue" ? raw.anchor_a_side : null,
});

export const validateDesiredOrder = (numbers: number[], count: number): string | null => {
  const expected = new Set(Array.from({ length: count }, (_, i) => i + 1));
  const actual = new Set(numbers);
  if (actual.size !== numbers.length || actual.size !== count || ![...expected].every((n) => actual.has(n))) {
    return `Assign each map a unique number from 1 to ${count}.`;
  }
  return null;
};

export const nextGameNumber = (existing: number[], format: ValorantFormat): number | null => {
  const used = new Set(existing);
  for (let n = 1; n <= mapsForFormat(format); n += 1) {
    if (!used.has(n)) return n;
  }
  return null;
};

export const joinRankingsWithBindings = (rankings: RankingEntry[], bindings: Binding[]) => {
  const bindingByValTeamId = new Map(bindings.map((b) => [b.valorantTeamUuid, b]));
  return rankings.map((entry) => ({
    ...entry,
    teamLabel: bindingByValTeamId.get(entry.teamId)?.savedTeam?.name
      ?? `VAL team ${entry.teamId.slice(0, 8)}`,
  }));
};

export const formatEloDelta = (before: string, after: string): string => {
  const delta = Number(after) - Number(before);
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : `${delta}`;
};

export type ValorantPlayerLeaderboardEntry = {
  puuid: string;
  name: string;
  tag: string;
  discordUsername: string;
  currentTier: string | null;
  elo: number | null;
  rankInTier: number | null;
  peakRank: string | null;
  peakSeason: string | null;
  lastPlayed: string | null;
};

// A search hit carries the player's real position on the leaderboard. `rank` is
// null only when the result came from the upstream exact-match fallback, which
// does not report one.
export type ValorantPlayerLeaderboardSearchEntry = ValorantPlayerLeaderboardEntry & {
  rank: number | null;
};

export type ValorantPlayerLeaderboardPage = {
  entries: ValorantPlayerLeaderboardEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

// Admin view of a leaderboard registration. Unlike the public entries this
// covers every registered player; `onLeaderboard` is false for the ones the
// public board filters out (unranked, or no competitive match in 14 days).
export type ValorantLeaderboardRegistration = {
  puuid: string;
  name: string;
  tag: string;
  discordUsername: string;
  currentTier: string | null;
  elo: number | null;
  lastPlayed: string | null;
  updateSource: string | null;
  updatedAt: string;
  onLeaderboard: boolean;
};

export type ValorantLeaderboardRegistrationPage = {
  entries: ValorantLeaderboardRegistration[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type ValorantLeaderboardRemoval = {
  removed: ValorantLeaderboardRegistration;
  // Null only if the platform did not keep a copy (older VALORANT backend).
  removalId: string | null;
  rankingsCleared: number | null;
};

// The admin who acted; `username` is null when the account no longer exists.
export type ValorantLeaderboardActor = { id: string | null; username: string | null };

export type ValorantLeaderboardRemovedPlayer = {
  removalId: string;
  puuid: string;
  name: string;
  tag: string;
  discordUsername: string;
  currentTier: string | null;
  elo: number | null;
  lastPlayed: string | null;
  removedAt: string;
  removedBy: ValorantLeaderboardActor | null;
  restoredAt: string | null;
  restoredBy: ValorantLeaderboardActor | null;
  // The PUUID has a registration again, so restoring would collide.
  registeredAgain: boolean;
  // The same player was removed again later; only that removal can be restored.
  superseded: boolean;
  restorable: boolean;
};

export type ValorantLeaderboardRemovalPage = {
  entries: ValorantLeaderboardRemovedPlayer[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type ValorantLeaderboardRestore = {
  restored: ValorantLeaderboardRegistration;
  removalId: string;
  removedAt: string | null;
};

/** Why a removal cannot be restored, or null when it can. */
export const leaderboardRemovalBlocker = (entry: ValorantLeaderboardRemovedPlayer): string | null => {
  if (entry.restoredAt) return "Already restored";
  if (entry.superseded) return "Removed again later — restore the newer removal";
  if (entry.registeredAgain) return "Registered again";
  return entry.restorable ? null : "Cannot be restored";
};

// --- Leaderboard server check ------------------------------------------------

export type ValorantServerCheckStatus = "flagged" | "cleared" | "clear" | "not_enough_matches" | "not_checked";
export type ValorantServerCheckReason = "account_region" | "away_servers";

export type ValorantServerMatchCount = {
  // Null when Henrik did not report the server.
  cluster: string | null;
  matches: number;
  home: boolean | null;
};

export type ValorantServerCheck = {
  puuid: string;
  name: string;
  tag: string;
  discordUsername: string;
  currentTier: string | null;
  elo: number | null;
  lastPlayed: string | null;
  onLeaderboard: boolean;
  accountRegion: string;
  status: ValorantServerCheckStatus;
  reasons: ValorantServerCheckReason[];
  matches: number;
  knownMatches: number;
  awayMatches: number;
  awayShare: number | null;
  servers: ValorantServerMatchCount[];
  // Where the evidence starts: the window start, or the clearance if later.
  since: string;
  checkedAt: string | null;
  clearedAt: string | null;
  clearedBy: ValorantLeaderboardActor | null;
};

export type ValorantServerCheckRule = {
  homeClusters: string[];
  homeShard: string | null;
  windowDays: number | null;
  minMatches: number | null;
  awayShare: number | null;
};

export type ValorantServerCheckPage = {
  entries: ValorantServerCheck[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  summary: { registered: number; checked: number; flagged: number; cleared: number };
  rule: ValorantServerCheckRule;
};

const formatShare = (share: number) => `${Math.round(share * 100)}%`;

/** Plain-language reasons a player is flagged, one per reason. */
export const serverCheckReasonLines = (entry: ValorantServerCheck, rule: ValorantServerCheckRule): string[] =>
  entry.reasons.map((reason) => {
    if (reason === "account_region") {
      const home = (rule.homeShard ?? "ap").toUpperCase();
      return `Riot account is on ${entry.accountRegion.toUpperCase()}, not ${home}`;
    }
    const share = entry.awayShare === null ? "" : `${formatShare(entry.awayShare)} — `;
    return `${share}${entry.awayMatches} of ${entry.knownMatches} recent competitive matches away from ${
      rule.homeClusters.join(" and ") || "the home servers"
    }`;
  });

/** The flagging rule as one sentence, from what the platform reports. */
export const describeServerCheckRule = (rule: ValorantServerCheckRule): string => {
  const home = rule.homeClusters.join(" and ") || "the home servers";
  const share = rule.awayShare === null ? "most" : `at least ${formatShare(rule.awayShare)}`;
  const window = rule.windowDays === null ? "recent" : `the last ${rule.windowDays} days of`;
  const minimum = rule.minMatches === null ? "" : ` (from ${rule.minMatches} or more matches)`;
  const shard = (rule.homeShard ?? "ap").toUpperCase();
  return `A player is flagged when ${share} of ${window} competitive matches were played away from ${home}${minimum}, or when their Riot account is not on the ${shard} region.`;
};

export type ValorantRegistrationPreview = {
  puuid: string;
  name: string;
  tag: string;
  current_rank: string;
  elo: number;
  peak_rank: string;
  peak_season: string;
  last_played: string | null;
};

export type ValorantRegistrationSubmitResult = {
  success: boolean;
  message: string;
  player: {
    puuid: string;
    name: string;
    tag: string;
    current_rank: string | null;
    elo: number | null;
  } | null;
};

export type ValorantCheckPuuidResult = {
  exists: boolean;
  user: { name: string; tag: string } | null;
};

export const VALORANT_SL_REGISTER_URL =
  process.env.NEXT_PUBLIC_VALORANT_SL_REGISTER_URL || "https://valorantsl.com/register";
