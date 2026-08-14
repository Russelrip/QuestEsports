const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
// Namespace import (deviation from plan): the plan destructured 20 service
// functions and then redeclared 18 of them as handlers — a const redeclaration
// SyntaxError. Importing the service as a namespace and calling through it
// keeps the public handler names and module.exports exactly as specified.
const valorantService = require("./valorant.service");

const requireBody = (body, names) => {
  for (const name of names) {
    if (body?.[name] === undefined || body?.[name] === null || body?.[name] === "") {
      throw new HttpError(400, `Missing required field: ${name}.`);
    }
  }
};

const writeAudit = async (req, { targetType, targetId, afterData }) =>
  recordAudit({
    ...requestAuditContext(req),
    action: `valorant.${targetType}`,
    targetType,
    targetId,
    afterData,
  });

const listTeams = asyncHandler(async (req, res) => {
  const data = await valorantService.listTeams({ actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { bindings: data }, meta: { serverNow: new Date().toISOString() } });
});

const bindTeam = asyncHandler(async (req, res) => {
  requireBody(req.body, ["savedTeamId"]);
  const binding = await valorantService.bindTeam({
    savedTeamId: req.body.savedTeamId,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_binding", targetId: binding.id, afterData: { savedTeamId: req.body.savedTeamId } });
  res.status(200).json({ success: true, data: { binding }, meta: { serverNow: new Date().toISOString() } });
});

const detachBinding = asyncHandler(async (req, res) => {
  const binding = await valorantService.detachBinding({
    bindingId: req.params.bindingId,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_binding", targetId: binding.id, afterData: { status: "detached" } });
  res.status(200).json({ success: true, data: { binding }, meta: { serverNow: new Date().toISOString() } });
});

const discover = asyncHandler(async (req, res) => {
  requireBody(req.body, ["playerA", "playerB"]);
  const data = await valorantService.discover({
    playerA: req.body.playerA,
    playerB: req.body.playerB,
    pageSize: req.body.pageSize,
    maxPages: req.body.maxPages,
    map: req.body.map,
    from: req.body.from,
    actorUserId: req.user.id,
    requestId: req.requestId,
  });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const importMatch = asyncHandler(async (req, res) => {
  requireBody(req.body, ["henrikMatchId"]);
  const data = await valorantService.importMatch({
    henrikMatchId: req.body.henrikMatchId,
    affinity: req.body.affinity || "eu",
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_match", targetId: data.match.matchId, afterData: { henrikMatchId: req.body.henrikMatchId, created: data.created } });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const getMatchByHenrikId = asyncHandler(async (req, res) => {
  const match = await valorantService.getMatchByHenrikId({ henrikMatchId: req.params.henrikMatchId, actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { match }, meta: { serverNow: new Date().toISOString() } });
});

const listMatches = asyncHandler(async (req, res) => {
  const data = await valorantService.listMatches({ cursor: req.query.cursor, limit: req.query.limit, actorUserId: req.user.id });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const listSeriesMatches = asyncHandler(async (req, res) => {
  const matches = await valorantService.listSeriesMatches({ seriesId: req.params.seriesId, actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { matches }, meta: { serverNow: new Date().toISOString() } });
});

const createSeries = asyncHandler(async (req, res) => {
  requireBody(req.body, ["bindingTeamAId", "bindingTeamBId", "format", "playedAt", "anchorPlayerA", "anchorPlayerB"]);
  const playedAt = new Date(req.body.playedAt);
  if (Number.isNaN(playedAt.getTime())) throw new HttpError(400, "Invalid playedAt.");
  const series = await valorantService.createSeries({
    bindingTeamAId: req.body.bindingTeamAId,
    bindingTeamBId: req.body.bindingTeamBId,
    format: req.body.format,
    playedAt,
    ratingModePreference: req.body.ratingModePreference || null,
    anchorPlayerA: req.body.anchorPlayerA,
    anchorPlayerB: req.body.anchorPlayerB,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_series", targetId: series.id, afterData: { externalKey: series.externalKey, format: series.format } });
  res.status(201).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const listSeries = asyncHandler(async (req, res) => {
  const data = await valorantService.listSeries();
  res.status(200).json({ success: true, data: { series: data }, meta: { serverNow: new Date().toISOString() } });
});

const getSeries = asyncHandler(async (req, res) => {
  const series = await valorantService.getSeries({ seriesId: req.params.id });
  res.status(200).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const deleteSeries = asyncHandler(async (req, res) => {
  await valorantService.deleteSeries({ seriesId: req.params.id, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "delete" } });
  res.status(200).json({ success: true, data: { message: "Draft series deleted." }, meta: { serverNow: new Date().toISOString() } });
});

const attachGame = asyncHandler(async (req, res) => {
  // teamASide is optional — FastAPI derives the side from the anchors when
  // omitted. Only gameNumber and matchId are required.
  requireBody(req.body, ["gameNumber", "matchId"]);
  const game = await valorantService.attachGame({
    seriesId: req.params.id,
    gameNumber: req.body.gameNumber,
    matchId: req.body.matchId,
    teamASide: req.body.teamASide,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_game", targetId: game.id, afterData: { matchId: req.body.matchId, gameNumber: game.gameNumber } });
  res.status(201).json({ success: true, data: { game }, meta: { serverNow: new Date().toISOString() } });
});

const setGameOrder = asyncHandler(async (req, res) => {
  requireBody(req.body, ["games"]);
  await valorantService.setGameOrder({ seriesId: req.params.id, games: req.body.games, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "set_game_order", games: req.body.games } });
  res.status(200).json({ success: true, data: { message: "Game order updated." }, meta: { serverNow: new Date().toISOString() } });
});

const removeGame = asyncHandler(async (req, res) => {
  await valorantService.removeGame({ seriesId: req.params.id, gameId: req.params.gameId, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_game", targetId: req.params.gameId, afterData: { action: "remove" } });
  res.status(200).json({ success: true, data: { message: "Game removed." }, meta: { serverNow: new Date().toISOString() } });
});

const previewSeries = asyncHandler(async (req, res) => {
  const preview = await valorantService.previewSeries({ seriesId: req.params.id, actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { preview }, meta: { serverNow: new Date().toISOString() } });
});

const finalizeSeries = asyncHandler(async (req, res) => {
  const result = await valorantService.finalizeSeries({
    seriesId: req.params.id,
    ratingMode: req.body.ratingMode || null,
    officialWinnerTeamId: req.body.officialWinnerTeamId || null,
    overrideReason: req.body.overrideReason || null,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "finalize", operationId: result.operationId || null, ratingMode: result.ratingMode || null } });
  // FinalizeResult fields are surfaced first-class under `data` (spec §6.4),
  // not nested under `data.result` — the controller test asserts
  // `res.payload.data.status`, and the UI consumes `data.series_id`/`data.status`.
  res.status(200).json({ success: true, data: { ...result }, meta: { serverNow: new Date().toISOString() } });
});

const getRankings = asyncHandler(async (req, res) => {
  const rankings = await valorantService.getRankings({ actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { rankings }, meta: { serverNow: new Date().toISOString() } });
});

const getRatingHistory = asyncHandler(async (req, res) => {
  const events = await valorantService.getRatingHistory({ teamId: req.params.teamId, actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { events }, meta: { serverNow: new Date().toISOString() } });
});

const getTeamSeries = asyncHandler(async (req, res) => {
  const series = await valorantService.getTeamSeries({ teamId: req.params.teamId, actorUserId: req.user.id });
  res.status(200).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const getReconciliation = asyncHandler(async (req, res) => {
  const report = await valorantService.getReconciliationReport({ actorUserId: req.user.id });
  await writeAudit(req, { targetType: "valorant_reconciliation", targetId: null, afterData: { counts: { orphaned: report.orphaned.length, unprojected: report.unprojected.length, teamMissing: report.teamMissing.length, matchMissing: report.matchMissing.length, stuckOperations: report.stuckOperations.length } } });
  res.status(200).json({ success: true, data: { report }, meta: { serverNow: new Date().toISOString() } });
});

module.exports = {
  listTeams,
  bindTeam,
  detachBinding,
  discover,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  listSeriesMatches,
  createSeries,
  listSeries,
  getSeries,
  deleteSeries,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
  getRankings,
  getRatingHistory,
  getTeamSeries,
  getReconciliation,
};
