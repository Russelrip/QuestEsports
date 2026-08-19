const { asyncHandler } = require("../../lib/async-handler");
const { normalizeText } = require("../../lib/validation");
const service = require("./support.service");

const meta = () => ({ serverNow: new Date().toISOString() });
const respond = (res, data, status = 200) => res.status(status).json({ success: true, data, meta: meta() });

const normalizeAssignedFilter = (value, staffUserId) => {
  const normalized = normalizeText(value);
  const assigned = normalized.toLowerCase();
  if (!assigned || assigned === "all") return undefined;
  if (assigned === "mine") return staffUserId;
  if (assigned === "true") return true;
  if (assigned === "false") return false;
  return normalized;
};

const listConversations = asyncHandler(async (req, res) => respond(
  res,
  await service.listUserConversations({
    userId: req.user.id,
    limit: req.query.limit,
    cursor: req.query.cursor,
  }),
));

const createConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.createConversation({
    ownerUserId: req.user.id,
    subject: req.body?.subject,
    body: req.body?.body,
  }),
  201,
));

const getConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.getConversation({
    conversationId: req.params.conversationId,
    userId: req.user.id,
    isStaff: false,
  }),
));

const sendMessage = asyncHandler(async (req, res) => respond(
  res,
  await service.sendMessage({
    conversationId: req.params.conversationId,
    senderUserId: req.user.id,
    body: req.body?.body,
    isStaff: false,
  }),
  201,
));

const markRead = asyncHandler(async (req, res) => respond(
  res,
  await service.markConversationRead({
    conversationId: req.params.conversationId,
    userId: req.user.id,
    isStaff: false,
  }),
));

const resolveConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.changeConversationStatus({
    conversationId: req.params.conversationId,
    actorUserId: req.user.id,
    status: "RESOLVED",
    isStaff: false,
  }),
));

const reopenConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.changeConversationStatus({
    conversationId: req.params.conversationId,
    actorUserId: req.user.id,
    status: "OPEN",
    isStaff: false,
  }),
));

const listAdminConversations = asyncHandler(async (req, res) => {
  const staffUserId = req.user.id;
  const data = await service.listStaffConversations({
    staffUserId,
    status: normalizeText(req.query.status).toUpperCase() || undefined,
    assigned: normalizeAssignedFilter(req.query.assigned, staffUserId),
    search: normalizeText(req.query.search) || undefined,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  respond(res, data);
});

const getAdminConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.getConversation({
    conversationId: req.params.conversationId,
    userId: req.user.id,
    isStaff: true,
  }),
));

const markAdminRead = asyncHandler(async (req, res) => respond(
  res,
  await service.markConversationRead({
    conversationId: req.params.conversationId,
    userId: req.user.id,
    isStaff: true,
  }),
));

const assignConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.assignConversation({
    conversationId: req.params.conversationId,
    assignedStaffUserId: req.body?.assignedStaffUserId ?? null,
    actorUserId: req.user.id,
  }),
));

const sendAdminMessage = asyncHandler(async (req, res) => respond(
  res,
  await service.sendMessage({
    conversationId: req.params.conversationId,
    senderUserId: req.user.id,
    body: req.body?.body,
    isStaff: true,
  }),
  201,
));

const updateAdminStatus = asyncHandler(async (req, res) => respond(
  res,
  await service.changeConversationStatus({
    conversationId: req.params.conversationId,
    actorUserId: req.user.id,
    status: req.body?.status,
    isStaff: true,
  }),
));

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  sendMessage,
  markRead,
  resolveConversation,
  reopenConversation,
  listAdminConversations,
  getAdminConversation,
  markAdminRead,
  assignConversation,
  sendAdminMessage,
  updateAdminStatus,
};
