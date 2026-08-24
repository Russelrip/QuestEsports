const { asyncHandler } = require("../../lib/async-handler");
const {
  listLeaderboard,
  searchLeaderboardPlayers,
  getDiscordLogin: serviceGetDiscordLogin,
  getDiscordCallback: serviceGetDiscordCallback,
  checkPuuid: serviceCheckPuuid,
  previewRegistration: servicePreviewRegistration,
  submitRegistration: serviceSubmitRegistration,
} = require("./service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listLeaderboard({ page, perPage });
  respond(res, data);
});

const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 25;

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = clamp(parsePositiveInt(req.query.limit, SEARCH_LIMIT_DEFAULT), 1, SEARCH_LIMIT_MAX);
  const entries = query ? await searchLeaderboardPlayers(query, { limit }) : [];
  // `entry` is the legacy single-result field, kept so older clients keep working.
  respond(res, { entries, entry: entries[0] ?? null });
});

const getDiscordLogin = asyncHandler(async (req, res) => {
  const data = await serviceGetDiscordLogin();
  respond(res, data);
});

const getDiscordCallback = asyncHandler(async (req, res) => {
  const data = await serviceGetDiscordCallback(String(req.query.code || ""));
  respond(res, data);
});

const checkPuuid = asyncHandler(async (req, res) => {
  const data = await serviceCheckPuuid(String(req.body?.puuid || ""));
  respond(res, data);
});

const previewRegistration = asyncHandler(async (req, res) => {
  const data = await servicePreviewRegistration(String(req.body?.puuid || ""));
  respond(res, data);
});

const submitRegistration = asyncHandler(async (req, res) => {
  const data = await serviceSubmitRegistration(req.body || {});
  respond(res, data);
});

module.exports = {
  getLeaderboard,
  searchLeaderboard,
  getDiscordLogin,
  getDiscordCallback,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
