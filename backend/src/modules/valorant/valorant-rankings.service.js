const crypto = require("crypto");
const { valorantRequest } = require("./valorant.client");
const { mapSeriesView, mapRankingEntry, mapRatingEvent } = require("./valorant.mapper");

const getRankings = async ({ actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: "/api/v1/rankings/teams",
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRankingEntry);
};

const getRatingHistory = async ({ teamId, actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/rating-history`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRatingEvent);
};

const getTeamSeries = async ({ teamId, actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/series`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapSeriesView);
};

module.exports = {
  getRankings,
  getRatingHistory,
  getTeamSeries,
};
