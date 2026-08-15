const {
  getLeaderboard,
  searchLeaderboard,
  getDiscordLogin: fetchDiscordLogin,
  getDiscordCallback: fetchDiscordCallback,
  checkPuuid: fetchCheckPuuid,
  previewRegistration: fetchPreviewRegistration,
  submitRegistration: fetchSubmitRegistration,
} = require("./client");

// valorantsl-new LeaderboardEntry (snake_case) -> Quest projection (camelCase).
// Field names come from valorantsl-new backend/app/models/user.py LeaderboardEntry.
const mapLeaderboardEntry = (entry) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username,
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

// Registration/auth flow: pass the upstream payload through UNCHANGED
// (snake_case — the Quest frontend consumes it as-is for this flow).
const getDiscordLogin = async () => fetchDiscordLogin();

const getDiscordCallback = async (code) => fetchDiscordCallback(code);

const checkPuuid = async (puuid) => fetchCheckPuuid(puuid);

const previewRegistration = async (puuid) => fetchPreviewRegistration(puuid);

const submitRegistration = async (input) => fetchSubmitRegistration(input);

module.exports = {
  listLeaderboard,
  searchLeaderboardPlayer,
  getDiscordLogin,
  getDiscordCallback,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
