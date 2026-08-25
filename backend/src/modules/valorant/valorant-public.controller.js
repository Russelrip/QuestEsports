const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const service = require("./valorant-public.service");

// 404, never 403, for a series that exists but is not public. Distinguishing
// "no such series" from "a series you may not see" would confirm the existence
// of unpublished events to anyone willing to guess ids.
const getPublicSeries = asyncHandler(async (req, res) => {
  const series = await service.getPublicSeries(req.params.seriesId);
  if (!series) throw new HttpError(404, "Match not found.");
  res.status(200).json({ success: true, match: series });
});

const getTournamentResults = asyncHandler(async (req, res) => {
  const results = await service.getTournamentResults(req.params.slug);
  if (!results) throw new HttpError(404, "Tournament not found.");
  res.status(200).json({ success: true, ...results });
});

module.exports = { getPublicSeries, getTournamentResults };
