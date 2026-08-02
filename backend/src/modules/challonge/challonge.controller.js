const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const {
  getAdminIntegration,
  saveAdminIntegration,
  listSyncLogs,
  updateParticipantMapping,
  createChallongeParticipant,
  updateChallongeParticipant,
  deleteChallongeParticipant,
  changeChallongeTournamentState,
  updateChallongeMatchResult,
  syncChallongeIntegration,
  getPublicBracket,
} = require("./challonge.service");

const meta = (extra = {}) => ({ serverNow: new Date().toISOString(), ...extra });

const getIntegration = asyncHandler(async (req, res) => {
  const data = await getAdminIntegration(req.params.id);
  res.status(200).json({ success: true, data, meta: meta() });
});

const saveIntegration = asyncHandler(async (req, res) => {
  const before = await getAdminIntegration(req.params.id);
  const data = await saveAdminIntegration({ tournamentId: req.params.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.integration.updated",
    targetType: "ChallongeIntegration",
    targetId: data.id,
    beforeData: before,
    afterData: data,
  });
  publishRealtimeEvent("brackets", { tournamentId: req.params.id, integrationId: data.id });
  res.status(200).json({ success: true, data, meta: meta() });
});

const syncIntegration = asyncHandler(async (req, res) => {
  const integration = await getAdminIntegration(req.params.id);
  if (!integration) throw new HttpError(404, "Configure the Challonge integration before synchronizing.");
  const result = await syncChallongeIntegration({
    integrationId: integration.id,
    trigger: "manual",
    requestId: req.requestId || req.id || null,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.integration.synchronized",
    targetType: "ChallongeIntegration",
    targetId: integration.id,
    afterData: { skipped: result.skipped, syncedAt: result.syncedAt || null },
  });
  publishRealtimeEvent("brackets", { tournamentId: req.params.id, integrationId: integration.id, syncedAt: result.syncedAt || null });
  publishRealtimeEvent("matches", { tournamentId: req.params.id, source: "challonge", syncedAt: result.syncedAt || null });
  res.status(200).json({
    success: true,
    data: await getAdminIntegration(req.params.id),
    meta: meta({ syncResult: { skipped: result.skipped, reason: result.reason || null, syncedAt: result.syncedAt || null } }),
  });
});

const getLogs = asyncHandler(async (req, res) => {
  const data = await listSyncLogs(req.params.id);
  res.status(200).json({ success: true, data, meta: meta() });
});

const createParticipant = asyncHandler(async (req, res) => {
  const data = await createChallongeParticipant({ tournamentId: req.params.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.participant.created",
    targetType: "ChallongeParticipant",
    targetId: data.id,
    afterData: data,
  });
  res.status(201).json({ success: true, data, meta: meta() });
});

const updateParticipant = asyncHandler(async (req, res) => {
  const data = await updateChallongeParticipant({
    tournamentId: req.params.id,
    participantId: req.params.participantId,
    body: req.body,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.participant.updated",
    targetType: "ChallongeParticipant",
    targetId: data.id,
    afterData: data,
  });
  res.status(200).json({ success: true, data, meta: meta() });
});

const deleteParticipant = asyncHandler(async (req, res) => {
  const data = await deleteChallongeParticipant({
    tournamentId: req.params.id,
    participantId: req.params.participantId,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.participant.deleted",
    targetType: "ChallongeParticipant",
    targetId: data.id,
    afterData: data,
  });
  res.status(200).json({ success: true, data, meta: meta() });
});

const changeTournamentState = asyncHandler(async (req, res) => {
  const data = await changeChallongeTournamentState({ tournamentId: req.params.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.tournament.state_changed",
    targetType: "ChallongeTournament",
    targetId: data.tournamentId,
    afterData: data,
  });
  res.status(200).json({ success: true, data, meta: meta() });
});

const updateMatchResult = asyncHandler(async (req, res) => {
  const data = await updateChallongeMatchResult({
    tournamentId: req.params.id,
    matchId: req.params.matchId,
    body: req.body,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.match.result_updated",
    targetType: "ChallongeMatch",
    targetId: data.id,
    afterData: data,
  });
  res.status(200).json({ success: true, data, meta: meta() });
});

const mapParticipant = asyncHandler(async (req, res) => {
  const data = await updateParticipantMapping({
    tournamentId: req.params.id,
    participantId: req.params.participantId,
    body: req.body,
  });
  await recordAudit({
    ...requestAuditContext(req),
    action: "challonge.participant.mapped",
    targetType: "ChallongeParticipantLink",
    targetId: req.params.participantId,
    afterData: { registrationId: req.body.registrationId || null },
  });
  publishRealtimeEvent("matches", { tournamentId: req.params.id, participantLinkId: req.params.participantId });
  res.status(200).json({ success: true, data, meta: meta() });
});

const publicBracket = asyncHandler(async (req, res) => {
  const data = await getPublicBracket(req.params.slug);
  res.status(200).json({ success: true, data, meta: meta() });
});

module.exports = {
  getIntegration,
  saveIntegration,
  syncIntegration,
  getLogs,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  changeTournamentState,
  updateMatchResult,
  mapParticipant,
  publicBracket,
};
