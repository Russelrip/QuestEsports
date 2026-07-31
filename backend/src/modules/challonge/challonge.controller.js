const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const {
  getAdminIntegration,
  saveAdminIntegration,
  listSyncLogs,
  updateParticipantMapping,
  syncChallongeIntegration,
  getPublicBracket,
} = require("./challonge.service");

const meta = () => ({ serverNow: new Date().toISOString() });

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
  res.status(200).json({ success: true, data: await getAdminIntegration(req.params.id), meta: meta() });
});

const getLogs = asyncHandler(async (req, res) => {
  const data = await listSyncLogs(req.params.id);
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
  mapParticipant,
  publicBracket,
};
