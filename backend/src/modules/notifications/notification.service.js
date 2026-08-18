const webpush = require("web-push");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { prisma } = require("../../lib/prisma");
const { normalizeText } = require("../../lib/validation");
const { publishRealtimeEvent } = require("../realtime/realtime.service");

const pushEnabled = Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT, env.WEB_PUSH_PUBLIC_KEY, env.WEB_PUSH_PRIVATE_KEY);
}

const normalizeUserIds = (userIds) => [...new Set((userIds || []).filter(Boolean))].slice(0, 500);

const sendPushToUsers = async (userIds, notification) => {
  if (!pushEnabled || !userIds.length) return;
  const disabledPreferences = await prisma.userNotificationPreference.findMany({
    where: { userId: { in: userIds }, matchPushEnabled: false },
    select: { userId: true },
  });
  const disabledUserIds = disabledPreferences.map((entry) => entry.userId);
  const subscriptions = await prisma.webPushSubscription.findMany({
    where: {
      userId: { in: userIds, ...(disabledUserIds.length ? { notIn: disabledUserIds } : {}) },
      revokedAt: null,
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    take: 1000,
  });
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.actionUrl || "/profile",
    tag: notification.eventKey,
  });
  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 3600, urgency: "normal", topic: notification.id.slice(0, 32) });
      await prisma.webPushSubscription.update({
        where: { id: subscription.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) {
        await prisma.webPushSubscription.update({
          where: { id: subscription.id },
          data: { revokedAt: new Date() },
        });
        return;
      }
      logger.warn("Web push delivery failed", {
        subscriptionId: subscription.id,
        statusCode: error?.statusCode || null,
      });
    }
  }));
};

const createNotification = async ({
  eventKey,
  type,
  title,
  body,
  actionUrl = null,
  matchRoomId = null,
  userIds,
  expiresAt = null,
  sendPush = true,
  publishRealtime = true,
}) => {
  const recipients = normalizeUserIds(userIds);
  if (!recipients.length) return null;
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        eventKey: normalizeText(eventKey).slice(0, 240),
        type: normalizeText(type).slice(0, 80),
        title: normalizeText(title).slice(0, 160),
        body: normalizeText(body).slice(0, 500),
        actionUrl: normalizeText(actionUrl).slice(0, 500) || null,
        matchRoomId,
        expiresAt,
        recipients: {
          create: recipients.map((userId) => ({ userId })),
        },
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      notification = await prisma.notification.findUnique({ where: { eventKey: normalizeText(eventKey).slice(0, 240) } });
    } else {
      throw error;
    }
  }
  if (!notification) return null;
  if (publishRealtime) {
    recipients.forEach((userId) => {
      publishRealtimeEvent(`user:${userId}`, { kind: "notification", notificationId: notification.id });
    });
  }
  if (sendPush) void sendPushToUsers(recipients, notification).catch((error) => logger.warn("Web push batch failed", { error }));
  return notification;
};

const listNotifications = async ({ userId, limit = 30 }) => {
  const take = Math.min(Math.max(Number.parseInt(String(limit), 10) || 30, 1), 100);
  const now = new Date();
  const [rows, unreadCount, preference] = await prisma.$transaction([
    prisma.notificationRecipient.findMany({
      where: {
        userId,
        notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
      include: { notification: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.notificationRecipient.count({
      where: {
        userId,
        readAt: null,
        notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
    }),
    prisma.userNotificationPreference.findUnique({ where: { userId } }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.notification.type,
      title: row.notification.title,
      body: row.notification.body,
      actionUrl: row.notification.actionUrl,
      seenAt: row.seenAt,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    unreadCount,
    push: { enabled: pushEnabled, publicKey: pushEnabled ? env.WEB_PUSH_PUBLIC_KEY : null },
    preference: preference || { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false },
  };
};

const markNotificationRead = async ({ userId, recipientId }) => {
  const result = await prisma.notificationRecipient.updateMany({
    where: { id: recipientId, userId },
    data: { seenAt: new Date(), readAt: new Date() },
  });
  if (!result.count) throw new HttpError(404, "Notification not found.");
};

const markAllNotificationsRead = async (userId) => prisma.notificationRecipient.updateMany({
  where: { userId, readAt: null },
  data: { seenAt: new Date(), readAt: new Date() },
});

const savePushSubscription = async ({ userId, body, userAgent }) => {
  if (!pushEnabled) throw new HttpError(503, "Browser push is not configured.");
  const endpoint = normalizeText(body?.endpoint);
  const p256dh = normalizeText(body?.keys?.p256dh);
  const auth = normalizeText(body?.keys?.auth);
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new HttpError(400, "Invalid push subscription endpoint.");
  }
  if (parsed.protocol !== "https:" || endpoint.length > 2000 || !p256dh || !auth) {
    throw new HttpError(400, "Invalid push subscription.");
  }
  await prisma.$transaction([
    prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 512), userAgent: normalizeText(userAgent).slice(0, 500) || null },
      update: { userId, p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 512), revokedAt: null, userAgent: normalizeText(userAgent).slice(0, 500) || null },
    }),
    prisma.userNotificationPreference.upsert({
      where: { userId },
      create: { userId, matchPushEnabled: true },
      update: { matchPushEnabled: true },
    }),
  ]);
};

const revokePushSubscription = async ({ userId, endpoint }) => {
  await prisma.webPushSubscription.updateMany({
    where: { userId, endpoint: normalizeText(endpoint) },
    data: { revokedAt: new Date() },
  });
};

const updatePreference = async ({ userId, body }) => prisma.userNotificationPreference.upsert({
  where: { userId },
  create: {
    userId,
    matchPushEnabled: body.matchPushEnabled !== false,
    soundEnabled: body.soundEnabled !== false,
    matchEmailEnabled: false,
  },
  update: {
    ...(body.matchPushEnabled !== undefined ? { matchPushEnabled: Boolean(body.matchPushEnabled) } : {}),
    ...(body.soundEnabled !== undefined ? { soundEnabled: Boolean(body.soundEnabled) } : {}),
    matchEmailEnabled: false,
  },
});

module.exports = {
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  savePushSubscription,
  revokePushSubscription,
  updatePreference,
  pushEnabled,
};
