const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const realtimePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const webPushPath = require.resolve("web-push");

const loadService = ({ prisma = {}, publishRealtimeEvent = () => {}, pushError = null, pushWarnings = [] } = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma: {
    notification: { create: async () => ({ id: "n1" }), findUnique: async () => ({ id: "n1" }) },
    userNotificationPreference: { findMany: async () => [] },
    webPushSubscription: { findMany: async () => [], update: async () => null },
    ...prisma,
  } },
  [realtimePath]: { publishRealtimeEvent },
  [loggerPath]: { logger: { warn: (message) => pushWarnings.push(message), error: () => {} } },
  [envPath]: { env: {
    WEB_PUSH_PUBLIC_KEY: "test-public-key",
    WEB_PUSH_PRIVATE_KEY: "test-private-key",
    WEB_PUSH_SUBJECT: "mailto:test@example.com",
  } },
  [webPushPath]: {
    setVapidDetails: () => {},
    sendNotification: async () => { if (pushError) throw pushError; },
  },
});

const notificationInput = (overrides = {}) => ({
  eventKey: "support-message:m1",
  type: "support_message",
  title: "New support message",
  body: "Please help",
  userIds: ["u1"],
  sendPush: false,
  ...overrides,
});

test("createNotification publishes realtime by default for existing callers", async () => {
  const events = [];
  const { module: service, restore } = loadService({
    publishRealtimeEvent: (topic, payload) => events.push({ topic, payload }),
  });
  try {
    await service.createNotification(notificationInput());
    assert.deepEqual(events, [{
      topic: "user:u1",
      payload: { kind: "notification", notificationId: "n1" },
    }]);
  } finally { restore(); }
});

test("createNotification can persist without publishing realtime when requested", async () => {
  let createCount = 0;
  const events = [];
  const { module: service, restore } = loadService({
    prisma: { notification: { create: async () => { createCount += 1; return { id: "n2" }; } } },
    publishRealtimeEvent: (...args) => events.push(args),
  });
  try {
    const result = await service.createNotification(notificationInput({ publishRealtime: false }));
    assert.equal(result.id, "n2");
    assert.equal(createCount, 1);
    assert.deepEqual(events, []);
  } finally { restore(); }
});

test("durable notification failures still reject, while post-persistence realtime failures retain existing default behavior", async () => {
  const durableFailure = new Error("notification database unavailable");
  const { module: service, restore } = loadService({
    prisma: { notification: { create: async () => { throw durableFailure; } } },
  });
  try {
    await assert.rejects(service.createNotification(notificationInput()), durableFailure);
  } finally { restore(); }

  const realtimeFailure = new Error("notification realtime unavailable");
  const loaded = loadService({ publishRealtimeEvent: () => { throw realtimeFailure; } });
  try {
    await assert.rejects(loaded.module.createNotification(notificationInput()), realtimeFailure);
  } finally { loaded.restore(); }
});

test("post-persistence push failures are logged and do not reject notification creation", async () => {
  const pushWarnings = [];
  const { module: service, restore } = loadService({
    prisma: {
      webPushSubscription: {
        findMany: async () => [{ id: "sub-1", endpoint: "https://push.invalid", p256dh: "key", auth: "auth" }],
      },
    },
    pushError: new Error("push provider unavailable"),
    pushWarnings,
  });
  try {
    const result = await service.createNotification(notificationInput({ sendPush: true, publishRealtime: false }));
    assert.equal(result.id, "n1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pushWarnings.includes("Web push delivery failed"));
  } finally { restore(); }
});
