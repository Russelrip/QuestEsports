const fs = require("fs/promises");
const path = require("path");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { prisma } = require("../../lib/prisma");
const { normalizeText } = require("../../lib/validation");
const { createNotification } = require("../notifications/notification.service");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const {
  persistSupportScreenshotUpload,
  removeUploadFiles,
  supportScreenshotDirectory,
  SUPPORT_SCREENSHOT_MAX_FILE_SIZE,
  SUPPORT_SCREENSHOT_MAX_FILES,
  SUPPORT_SCREENSHOT_MAX_REQUEST_SIZE,
} = require("../../middleware/upload");

const MAX_SUBJECT_LENGTH = 160;
const MAX_BODY_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SUPPORT_ATTACHMENT_URL_PREFIX = "/api/v1/support/attachments/";
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
    include: { sender: { select: userSelect }, attachments: { orderBy: { position: "asc" } } },
  },
};

const conversationSummaryInclude = {
  owner: { select: userSelect },
  assignedStaff: { select: userSelect },
  messages: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    include: { sender: { select: userSelect }, attachments: { orderBy: { position: "asc" } } },
  },
};

const normalizeUser = (user) => user ? {
  id: user.id,
  username: user.username || null,
  firstName: user.firstName || null,
  lastName: user.lastName || null,
  avatarUrl: user.avatarImageName ? `/api/uploads/avatars/${user.avatarImageName}` : null,
} : null;

const normalizeAttachment = (attachment) => ({
  id: attachment.id,
  position: attachment.position,
  contentType: attachment.contentType,
  byteSize: attachment.byteSize,
  createdAt: attachment.createdAt,
  contentUrl: `${SUPPORT_ATTACHMENT_URL_PREFIX}${encodeURIComponent(attachment.id)}/content`,
});

const normalizeMessage = (message) => ({
  id: message.id,
  conversationId: message.conversationId,
  senderUserId: message.senderUserId,
  body: message.body,
  createdAt: message.createdAt,
  sender: normalizeUser(message.sender),
  attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizeAttachment) : [],
});

const attachmentFiles = (screenshots) => {
  if (screenshots === undefined || screenshots === null) return [];
  if (!Array.isArray(screenshots)) throw new HttpError(400, "Support screenshots must be uploaded as repeated screenshots fields.");
  if (screenshots.length > SUPPORT_SCREENSHOT_MAX_FILES) {
    throw new HttpError(400, `A support message may include at most ${SUPPORT_SCREENSHOT_MAX_FILES} screenshots.`);
  }
  const sizes = screenshots.map((file) => Number(file?.buffer?.length ?? file?.size ?? 0));
  if (sizes.some((size) => size > SUPPORT_SCREENSHOT_MAX_FILE_SIZE)) {
    throw new HttpError(413, "A support screenshot is too large.");
  }
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes > SUPPORT_SCREENSHOT_MAX_REQUEST_SIZE) {
    throw new HttpError(413, "The combined support screenshots are too large.");
  }
  return screenshots;
};

const persistSupportAttachments = async (screenshots) => {
  const files = attachmentFiles(screenshots);
  const persisted = [];
  try {
    for (const [position, file] of files.entries()) {
      const upload = await persistSupportScreenshotUpload(file);
      persisted.push({ ...upload, position, directory: supportScreenshotDirectory });
    }
    return persisted;
  } catch (error) {
    await removeUploadFiles(persisted).catch(() => undefined);
    throw error;
  }
};

const removePersistedSupportAttachments = async (attachments) => {
  await removeUploadFiles(attachments.map(({ filename, directory }) => ({ filename, directory })));
};

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
      OR: [{ senderUserId: { not: userId } }, { senderUserId: null }],
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
    title: isStaff ? "Quest Support replied" : "New support message",
    body: "Open your private conversation to view the message.",
    actionUrl: isStaff
      ? `/support/${conversation.id}`
      : `/admin/support?conversationId=${encodeURIComponent(conversation.id)}`,
    userIds: recipients,
    publishRealtime: false,
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
  const [cursorTime, cursorId] = String(cursor || "").split("|");
  const cursorDate = parseCursor(cursorTime);
  return transaction(async (tx) => {
    const rows = await tx.supportConversation.findMany({
      where: { ownerUserId: userId, ...(cursorDate ? { OR: [{ updatedAt: { lt: cursorDate } }, ...(cursorId ? [{ updatedAt: cursorDate, id: { lt: cursorId } }] : [])] } : {}) },
      include: conversationSummaryInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return {
      items: await Promise.all(page.map((conversation) => mapSummary(conversation, userId, tx))),
      nextCursor: hasMore ? `${page.at(-1).updatedAt.toISOString()}|${page.at(-1).id}` : null,
    };
  });
};

// Count across the complete owner inbox, independently of paginated alerts.
const getUserUnreadSummary = async ({ userId }) => {
  userId = requireUserId(userId);
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "unreadConversations"
    FROM support_conversations c
    LEFT JOIN support_conversation_reads r
      ON r.conversation_id = c.id AND r.user_id = ${userId}::uuid
    WHERE c.owner_user_id = ${userId}::uuid
      AND EXISTS (
        SELECT 1 FROM support_messages m
        WHERE m.conversation_id = c.id
          AND m.sender_user_id IS DISTINCT FROM ${userId}::uuid
          AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      )
  `;
  return { unreadConversations: Number(rows[0]?.unreadConversations || 0) };
};

const createConversation = async ({ ownerUserId, subject, body, screenshots }) => {
  ownerUserId = requireUserId(ownerUserId, "ownerUserId");
  const normalizedSubject = validateSubject(subject);
  const normalizedBody = validateBody(body);
  const persistedAttachments = await persistSupportAttachments(screenshots);
  let conversation;
  try {
    conversation = await transaction((tx) => tx.supportConversation.create({
      data: {
        ownerUserId,
        subject: normalizedSubject,
        status: "OPEN",
        messages: { create: {
          senderUserId: ownerUserId,
          body: normalizedBody,
          ...(persistedAttachments.length ? {
            attachments: { create: persistedAttachments.map(({ filename, contentType, byteSize, position }) => ({ storedFilename: filename, contentType, byteSize, position })) },
          } : {}),
        } },
      },
      include: conversationInclude,
    }));
  } catch (error) {
    await removePersistedSupportAttachments(persistedAttachments).catch(() => undefined);
    throw error;
  }
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

const sendMessage = async ({ conversationId, senderUserId, body, screenshots, isStaff = false }) => {
  senderUserId = requireUserId(senderUserId, "senderUserId");
  const normalizedBody = validateBody(body);
  const persistedAttachments = await persistSupportAttachments(screenshots);
  let result;
  try {
    result = await transaction(async (tx) => {
      const conversation = await findConversation(tx, {
        conversationId,
        userId: senderUserId,
        isStaff,
        include: { ...conversationInclude, messages: undefined },
      });
      if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");

      const status = isStaff ? "PENDING_USER" : "PENDING_STAFF";
      const message = await tx.supportMessage.create({
        data: {
          conversationId,
          senderUserId,
          body: normalizedBody,
          ...(persistedAttachments.length ? {
            attachments: { create: persistedAttachments.map(({ filename, contentType, byteSize, position }) => ({ storedFilename: filename, contentType, byteSize, position })) },
          } : {}),
        },
        include: { sender: { select: userSelect }, attachments: { orderBy: { position: "asc" } } },
      });
      const updated = await tx.supportConversation.update({
        where: { id: conversationId },
        data: { status, resolvedAt: null },
      });
      return { conversation: { ...conversation, ...updated, status }, message };
    });
  } catch (error) {
    await removePersistedSupportAttachments(persistedAttachments).catch(() => undefined);
    throw error;
  }

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

const getAttachmentContent = async ({ attachmentId, userId, isAdmin = false }) => {
  userId = requireUserId(userId);
  const attachment = await prisma.supportMessageAttachment?.findUnique?.({
    where: { id: attachmentId },
    select: {
      id: true,
      storedFilename: true,
      contentType: true,
      byteSize: true,
      message: { select: { conversation: { select: { ownerUserId: true } } } },
    },
  });
  const ownerUserId = attachment?.message?.conversation?.ownerUserId;
  if (!attachment || (!isAdmin && ownerUserId !== userId)) {
    throw new HttpError(404, "Support attachment not found.");
  }
  const storedFilename = String(attachment.storedFilename || "");
  if (!/^[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(storedFilename)) {
    throw new HttpError(404, "Support attachment not found.");
  }
  const filePath = path.join(supportScreenshotDirectory, storedFilename);
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error("not a file");
  } catch {
    throw new HttpError(404, "Support attachment not found.");
  }
  return {
    id: attachment.id,
    path: filePath,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
  };
};

const markConversationRead = async ({ conversationId, userId, isStaff = false, throughMessageId }) => {
  userId = requireUserId(userId);
  const result = await transaction(async (tx) => {
    const conversation = await findConversation(tx, { conversationId, userId, isStaff, include: undefined });
    if (!conversation) throw new HttpError(isStaff ? 404 : 403, "Support conversation not found.");
    // Old clients may omit the boundary; new clients acknowledge only rendered messages.
    const boundary = await tx.supportMessage.findFirst({
      where: { conversationId, ...(throughMessageId ? { id: throughMessageId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
    });
    if (!boundary) throw new HttpError(400, "A displayed message is required to mark this conversation read.");
    const lastReadAt = boundary.createdAt;
    await tx.supportConversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt },
      update: {},
    });
    // An older tab must never move the shared read cursor backwards.
    await tx.supportConversationRead.updateMany({
      where: { conversationId, userId, lastReadAt: { lt: lastReadAt } },
      data: { lastReadAt },
    });
    const saved = await readCursor(tx, conversationId, userId);
    const displayedMessages = await tx.supportMessage.findMany({
      where: { conversationId, createdAt: { lte: lastReadAt } },
      select: { id: true },
    });
    await tx.notificationRecipient.updateMany({
      where: { userId, readAt: null, notification: {
        type: "support_message",
        eventKey: { in: displayedMessages.map((message) => `support-message:${message.id}`) },
      } },
      data: { readAt: new Date() },
    });
    return { lastReadAt: saved.lastReadAt, unreadCount: await unreadCount(tx, conversationId, userId, saved.lastReadAt) };
  });
  return result;
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
  getUserUnreadSummary,
  listUserConversations,
  createConversation,
  getConversation,
  sendMessage,
  markConversationRead,
  changeConversationStatus,
  assignConversation,
  listStaffConversations,
  getAttachmentContent,
};
