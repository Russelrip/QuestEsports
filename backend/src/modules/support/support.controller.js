const { asyncHandler } = require("../../lib/async-handler");
const { streamFileToResponse } = require("../../lib/stream-response");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");
const service = require("./support.service");

const meta = () => ({ serverNow: new Date().toISOString() });
const respond = (res, data, status = 200) => res.status(status).json({ success: true, data, meta: meta() });

const scalarField = (body, field) => {
  const value = body?.[field];
  if (Array.isArray(value)) throw new HttpError(400, `${field} must be provided once.`);
  return value;
};

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

const unreadSummary = asyncHandler(async (req, res) => respond(res,
  await service.getUserUnreadSummary({ userId: req.user.id }),
));

const createConversation = asyncHandler(async (req, res) => respond(
  res,
  await service.createConversation({
    ownerUserId: req.user.id,
    subject: scalarField(req.body, "subject"),
    body: scalarField(req.body, "body"),
    ...(req.files ? { screenshots: req.files } : {}),
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
    body: scalarField(req.body, "body"),
    ...(req.files ? { screenshots: req.files } : {}),
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
    throughMessageId: req.body?.throughMessageId,
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
    body: scalarField(req.body, "body"),
    ...(req.files ? { screenshots: req.files } : {}),
    isStaff: true,
  }),
  201,
));

const updateAdminStatus = asyncHandler(async (req, res) => respond(
  res,
  await service.changeConversationStatus({
    conversationId: req.params.conversationId,
    actorUserId: req.user.id,
    status: scalarField(req.body, "status"),
    isStaff: true,
  }),
));

const streamAttachment = asyncHandler(async (req, res) => {
  const attachment = await service.getAttachmentContent({
    attachmentId: req.params.attachmentId,
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
  });
  res.setHeader("Content-Type", attachment.contentType);
  res.setHeader("Content-Length", attachment.byteSize);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200);
  await streamFileToResponse(attachment.path, res);
});

module.exports = {
  unreadSummary,
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
  streamAttachment,
};
