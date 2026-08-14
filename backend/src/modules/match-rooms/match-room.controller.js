const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const service = require("./match-room.service");

const meta = () => ({ serverNow: new Date().toISOString() });
const respond = (res, data, status = 200) => res.status(status).json({ success: true, data, meta: meta() });

const mine = asyncHandler(async (req, res) => respond(res, await service.listMyRooms(req.user)));
const staffRooms = asyncHandler(async (req, res) => respond(res, await service.listStaffRooms(req.user)));
const getRoom = asyncHandler(async (req, res) => respond(res, await service.getRoom({ code: req.params.code, user: req.user })));
const messages = asyncHandler(async (req, res) => respond(res, await service.listMessages({ code: req.params.code, user: req.user, before: req.query.before, limit: req.query.limit })));
const sendMessage = asyncHandler(async (req, res) => respond(res, await service.sendMessage({ code: req.params.code, user: req.user, body: req.body }), 201));
const read = asyncHandler(async (req, res) => respond(res, await service.markRoomRead({ code: req.params.code, user: req.user })));
const support = asyncHandler(async (req, res) => respond(res, await service.listSupport({ code: req.params.code, user: req.user })));
const openSupport = asyncHandler(async (req, res) => respond(res, await service.openSupport({ code: req.params.code, user: req.user, body: req.body }), 201));
const replySupport = asyncHandler(async (req, res) => respond(res, await service.replySupport({ code: req.params.code, requestId: req.params.requestId, user: req.user, body: req.body }), 201));

const sync = asyncHandler(async (req, res) => {
  const room = await service.ensureMatchRoom({ matchId: req.params.matchId, force: true });
  await recordAudit({ ...requestAuditContext(req), action: "match.room.synced", targetType: "Match", targetId: req.params.matchId, afterData: { roomId: room.id, code: room.code } });
  respond(res, room, 201);
});

const hide = asyncHandler(async (req, res) => {
  await service.hideMessage({ code: req.params.code, messageId: req.params.messageId, user: req.user, reason: req.body.reason });
  await recordAudit({ ...requestAuditContext(req), action: "match.room.message.hidden", targetType: "MatchRoomMessage", targetId: req.params.messageId, afterData: { reason: req.body.reason } });
  respond(res, { hidden: true });
});

const mute = asyncHandler(async (req, res) => {
  await service.setMemberMute({ code: req.params.code, memberId: req.params.memberId, user: req.user, mutedUntil: req.body.mutedUntil });
  await recordAudit({ ...requestAuditContext(req), action: "match.room.member.muted", targetType: "MatchRoomMember", targetId: req.params.memberId, afterData: { mutedUntil: req.body.mutedUntil || null } });
  respond(res, { mutedUntil: req.body.mutedUntil || null });
});

const lock = asyncHandler(async (req, res) => {
  const data = await service.setChatLock({ code: req.params.code, user: req.user, locked: req.body.locked !== false });
  await recordAudit({ ...requestAuditContext(req), action: "match.room.chat.locked", targetType: "MatchRoom", targetId: req.params.code, afterData: data });
  respond(res, data);
});

const resolveSupport = asyncHandler(async (req, res) => {
  await service.resolveSupport({ code: req.params.code, requestId: req.params.requestId, user: req.user });
  await recordAudit({ ...requestAuditContext(req), action: "match.room.support.resolved", targetType: "MatchSupportRequest", targetId: req.params.requestId });
  respond(res, { resolved: true });
});

module.exports = {
  mine,
  staffRooms,
  getRoom,
  messages,
  sendMessage,
  read,
  support,
  openSupport,
  replySupport,
  sync,
  hide,
  mute,
  lock,
  resolveSupport,
};
