// Public surface; codemap.md lists the files the code lives in.
const {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
} = require("./valorant-operations");
const {
  listBindings,
  listTeams,
  bindTeam,
  detachBinding,
  discover,
} = require("./valorant-teams.service");
const { reconcileSeries, getReconciliationReport } = require("./valorant-reconcile.service");
const {
  requireSeriesWithUuid,
  createSeries,
  createManualSeries,
  getSeries,
  listSeries,
  deleteSeries,
  updateSeriesPlayedAt,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
} = require("./valorant-series.service");
const {
  upsertMatchProjection,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  listSeriesMatches,
} = require("./valorant-matches.service");
const { getRankings, getRatingHistory, getTeamSeries } = require("./valorant-rankings.service");

module.exports = {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
  listBindings,
  listTeams,
  bindTeam,
  detachBinding,
  discover,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  listSeriesMatches,
  upsertMatchProjection,
  requireSeriesWithUuid,
  createSeries,
  createManualSeries,
  getSeries,
  listSeries,
  deleteSeries,
  updateSeriesPlayedAt,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
  reconcileSeries,
  getReconciliationReport,
  getRankings,
  getRatingHistory,
  getTeamSeries,
};
