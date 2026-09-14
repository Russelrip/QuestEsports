const {
  getLeaderboard,
  searchLeaderboard,
  checkPuuid: fetchCheckPuuid,
  checkDiscord: fetchCheckDiscord,
  previewRegistration: fetchPreviewRegistration,
  submitRegistration: fetchSubmitRegistration,
  repointRegistration: fetchRepointRegistration,
  listRegistrations: fetchRegistrations,
  removeRegistration: fetchRemoveRegistration,
  listRemovals: fetchRemovals,
  restoreRemoval: fetchRestoreRemoval,
  listServerChecks: fetchServerChecks,
  clearServerCheck: fetchClearServerCheck,
  reopenServerCheck: fetchReopenServerCheck,
} = require("./client");
const { requireLinkedDiscord } = require("../auth/discord-link.service");
const { prisma } = require("../../lib/prisma");
const { logger } = require("../../lib/logger");

// valorantsl-new LeaderboardEntry (snake_case) -> Quest projection (camelCase).
// Field names come from valorantsl-new backend/app/models/user.py LeaderboardEntry.
const mapLeaderboardEntry = (entry) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username ?? "",
  currentTier: entry.current_tier ?? null,
  elo: entry.elo ?? null,
  rankInTier: entry.rank_in_tier ?? null,
  peakRank: entry.peak_rank ?? null,
  peakSeason: entry.peak_season ?? null,
  lastPlayed: entry.last_played_match ?? null,
});

const listLeaderboard = async ({ page = 1, perPage = 50 } = {}) => {
  const raw = await getLeaderboard({ page, perPage });
  return {
    entries: (raw.entries || []).map(mapLeaderboardEntry),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    perPage: raw.per_page ?? perPage,
    totalPages: raw.total_pages ?? 1,
  };
};

const searchLeaderboardPlayer = async (query) => {
  const raw = await searchLeaderboard(query);
  return raw ? mapLeaderboardEntry(raw) : null;
};

// --- Ranked partial search -------------------------------------------------
// The upstream only offers an EXACT Discord-username lookup, which makes the
// public search box unusable unless you already know the username character for
// character. We page the whole leaderboard into a short-lived snapshot once and
// match against it locally, so a partial Discord name, a Riot name, a tag, or a
// full `name#tag` all find the player - and every hit keeps its real
// leaderboard rank instead of rendering as an em dash.

const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_PAGE_SIZE = 200;
// Ceiling on the upstream paging a single cold snapshot can do (200 * 25).
// A player past this cap still resolves through the exact-match fallback below.
const SNAPSHOT_MAX_PAGES = 25;
const SEARCH_RESULT_LIMIT = 25;
const MIN_QUERY_LENGTH = 2;

let snapshot = null; // { entries, complete, expiresAt }
let snapshotInFlight = null; // de-dupes concurrent cold loads

// Resolves to { entries, complete }. `complete` means the snapshot holds the
// whole leaderboard, which is what lets a local miss be treated as definitive.
const loadSnapshot = async () => {
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot;
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = (async () => {
    const entries = [];
    let totalPages = 1;
    let page = 1;
    for (; page <= Math.min(totalPages, SNAPSHOT_MAX_PAGES); page += 1) {
      const raw = await getLeaderboard({ page, perPage: SNAPSHOT_PAGE_SIZE });
      const pageEntries = raw.entries || [];
      if (pageEntries.length === 0) break;
      const perPage = raw.per_page || SNAPSHOT_PAGE_SIZE;
      for (const [index, entry] of pageEntries.entries()) {
        entries.push({ ...mapLeaderboardEntry(entry), rank: (page - 1) * perPage + index + 1 });
      }
      totalPages = raw.total_pages ?? 1;
    }
    snapshot = { entries, complete: page > totalPages, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
    return snapshot;
  })();

  try {
    return await snapshotInFlight;
  } finally {
    snapshotInFlight = null;
  }
};

const normalize = (value) => String(value ?? "").trim().toLowerCase();

// Lower is better: 0 exact, 1 prefix, 2 substring, null no match.
const matchScore = (haystack, needle) => {
  if (!haystack) return null;
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;
  return haystack.includes(needle) ? 2 : null;
};

// Riot tags are 3-5 characters, so a bare substring hit on one is mostly noise -
// it still matches, but always sorts below a name or Discord hit.
const TAG_PENALTY = 3;

// The full `name#tag` only counts when the query has a `#` in it. Otherwise
// every tag hit is also a substring hit on `name#tag`, which scored it as a name
// match and made the tag penalty dead weight.
const scoreEntry = (entry, needle) => {
  const candidates = [
    matchScore(normalize(entry.discordUsername), needle),
    matchScore(normalize(entry.name), needle),
  ];
  if (needle.includes("#")) candidates.push(matchScore(normalize(`${entry.name}#${entry.tag}`), needle));
  const tagScore = matchScore(normalize(entry.tag), needle);
  if (tagScore !== null) candidates.push(tagScore + TAG_PENALTY);
  const scores = candidates.filter((score) => score !== null);
  return scores.length > 0 ? Math.min(...scores) : null;
};

const searchLeaderboardPlayers = async (query, { limit = SEARCH_RESULT_LIMIT } = {}) => {
  // Discord handles are often pasted with a leading @.
  const needle = normalize(query).replace(/^@+/, "");
  if (needle.length < MIN_QUERY_LENGTH) return [];

  let complete = false;
  let matches = [];
  try {
    const loaded = await loadSnapshot();
    complete = loaded.complete;
    matches = loaded.entries
      .map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
      .filter((candidate) => candidate.score !== null)
      .sort((a, b) => a.score - b.score || a.entry.rank - b.entry.rank)
      .slice(0, limit)
      .map((candidate) => candidate.entry);
  } catch {
    // Snapshot paging failed (upstream slow or down) - fall through to the
    // single exact lookup rather than failing the whole search.
    complete = false;
    matches = [];
  }
  if (matches.length > 0) return matches;

  // A miss against a snapshot of the WHOLE leaderboard is the final answer;
  // spending an upstream call on it would just repeat what we already know.
  if (complete) return [];

  // The snapshot was truncated or unavailable, so the player may still exist
  // upstream. One exact lookup is a cheap backstop.
  const exact = await searchLeaderboardPlayer(query);
  return exact ? [{ ...exact, rank: null }] : [];
};

// Registration/auth flow: pass the upstream payload through UNCHANGED
// (snake_case — the Quest frontend consumes it as-is for this flow).
// Leaderboard registration is Discord-authorized: the upstream keys a player on
// their snowflake, so an unlinked caller has nothing to register with. The
// resolution itself lives in discord-link.service — this only names the reason
// the caller sees.
const resolveLinkedDiscordIdentity = (userId) => requireLinkedDiscord(
  userId,
  "Link a Discord account before registering for the VALORANT leaderboard."
);

const checkPuuid = async ({ userId, puuid }) => {
  await resolveLinkedDiscordIdentity(userId);
  const result = await fetchCheckPuuid(puuid);
  // A linked caller may query another player's PUUID. Keep that identity private.
  return {
    exists: result.exists,
    user: result.user ? { name: result.user.name, tag: result.user.tag } : null,
  };
};

// Kept for game-account linking corroboration. It is deliberately separate
// from the authenticated leaderboard registration identity resolver.
const checkDiscord = async (discordId) => fetchCheckDiscord(discordId);

const previewRegistration = async ({ userId, puuid }) => {
  // Preview is PUUID-only upstream, but still requires the same linked Discord
  // authorization as submission so it cannot be used as an anonymous probe.
  await resolveLinkedDiscordIdentity(userId);
  return fetchPreviewRegistration(puuid);
};

const submitRegistration = async ({ userId, puuid }) => {
  const { discordId, discordUsername } = await resolveLinkedDiscordIdentity(userId);
  return fetchSubmitRegistration({
    puuid,
    discord_id: discordId,
    discord_username: discordUsername,
  });
};

// Point an existing registration at a different account.
//
// The Discord identity comes from the linked account rather than the caller, so
// a request can only ever move the registration belonging to the user it is
// made for. Whether the move is allowed was decided before this: Quest reviews
// it as a game-account change request.
const repointRegistration = async ({ userId, puuid }) => {
  const { discordId, discordUsername } = await resolveLinkedDiscordIdentity(userId);
  return fetchRepointRegistration({
    puuid,
    discord_id: discordId,
    discord_username: discordUsername,
  });
};

// --- Admin: registrations ---------------------------------------------------

const mapRegistration = (entry) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username ?? "",
  currentTier: entry.current_tier ?? null,
  elo: entry.elo ?? null,
  lastPlayed: entry.last_played_match ?? null,
  updateSource: entry.update_source ?? null,
  updatedAt: entry.updated_at,
  onLeaderboard: Boolean(entry.on_leaderboard),
});

const listAdminRegistrations = async ({ query, page, perPage, actorUserId }) => {
  const raw = await fetchRegistrations({ query, page, perPage, actorUserId });
  return {
    entries: (raw.entries || []).map(mapRegistration),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    perPage: raw.per_page ?? perPage,
    totalPages: raw.total_pages ?? 1,
  };
};

// Remove a registration from the leaderboard.
//
// The upstream row is the registration; deleting it takes the player off the
// board and out of the rank updater and Discord bot passes. Two copies of it
// live in Quest and are cleared here so they do not outlast it: the search
// snapshot, and the rank shown on a linked player's profile. The Quest game
// account itself is left alone — it is the player's identity, not their
// leaderboard entry, and they can register again from it.
//
// Once the upstream delete has happened the removal is real, so clearing the
// profile rank must not be able to fail the request: a thrown error here would
// skip the audit record for a removal that did take effect. A rank left behind
// is cosmetic and the next ranking sync can no longer match it anyway.
const removeAdminRegistration = async ({ puuid, actorUserId }) => {
  const raw = await fetchRemoveRegistration({ puuid, actorUserId });
  const removed = mapRegistration(raw);
  snapshot = null;
  let rankingsCleared = 0;
  try {
    ({ count: rankingsCleared } = await prisma.playerRanking.deleteMany({
      where: {
        game: "valorant",
        player: { gameAccounts: { some: { game: "valorant", externalId: puuid } } },
      },
    }));
  } catch (error) {
    rankingsCleared = null;
    logger.warn("Leaderboard removal could not clear the cached profile rank", { error });
  }
  return { removed, removalId: raw.removal_id ?? null, rankingsCleared };
};

// --- Admin: removals ----------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Upstream records the Quest user id from the signed service token. Show the
// username; an id that no longer matches an account (or is not a user id at
// all) shows as unknown rather than as a raw id.
const loadActorNames = async (ids) => {
  const userIds = [...new Set(ids.filter((id) => UUID_PATTERN.test(String(id || ""))))];
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  return new Map(users.map((user) => [user.id, user]));
};

const mapActor = (id, names) => (id ? names.get(id) ?? { id: null, username: null } : null);

const mapRemoval = (entry, names) => ({
  removalId: entry.removal_id,
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username ?? "",
  currentTier: entry.current_tier ?? null,
  elo: entry.elo ?? null,
  lastPlayed: entry.last_played_match ?? null,
  removedAt: entry.removed_at,
  removedBy: mapActor(entry.removed_by, names),
  restoredAt: entry.restored_at ?? null,
  restoredBy: mapActor(entry.restored_by, names),
  registeredAgain: Boolean(entry.registered_again),
  superseded: Boolean(entry.superseded),
  restorable: Boolean(entry.restorable),
});

const listAdminRemovals = async ({ query, page, perPage, actorUserId }) => {
  const raw = await fetchRemovals({ query, page, perPage, actorUserId });
  const entries = raw.entries || [];
  const names = await loadActorNames(entries.flatMap((entry) => [entry.removed_by, entry.restored_by]));
  return {
    entries: entries.map((entry) => mapRemoval(entry, names)),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    perPage: raw.per_page ?? perPage,
    totalPages: raw.total_pages ?? 1,
  };
};

// Put a removed registration back. The row returns exactly as it was, so the
// board, updater and Discord bot pick the player up again on their own; the
// profile rank cleared at removal comes back with the next ranking sync.
const restoreAdminRemoval = async ({ removalId, actorUserId }) => {
  const raw = await fetchRestoreRemoval({ removalId, actorUserId });
  snapshot = null;
  return {
    restored: mapRegistration(raw),
    removalId: raw.removal_id ?? removalId,
    removedAt: raw.removed_at ?? null,
  };
};

// --- Admin: server check ------------------------------------------------------
//
// Upstream records the server of each registered player's recent competitive
// matches and flags the ones that mostly play away from the Sri Lankan servers,
// or whose Riot account is not on the AP shard. It only flags: an admin decides,
// either clearing the flag (keeping the player) or removing them through the
// ordinary audited removal above.

const mapServerCheck = (entry, names) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username ?? "",
  currentTier: entry.current_tier ?? null,
  elo: entry.elo ?? null,
  lastPlayed: entry.last_played_match ?? null,
  onLeaderboard: Boolean(entry.on_leaderboard),
  accountRegion: entry.account_region,
  status: entry.status,
  reasons: entry.reasons || [],
  matches: entry.matches ?? 0,
  knownMatches: entry.known_matches ?? 0,
  awayMatches: entry.away_matches ?? 0,
  awayShare: entry.away_share ?? null,
  servers: (entry.servers || []).map((server) => ({
    cluster: server.cluster ?? null,
    matches: server.matches,
    home: server.home ?? null,
  })),
  since: entry.since,
  checkedAt: entry.checked_at ?? null,
  clearedAt: entry.cleared_at ?? null,
  clearedBy: mapActor(entry.cleared_by, names),
});

const listAdminServerChecks = async ({ status, query, page, perPage, actorUserId }) => {
  const raw = await fetchServerChecks({ status, query, page, perPage, actorUserId });
  const entries = raw.entries || [];
  const names = await loadActorNames(entries.map((entry) => entry.cleared_by));
  const summary = raw.summary || {};
  const rule = raw.rule || {};
  return {
    entries: entries.map((entry) => mapServerCheck(entry, names)),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    perPage: raw.per_page ?? perPage,
    totalPages: raw.total_pages ?? 1,
    summary: {
      registered: summary.registered ?? 0,
      checked: summary.checked ?? 0,
      flagged: summary.flagged ?? 0,
      cleared: summary.cleared ?? 0,
    },
    rule: {
      homeClusters: rule.home_clusters || [],
      homeShard: rule.home_shard ?? null,
      windowDays: rule.window_days ?? null,
      minMatches: rule.min_matches ?? null,
      awayShare: rule.away_share ?? null,
    },
  };
};

const clearAdminServerCheck = async ({ puuid, actorUserId }) => {
  const raw = await fetchClearServerCheck({ puuid, actorUserId });
  return mapServerCheck(raw, await loadActorNames([raw.cleared_by]));
};

const reopenAdminServerCheck = async ({ puuid, actorUserId }) => {
  const raw = await fetchReopenServerCheck({ puuid, actorUserId });
  return mapServerCheck(raw, new Map());
};

module.exports = {
  listAdminServerChecks,
  clearAdminServerCheck,
  reopenAdminServerCheck,
  listAdminRegistrations,
  removeAdminRegistration,
  listAdminRemovals,
  restoreAdminRemoval,
  repointRegistration,
  listLeaderboard,
  searchLeaderboardPlayer,
  searchLeaderboardPlayers,
  checkPuuid,
  checkDiscord,
  previewRegistration,
  submitRegistration,
};
