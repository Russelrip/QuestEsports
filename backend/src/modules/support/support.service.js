const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { prisma } = require("../../lib/prisma");
const { normalizeText } = require("../../lib/validation");
const { createNotification } = require("../notifications/notification.service");
const { publishRealtimeEvent } = require("../realtime/realtime.service");

const MAX_SUBJECT_LENGTH = 160;
const MAX_BODY_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STATUSES = new Set(["OPEN", "PENDING_USER", "PENDING_STAFF", "RESOLVED"]);

const userSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatarImageName: true,
  role: true,
};

const conversationInclude = {
  owner: { select: userSelect },
  assignedStaff: { select: userSelect },
  messages: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { sender: { select: userSelect } },
  },
};

const conversationSummaryInclude = {
  owner: { select: userSelect },
  assignedStaff: { select: userSelect },
  messages: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    include: { sender: { select: userSelect } },
  },
};

const normalizeUser = (user) => user ? {
  id: user.id,
  username: user.username || null,
  firstName: user.firstName || null,
  lastName: user.lastName || null,
  avatarUrl: user.avatarImageName ? `/api/uploads/avatars/${user.avatarImageName}` : null,
} : null;

const normalizeMessage = (message) => ({
  id: message.id,
  conversationId: message.conversationId,
  senderUserId: message.senderUserId,
  body: message.body,
  createdAt: message.createdAt,
  sender: normalizeUser(message.sender),
});

const parseLimit = (value) => Math.min(
  Math.max(Number.parseInt(String(value ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1),
  MAX_PAGE_SIZE,
);

const parseCursor = (cursor) => {
  if (!cursor) return null;
  const date = new Date(cursor);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid conversation cursor.");
  return date;
};

const normalizeSubject = (subject) => normalizeText(subject).replace(/\s+/g, " ");
const normalizeBody = (body) => normalizeText(body).replace(/\s+/g, " ");

const requireUserId = (value, label = "userId") => {
  const userId = normalizeText(value);
  if (!userId) throw new HttpError(400, `${label} is required.`);
  return userId;
};

const validateSubject = (subject) => {
  const value = normalizeSubject(subject);
  if (!value || value.length > MAX_SUBJECT_LENGTH) {
    throw new HttpError(400, "Support subjects are required and must be 160 characters or fewer.");
  }
  return value;
};

const validateBody = (body) => {
  const value = normalizeBody(body);
  if (!value || value.length > MAX_BODY_LENGTH) {
    throw new HttpError(400, "Support messages are required and must be 2,000 characters or fewer.");
  }
  return value;
};

const ensureStatus = (status) => {
  const value = normalizeText(status).toUpperCase();
  if (!STATUSES.has(value)) throw new HttpError(400, "Invalid support conversation status.");
  return value;
};

const transaction = (callback) => prisma.$transaction(callback);

const findConversation = async (db, { conversationId, userId, isStaff, include = conversationInclude }) => {
  const where = { id: conversationId, ...(isStaff ? {} : { ownerUserId: userId }) };
  return db.supportConversation.findFirst({ where, include });
};

const unreadCount = async (db, conversationId, userId, lastReadAt = null) => {
  if (!userId || !db.supportMessage?.count) return 0;
  return db.supportMessage.count({
    where: {
      conversationId,
      senderUserId: { not: userId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
};

const readCursor = async (db, conversationId, userId) => {
  if (!userId || !db.supportConversationRead?.findUnique) return null;
  return db.supportConversationRead.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { lastReadAt: true },
  });
};

const mapConversation = async (conversation, userId, db = prisma) => {
  const cursor = await readCursor(db, conversation.id, userId);
  const count = await unreadCount(db, conversation.id, userId, cursor?.lastReadAt || null);
  return {
    id: conversation.id,
    ownerUserId: conversation.ownerUserId,
    subject: conversation.subject,
    status: conversation.status,
    assignedStaffUserId: conversation.assignedStaffUserId || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    resolvedAt: conversation.resolvedAt || null,
    owner: normalizeUser(conversation.owner),
    assignedStaff: normalizeUser(conversation.assignedStaff),
    messages: Array.isArray(conversation.messages) ? conversation.messages.map(normalizeMessage) : [],
    unreadCount: count,
  };
};

const mapSummary = async (conversation, userId, db = prisma) => {
  const cursor = await readCursor(db, conversation.id, userId);
  const count = await unreadCount(db, conversation.id, userId, cursor?.lastReadAt || null);
  const lastMessage = conversation.messages?.[0] ? normalizeMessage(conversation.messages[0]) : null;
  return {
    id: conversation.id,
    ownerUserId: conversation.ownerUserId,
    subject: conversation.subject,
    status: conversation.status,
    assignedStaffUserId: conversation.assignedStaffUserId || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    resolvedAt: conversation.resolvedAt || null,
    owner: normalizeUser(conversation.owner),
    assignedStaff: normalizeUser(conversation.assignedStaff),
    lastMessage,
    preview: lastMessage?.body || null,
    unreadCount: count,
  };
};

const staffUserIds = async (conversation) => {
  const assigned = conversation.assignedStaffUserId ? [conversation.assignedStaffUserId] : [];
  if (!prisma.user?.findMany) return assigned;
  const staff = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  return [...new Set([...assigned, ...staff.map((user) => user.id)].filter((id) => id && id !== conversation.ownerUserId))];
};

const messageRecipients = async ({ conversation, senderUserId, isStaff }) => {
  if (isStaff) return conversation.ownerUserId && conversation.ownerUserId !== senderUserId
    ? [conversation.ownerUserId]
    : [];
  const ids = await staffUserIds(conversation);
  return ids.filter((id) => id !== senderUserId);
};

const publishMessageEffects = async ({ conversation, message, senderUserId, isStaff }) => {
  let recipients = [];
  try {
    recipients = await messageRecipients({ conversation, senderUserId, isStaff });
  } catch {
    // Recipient lookup is best effort after the message has been committed.
  }
  const notification = {
    eventKey: `support-message:${message.id}`,
    type: "support_message",
    title: "New support message",
    body: message.body,
    actionUrl: `/support/${conversation.id}`,
    userIds: recipients,
  };

  try {
    await createNotification(notification);
  } catch (error) {
    logger.error("Support notification persistence failed", {
      conversationId: conversation.id,
      messageId: message.id,
      recipientCount: recipients.length,
      error,
    });
    // A saved support message remains the source of truth if notification delivery fails.
  }

  for (const userId of recipients) {
    let count = 0;
    try {
      const cursor = await readCursor(prisma, conversation.id, userId);
      count = await unreadCount(prisma, conversation.id, userId, cursor?.lastReadAt || null);
    } catch (error) {
      // Realtime is an optimization; clients can reconcile with the persisted thread.
      logger.warn("Support realtime unread-count lookup failed", {
        conversationId: conversation.id,
        messageId: message.id,
        userId,
        error,
      });
    }
    try {
      publishRealtimeEvent(`user:${userId}`, {
        kind: "support",
        conversationId: conversation.id,
        messageId: message.id,
        status: conversation.status,
        unreadCount: count,
      });
    } catch (error) {
      // Do not turn a persisted message into a failed request when realtime is unavailable.
      logger.warn("Support realtime delivery failed", {
        conversationId: conversation.id,
        messageId: message.id,
        userId,
        error,
      });
    }
  }
};

const listUserConversations = async ({ userId, limit, cursor } = {}) => {
  userId = requireUserId(userId);
  const take = parseLimit(limit);
  const cursorDate = parseCursor(cursor);
  return transaction(async (tx) => {
    const rows = await tx.supportConversation.findMany({
      where: { ownerUserId: userId, ...(cursorDate ? { updatedAt: { lt: cursorDate } } : {}) },
      include: conversationSummaryInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return {
      items: await Promise.all(page.map((conversation) => mapSummary(conversation, userId, tx))),
      nextCursor: hasMore ? page.at(-1)?.updatedAt?.toISOString() || null : null,
    };
  });
};

const createConversation = async ({ ownerUserId, subject, body }) => {
  ownerUserId = requireUserId(ownerUserId, "ownerUserId");
  const normalizedSubject = validateSubject(subject);
  const normalizedBody = validateBody(body);
  const conversation = await transaction((tx) => tx.supportConversation.create({
    data: {
      ownerUserId,
      subject: normalizedSubject,
      status: "OPEN",
      messages: { create: { senderUserId: ownerUserId, body: normalizedBody } },
    },
    include: conversationInclude,
  }));
  const message = conversation.messages?.[0];
  if (message) await publishMessageEffects({ conversation, message, senderUserId: ownerUserId, isStaff: false });
  return mapConversation(conversation, ownerUserId);
};

const getConversation = async ({ conversationId, userId, isStaff = false }) => {
  userId = requireUserId(userId);
  return transaction(async (tx) => {
    const conversation = await findConversation(tx, { conversationId, userId, isStaff });
    if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");
    return mapConversation(conversation, userId, tx);
  });
};

const sendMessage = async ({ conversationId, senderUserId, body, isStaff = false }) => {
  senderUserId = requireUserId(senderUserId, "senderUserId");
  const normalizedBody = validateBody(body);
  const result = await transaction(async (tx) => {
    const conversation = await findConversation(tx, {
      conversationId,
      userId: senderUserId,
      isStaff,
      include: { ...conversationInclude, messages: undefined },
    });
    if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");

    const status = isStaff ? "PENDING_USER" : "PENDING_STAFF";
    const message = await tx.supportMessage.create({
      data: { conversationId, senderUserId, body: normalizedBody },
      include: { sender: { select: userSelect } },
    });
    const updated = await tx.supportConversation.update({
      where: { id: conversationId },
      data: { status, resolvedAt: null },
    });
    return { conversation: { ...conversation, ...updated, status }, message };
  });

  await publishMessageEffects({
    conversation: result.conversation,
    message: result.message,
    senderUserId,
    isStaff,
  });
  return {
    message: normalizeMessage(result.message),
    status: result.conversation.status,
  };
};

const markConversationRead = async ({ conversationId, userId, isStaff = false }) => {
  userId = requireUserId(userId);
  const lastReadAt = new Date();
  const result = await transaction(async (tx) => {
    const conversation = await findConversation(tx, { conversationId, userId, isStaff, include: undefined });
    if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");
    return tx.supportConversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt },
      update: { lastReadAt },
    });
  });
  return { lastReadAt: result?.lastReadAt || lastReadAt, unreadCount: 0 };
};

const changeConversationStatus = async ({ conversationId, actorUserId, status, isStaff = false }) => {
  actorUserId = requireUserId(actorUserId, "actorUserId");
  const normalizedStatus = ensureStatus(status);
  if (!isStaff && !["OPEN", "RESOLVED"].includes(normalizedStatus)) {
    throw new HttpError(403, "Users may only resolve or reopen their own support conversations.");
  }
  return transaction(async (tx) => {
    const conversation = await findConversation(tx, { conversationId, userId: actorUserId, isStaff, include: undefined });
    if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");
    const updated = await tx.supportConversation.update({
      where: { id: conversationId },
      data: {
        status: normalizedStatus,
        resolvedAt: normalizedStatus === "RESOLVED" ? new Date() : null,
      },
      include: conversationInclude,
    });
    return mapConversation(updated, actorUserId, tx);
  });
};

const isStaffRecord = (user) => ["admin", "staff"].includes(String(user?.role || "").toLowerCase());

const assignConversation = async ({ conversationId, assignedStaffUserId = null, actorUserId }) => {
  actorUserId = requireUserId(actorUserId, "actorUserId");
  if (!prisma.user?.findUnique) throw new HttpError(403, "Staff authorization is required.");
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } });
  if (!isStaffRecord(actor)) throw new HttpError(403, "Staff authorization is required.");

  const assignedId = normalizeText(assignedStaffUserId) || null;
  if (assignedId) {
    const assignee = await prisma.user.findUnique({ where: { id: assignedId }, select: { id: true, role: true } });
    if (!assignee) throw new HttpError(404, "Assigned staff user not found.");
    if (!isStaffRecord(assignee)) throw new HttpError(400, "Conversations may only be assigned to staff users.");
  }

  return transaction(async (tx) => {
    const conversation = await findConversation(tx, { conversationId, isStaff: true, include: undefined });
    if (!conversation) throw new HttpError(404, "Support conversation not found.");
    const updated = await tx.supportConversation.update({
      where: { id: conversationId },
      data: { assignedStaffUserId: assignedId },
      include: conversationInclude,
    });
    return mapConversation(updated, actorUserId, tx);
  });
};

const listStaffConversations = async ({ status, assigned, search, limit, cursor, staffUserId } = {}) => {
  staffUserId = requireUserId(staffUserId, "staffUserId");
  const take = parseLimit(limit);
  const cursorDate = parseCursor(cursor);
  const normalizedStatus = status ? ensureStatus(status) : null;
  const normalizedSearch = normalizeText(search);
  let assignmentWhere = {};
  if (assigned === "unassigned" || assigned === false) assignmentWhere = { assignedStaffUserId: null };
  if (assigned === "assigned" || assigned === true) assignmentWhere = { assignedStaffUserId: { not: null } };
  if (assigned && !["assigned", "unassigned", "all", true, false].includes(assigned)) {
    assignmentWhere = { assignedStaffUserId: assigned };
  }
  return transaction(async (tx) => {
    const rows = await tx.supportConversation.findMany({
      where: {
        ...assignmentWhere,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(cursorDate ? { updatedAt: { lt: cursorDate } } : {}),
        ...(normalizedSearch ? {
          OR: [
            { subject: { contains: normalizedSearch, mode: "insensitive" } },
            { owner: { username: { contains: normalizedSearch, mode: "insensitive" } } },
            { owner: { email: { contains: normalizedSearch, mode: "insensitive" } } },
          ],
        } : {}),
      },
      include: conversationSummaryInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return {
      items: await Promise.all(page.map((conversation) => mapSummary(conversation, staffUserId, tx))),
      nextCursor: hasMore ? page.at(-1)?.updatedAt?.toISOString() || null : null,
    };
  });
};

module.exports = {
  listUserConversations,
  createConversation,
  getConversation,
  sendMessage,
  markConversationRead,
  changeConversationStatus,
  assignConversation,
  listStaffConversations,
};
