const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const service = require("./veto.service");

const meta = () => ({ serverNow: new Date().toISOString() });
const tokenFrom = (req) => String(req.headers["x-veto-token"] || "").trim();
const publish = (room) => publishRealtimeEvent(`veto:${room.code}`, { roomCode: room.code, revision: room.revision, status: room.status });

const audit = async (req, action, room, extra) => recordAudit({
  ...requestAuditContext(req), action, targetType: "VetoRoom", targetId: room.id,
  afterData: { roomId: room.id, code: room.code, revision: room.revision, status: room.status, ...extra },
});

const catalog = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.listCatalog(req.query), meta: meta() }));
const createPool = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await service.createPool({ user: req.user, body: req.body }), meta: meta() }));
const createMap = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await service.createMap({ user: req.user, body: req.body }), meta: meta() }));
const createPreset = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await service.createPreset({ user: req.user, body: req.body }), meta: meta() }));
const createTemplate = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await service.createTemplate({ user: req.user, body: req.body }), meta: meta() }));
const tournamentConfig = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getTournamentConfig({ user: req.user, tournamentId: req.params.id }), meta: meta() }));
const saveTournamentConfig = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.saveTournamentConfig({ user: req.user, tournamentId: req.params.id, body: req.body }), meta: meta() }));

const listRooms = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.listRooms({ user: req.user, tournamentId: req.query.tournamentId }), meta: meta() }));
const createRoom = asyncHandler(async (req, res) => {
  const result = await service.createRoom({ user: req.user, body: req.body });
  await audit(req, "veto.room.created", result.room);
  publish(result.room);
  res.status(201).json({ success: true, data: result, meta: meta() });
});
const getAdminRoom = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getAdminRoom({ user: req.user, roomId: req.params.roomId }), meta: meta() }));
const getRoom = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getRoom({ code: req.params.code, user: req.user, token: tokenFrom(req) }), meta: meta() }));
const myRooms = asyncHandler(async (req, res) => res.status(200).json({ success: true, data: await service.getMyRooms(req.user), meta: meta() }));

const runRoomCommand = (name, fn) => asyncHandler(async (req, res) => {
  const room = await fn();
  await audit(req, name, room, { command: name });
  publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});

const openRoom = (req, res, next) => runRoomCommand("veto.room.opened", () => service.openRoom({ user: req.user, roomId: req.params.roomId, revision: req.body.expectedRevision }))(req, res, next);
const startRoom = (req, res, next) => runRoomCommand("veto.room.started", () => service.startRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const assignTeamA = (req, res, next) => runRoomCommand("veto.team_order.assigned", () => service.assignTeamA({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const recordManualToss = (req, res, next) => runRoomCommand("veto.toss.recorded", () => service.recordManualToss({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const rewindRoom = (req, res, next) => runRoomCommand("veto.room.rewound", () => service.rewindRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const resetRoom = (req, res, next) => runRoomCommand("veto.room.reset", () => service.resetRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);
const cancelRoom = (req, res, next) => runRoomCommand("veto.room.cancelled", () => service.cancelRoom({ user: req.user, roomId: req.params.roomId, body: req.body }))(req, res, next);

const readyRoom = asyncHandler(async (req, res) => {
  const room = await service.readyRoom({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const tossRoom = asyncHandler(async (req, res) => {
  const room = await service.tossRoom({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const chooseTeamA = asyncHandler(async (req, res) => {
  const room = await service.chooseTeamA({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const submitAction = asyncHandler(async (req, res) => {
  const room = await service.submitAction({ code: req.params.code, user: req.user, token: tokenFrom(req), body: req.body });
  publish(room);
  res.status(200).json({ success: true, data: room, meta: meta() });
});
const rotateGrant = asyncHandler(async (req, res) => {
  const data = await service.rotateGrant({ user: req.user, roomId: req.params.roomId, role: req.body.role });
  await recordAudit({ ...requestAuditContext(req), action: "veto.access.rotated", targetType: "VetoRoom", targetId: req.params.roomId, afterData: { role: data.role } });
  res.status(200).json({ success: true, data, meta: meta() });
});

module.exports = {
  catalog, createMap, createPool, createPreset, createTemplate, tournamentConfig, saveTournamentConfig,
  listRooms, createRoom, getAdminRoom, getRoom, myRooms, openRoom, startRoom, assignTeamA,
  readyRoom, tossRoom, recordManualToss, chooseTeamA, submitAction, rewindRoom, resetRoom,
  cancelRoom, rotateGrant,
};
