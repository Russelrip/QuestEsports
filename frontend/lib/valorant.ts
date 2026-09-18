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
// public board filters out (unranked, no competitive match in 14 days, or
// hidden by staff — `hiddenAt` set).
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
  // Hidden from the public board by staff while staying registered.
  hiddenAt?: string | null;
  hiddenBy?: ValorantLeaderboardActor | null;
  // Shown to the player on their profile.
  hiddenReason?: string | null;
};

export type ValorantLeaderboardHideResult = {
  player: ValorantLeaderboardRegistration;
  // Profile ranks cleared on hide; null when that failed (never on unhide).
  rankingsCleared?: number | null;
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
  // An active ban names this player's Riot or Discord account.
  banned: boolean;
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
  if (entry.banned) return "Banned — lift the ban to restore";
  if (entry.registeredAgain) return "Registered again";
  return entry.restorable ? null : "Cannot be restored";
};

// --- Leaderboard bans --------------------------------------------------------

/**
 * A ban keeps a Riot account (PUUID) and/or a Discord account from registering.
 * The Riot ID and Discord handle are how the player looked when banned; a rename
 * does not get around the ban.
 */
export type ValorantLeaderboardBan = {
  banId: string;
  // Null when another ban already covered the Riot account.
  puuid: string | null;
  discordBanned: boolean;
  name: string;
  tag: string;
  discordUsername: string;
  reason: string | null;
  bannedAt: string;
  bannedBy: ValorantLeaderboardActor | null;
  liftedAt: string | null;
  liftedBy: ValorantLeaderboardActor | null;
  active: boolean;
};

export type ValorantLeaderboardBanStatus = "active" | "lifted" | "all";

export type ValorantLeaderboardBanPage = {
  entries: ValorantLeaderboardBan[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type ValorantLeaderboardBanResult = {
  ban: ValorantLeaderboardBan;
  // Every registration the ban took off the leaderboard: the player, and any
  // alt registered under the same Riot or Discord account.
  removed: (ValorantLeaderboardRegistration & { removalId: string })[];
  rankingsCleared: number | null;
};

/** Which accounts a ban covers, in words. */
export const leaderboardBanCovers = (ban: Pick<ValorantLeaderboardBan, "puuid" | "discordBanned">): string => {
  if (ban.puuid && ban.discordBanned) return "Riot and Discord accounts";
  return ban.puuid ? "Riot account" : "Discord account";
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

// One server across every registration.
export type ValorantServerTotal = { cluster: string; matches: number; players: number; home: boolean };

export type ValorantServerCheckView = "flagged" | "cleared" | "all";

export type ValorantServerCheckSort = "default" | "rank" | "rank_low" | "away" | "matches" | "recent" | "name";

// "default" is each view's natural order, described per view in the label.
export const SERVER_CHECK_SORT_OPTIONS: Array<{ value: ValorantServerCheckSort; label: string }> = [
  { value: "default", label: "Suggested" },
  { value: "rank", label: "Highest rank" },
  { value: "rank_low", label: "Lowest rank" },
  { value: "away", label: "Most away from home servers" },
  { value: "matches", label: "Most matches" },
  { value: "recent", label: "Recently played" },
  { value: "name", label: "Name (A–Z)" },
];

export type ValorantServerCheckPage = {
  entries: ValorantServerCheck[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  summary: { registered: number; checked: number; flagged: number; cleared: number; servers: ValorantServerTotal[] };
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

/** What the check concluded about a player who is not flagged or kept. */
export const serverCheckStatusLine = (entry: ValorantServerCheck, rule: ValorantServerCheckRule): string => {
  if (entry.status === "not_checked") return "Not checked yet";
  if (entry.status === "not_enough_matches") {
    const minimum = rule.minMatches === null ? "enough" : `${rule.minMatches}`;
    return `Too few recent competitive matches to judge (${entry.knownMatches} of ${minimum})`;
  }
  if (entry.status === "clear") return "Plays mostly on the home servers";
  if (entry.status === "cleared") return "Kept after review";
  return "Flagged";
};

/** Each server's share of all recent competitive matches, rounded. */
export const serverShareLabel = (total: ValorantServerTotal, totals: ValorantServerTotal[]): string => {
  const all = totals.reduce((sum, item) => sum + item.matches, 0);
  if (!all || !total.matches) return "0%";
  const share = Math.round((total.matches / all) * 100);
  // A server someone did play on should never read as nobody playing there.
  return share === 0 ? "<1%" : `${share}%`;
};

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
  /**
   * The account registration connected on Quest. Null when the profile already
   * held it, or when the leaderboard accepted the registration but Quest could
   * not connect it — the profile then offers to connect it.
   */
  account?: { id: string; username: string | null; tagline: string | null } | null;
};

export type ValorantCheckPuuidResult = {
  exists: boolean;
  user: { name: string; tag: string } | null;
};

export const VALORANT_SL_REGISTER_URL =
  process.env.NEXT_PUBLIC_VALORANT_SL_REGISTER_URL || "https://valorantsl.com/register";
