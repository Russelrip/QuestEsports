const { asyncHandler } = require("../../lib/async-handler");
const service = require("./notification.service");

const meta = () => ({ serverNow: new Date().toISOString() });

const list = asyncHandler(async (req, res) => res.status(200).json({
  success: true,
  data: await service.listNotifications({ userId: req.user.id, limit: req.query.limit }),
  meta: meta(),
}));

const read = asyncHandler(async (req, res) => {
  await service.markNotificationRead({ userId: req.user.id, recipientId: req.params.id });
  res.status(200).json({ success: true, data: { read: true }, meta: meta() });
});

const readAll = asyncHandler(async (req, res) => {
  const result = await service.markAllNotificationsRead(req.user.id);
  res.status(200).json({ success: true, data: { updated: result.count }, meta: meta() });
});

const subscribe = asyncHandler(async (req, res) => {
  await service.savePushSubscription({ userId: req.user.id, body: req.body, userAgent: req.headers["user-agent"] });
  res.status(201).json({ success: true, data: { subscribed: true }, meta: meta() });
});

const unsubscribe = asyncHandler(async (req, res) => {
  await service.revokePushSubscription({ userId: req.user.id, endpoint: req.body.endpoint });
  res.status(200).json({ success: true, data: { subscribed: false }, meta: meta() });
});

const preference = asyncHandler(async (req, res) => res.status(200).json({
  success: true,
  data: await service.updatePreference({ userId: req.user.id, body: req.body || {} }),
  meta: meta(),
}));

module.exports = { list, read, readAll, subscribe, unsubscribe, preference };
