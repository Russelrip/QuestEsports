const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const {
  listPublicMatches,
  getTournamentMatches,
  getAdminTournamentMatches,
  getNextMatch,
  createMatch,
  updateMatch,
  getHomeFeed,
  getTournamentCapabilities,
} = require("./match.service");

const meta = (extra = {}) => ({ serverNow: new Date().toISOString(), ...extra });

const listMatches = asyncHandler(async (req, res) => {
  const result = await listPublicMatches(req.query);
  res.status(200).json({ success: true, data: result.items, meta: meta({ pagination: result.pagination }) });
});

const listTournamentMatches = asyncHandler(async (req, res) => {
  const result = await getTournamentMatches(req.params.slug, req.query);
  const capabilities = await getTournamentCapabilities({ user: req.user, tournamentId: result.tournamentId });
  res.status(200).json({ success: true, data: result.items, meta: meta({ pagination: result.pagination, capabilities }) });
});

const listAdminTournamentMatches = asyncHandler(async (req, res) => {
  const data = await getAdminTournamentMatches(req.params.id);
  res.status(200).json({ success: true, data, meta: meta() });
});

const nextMatch = asyncHandler(async (req, res) => {
  const scope = req.query.scope === "me" ? "me" : "public";
  const data = await getNextMatch({ user: req.user, scope });
  const registrationIds = data?.participants.map((participant) => participant.registrationId).filter(Boolean) || [];
  const capabilities = await getTournamentCapabilities({ user: req.user, tournamentId: data?.tournament.id, registrationIds });
  res.status(200).json({ success: true, data, meta: meta({ capabilities }) });
});

const homeFeed = asyncHandler(async (req, res) => {
  const data = await getHomeFeed();
  res.status(200).json({ success: true, data, meta: meta() });
});

const createAdminMatch = asyncHandler(async (req, res) => {
  const data = await createMatch({ tournamentId: req.params.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "match.created",
    targetType: "Match",
    targetId: data.id,
    afterData: data,
  });
  publishRealtimeEvent("matches", { tournamentId: req.params.id, matchId: data.id, version: data.updatedAt });
  res.status(201).json({ success: true, data, meta: meta() });
});

const updateAdminMatch = asyncHandler(async (req, res) => {
  const result = await updateMatch({ matchId: req.params.matchId, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "match.updated",
    targetType: "Match",
    targetId: result.after.id,
    beforeData: result.before,
    afterData: result.after,
  });
  publishRealtimeEvent("matches", { tournamentId: result.tournamentId, matchId: result.after.id, version: result.after.updatedAt });
  res.status(200).json({ success: true, data: result.after, meta: meta() });
});

module.exports = {
  listMatches,
  listTournamentMatches,
  listAdminTournamentMatches,
  nextMatch,
  homeFeed,
  createAdminMatch,
  updateAdminMatch,
};
