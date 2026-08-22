const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const service = require("./veto.service");
const { notifyVetoTurn } = require("../match-rooms/match-room.service");

const meta = () => ({ serverNow: new Date().toISOString() });
const tokenFrom = (req) => String(req.headers["x-veto-token"] || "").trim();
const publish = async (room) => {
  publishRealtimeEvent(`veto:${room.code}`, { roomCode: room.code, revision: room.revision, status: room.status });
  await notifyVetoTurn(room);
};

const audit = async (req, action, room, extra) => recordAudit({
  ...requestAuditContext(req), action, targetType: "VetoRoom", targetId: room.id,
  afterData: { roomId: room.id, code: room.code, revision: room.revision, status: room.status, ...extra },
});

const catalog = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.listCatalog(req.query), meta: meta() }));
const createPool = asyncHandler(async (req, res) => {
  const data = await service.createPool({ user: req.user, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "veto.map_pool.created", targetType: "VetoMapPool", targetId: data.id, afterData: { name: data.name, tournamentId: data.tournamentId, version: data.version } });
  res.status(201).json({ success: true, data, meta: meta() });
});
const createMap = asyncHandler(async (req, res) => {
  const data = await service.createMap({ user: req.user, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "veto.map.created", targetType: "VetoMap", targetId: data.id, afterData: { slug: data.slug, isActive: data.isActive } });
  res.status(201).json({ success: true, data, meta: meta() });
});
const updateMap = asyncHandler(async (req, res) => {
  const map = await service.updateMapAvailability({ user: req.user, mapId: req.params.id, isActive: req.body?.isActive });
  await recordAudit({
    ...requestAuditContext(req), action: "veto.map.availability.updated", targetType: "VetoMap", targetId: map.id,
    afterData: { id: map.id, slug: map.slug, name: map.name, isActive: map.isActive },
  });
  res.status(200).json({ success: true, data: map, meta: meta() });
});
const createPreset = asyncHandler(async (req, res) => {
  const data = await service.createPreset({ user: req.user, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "veto.rule_preset.created", targetType: "VetoRulePreset", targetId: data.id, afterData: { name: data.name, format: data.format, tournamentId: data.tournamentId } });
  res.status(201).json({ success: true, data, meta: meta() });
});
const createTemplate = asyncHandler(async (req, res) => {
  const data = await service.createTemplate({ user: req.user, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "veto.room_template.created", targetType: "VetoRoomTemplate", targetId: data.id, afterData: { name: data.name, format: data.format, tournamentId: data.tournamentId } });
  res.status(201).json({ success: true, data, meta: meta() });
});
const tournamentConfig = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getTournamentConfig({ user: req.user, tournamentId: req.params.id }), meta: meta() }));
const saveTournamentConfig = asyncHandler(async (req, res) => {
  const data = await service.saveTournamentConfig({ user: req.user, tournamentId: req.params.id, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "veto.tournament_config.updated", targetType: "TournamentVetoConfig", targetId: req.params.id, afterData: { defaultTemplateId: data.defaultTemplateId || null } });
  res.status(200).json({ success: true, data, meta: meta() });
});

const listRooms = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.listRooms({ user: req.user, tournamentId: req.query.tournamentId }), meta: meta() }));
const createRoom = asyncHandler(async (req, res) => {
  const result = await service.createRoom({ user: req.user, body: req.body });
  await audit(req, "veto.room.created", result.room);
  await publish(result.room);
  res.status(201).json({ success: true, data: result, meta: meta() });
});
const getAdminRoom = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getAdminRoom({ user: req.user, roomId: req.params.roomId }), meta: meta() }));
const getRoom = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getRoom({ code: req.params.code, user: req.user, token: tokenFrom(req) }), meta: meta() }));
const myRooms = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getMyRooms(req.user), meta: meta() }));

const runRoomCommand = (name, fn, { transactionAudited = false } = {}) => asyncHandler(async (req, res) => {
  const room = await fn();
  if (!transactionAudited) await audit(req, name, room, { command: name });
  await publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});

const openRoom = (req, res, next) => runRoomCommand("veto.room.opened", () => service.openRoom({ user: req.user, roomId: req.params.roomId, revision: req.body.expectedRevision }))(req, res, next);
const startRoom = (req, res, next) => runRoomCommand("veto.room.started", () => service.startRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const assignTeamA = (req, res, next) => runRoomCommand("veto.team_order.assigned", () => service.assignTeamA({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const recordManualToss = (req, res, next) => runRoomCommand("veto.toss.recorded", () => service.recordManualToss({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const rewindRoom = (req, res, next) => runRoomCommand("veto.room.rewound", () => service.rewindRoom({ user: req.user, roomId: req.params.roomId, body: req.body, auditContext: requestAuditContext(req) }), { transactionAudited: true })(req, res, next);
const resetRoom = (req, res, next) => runRoomCommand("veto.room.reset", () => service.resetRoom({ user: req.user, roomId: req.params.roomId, body: req.body, auditContext: requestAuditContext(req) }), { transactionAudited: true })(req, res, next);
const cancelRoom = (req, res, next) => runRoomCommand("veto.room.cancelled", () => service.cancelRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);

const readyRoom = asyncHandler(async (req, res) => {
  const room = await service.readyRoom({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  await publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const tossRoom = asyncHandler(async (req, res) => {
  const room = await service.tossRoom({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  await publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const chooseTeamA = asyncHandler(async (req, res) => {
  const room = await service.chooseTeamA({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  await publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const submitAction = asyncHandler(async (req, res) => {
  const room = await service.submitAction({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body, auditContext: requestAuditContext(req) });
  await publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const rotateGrant = asyncHandler(async (req, res) => {
  const data = await service.rotateGrant({ user: req.user, roomId: req.params.roomId, role: req.body.role });
  await recordAudit({ ...requestAuditContext(req), action: "veto.access.rotated", targetType: "VetoRoom", targetId: req.params.roomId, afterData: { role: data.role } });
  res.status(200).json({ success: true, data, meta: meta() });
});

module.exports = {
  catalog, createMap, updateMap, createPool, createPreset, createTemplate, tournamentConfig, saveTournamentConfig,
  listRooms, createRoom, getAdminRoom, getRoom, myRooms, openRoom, startRoom, assignTeamA,
  readyRoom, tossRoom, recordManualToss, chooseTeamA, submitAction, rewindRoom, resetRoom,
  cancelRoom, rotateGrant,
};
