const { asyncHandler } = require("../../lib/async-handler");
const { listLeaderboard, searchLeaderboardPlayer } = require("./service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listLeaderboard({ page, perPage });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const entry = query ? await searchLeaderboardPlayer(query) : null;
  res.status(200).json({ success: true, data: { entry }, meta: { serverNow: new Date().toISOString() } });
});

module.exports = { getLeaderboard, searchLeaderboard };
