const {
  getLeaderboard,
  searchLeaderboard,
  checkPuuid: fetchCheckPuuid,
  checkDiscord: fetchCheckDiscord,
  previewRegistration: fetchPreviewRegistration,
  submitRegistration: fetchSubmitRegistration,
} = require("./client");
const { requireLinkedDiscord } = require("../auth/discord-link.service");

// valorantsl-new LeaderboardEntry (snake_case) -> Quest projection (camelCase).
// Field names come from valorantsl-new backend/app/models/user.py LeaderboardEntry.
const mapLeaderboardEntry = (entry) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
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
  const entry = raw ? mapLeaderboardEntry(raw) : null;
  // The legacy exact lookup must never reveal a private Discord-only match.
  return entry && scoreEntry(entry, normalize(query)) !== null ? entry : null;
};

// --- Ranked partial search -------------------------------------------------
// The upstream only offers an EXACT Discord-username lookup, which makes the
// public search box unusable unless you already know the username character for
// character. We page the whole leaderboard into a short-lived snapshot once and
// match against public Riot fields locally, so a Riot name, a tag, or a
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
// it still matches, but always sorts below a name hit.
const TAG_PENALTY = 3;

const scoreEntry = (entry, needle) => {
  const candidates = [
    matchScore(normalize(entry.name), needle),
    matchScore(normalize(`${entry.name}#${entry.tag}`), needle),
  ];
  const tagScore = matchScore(normalize(entry.tag), needle);
  if (tagScore !== null) candidates.push(tagScore + TAG_PENALTY);
  const scores = candidates.filter((score) => score !== null);
  return scores.length > 0 ? Math.min(...scores) : null;
};

const searchLeaderboardPlayers = async (query, { limit = SEARCH_RESULT_LIMIT } = {}) => {
  const needle = normalize(query);
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

module.exports = {
  listLeaderboard,
  searchLeaderboardPlayer,
  searchLeaderboardPlayers,
  checkPuuid,
  checkDiscord,
  previewRegistration,
  submitRegistration,
};
