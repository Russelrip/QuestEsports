const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/support/support.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const notificationPath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const realtimePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const conversation = (overrides = {}) => ({
  id: "c1",
  ownerUserId: "u1",
  subject: "Cannot connect",
  status: "OPEN",
  assignedStaffUserId: null,
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  resolvedAt: null,
  owner: { id: "u1", username: "player" },
  assignedStaff: null,
  messages: [],
  ...overrides,
});

const loadService = ({ prisma = {}, notifications = [], realtime = [], timeline = [], loggerErrors = [], loggerWarnings = [], notificationError = null, realtimeError = null } = {}) => {
  const events = [];
  const completePrisma = {
    $transaction: async (work) => typeof work === "function" ? work(completePrisma) : work,
    supportConversationRead: {
      findUnique: async () => null,
      upsert: async ({ create }) => ({ ...create }),
    },
    supportMessage: { count: async () => 0 },
    user: { findMany: async () => [{ id: "staff-1" }] },
    ...prisma,
  };
  const loaded = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma: completePrisma },
    [notificationPath]: {
      createNotification: async (input) => {
        events.push(["notification", input]);
        timeline.push("notification");
        notifications.push(input);
        if (notificationError) throw notificationError;
        return { id: "notification-1" };
      },
    },
    [realtimePath]: {
      publishRealtimeEvent: (topic, payload) => {
        events.push(["realtime", topic, payload]);
        timeline.push("realtime");
        if (realtimeError) throw realtimeError;
        realtime.push({ topic, payload });
      },
    },
    [loggerPath]: {
      logger: {
        error: (message, metadata) => loggerErrors.push({ message, metadata }),
        warn: (message, metadata) => loggerWarnings.push({ message, metadata }),
      },
    },
  });
  return { ...loaded, prisma: completePrisma, events };
};

test("createConversation persists the initial message transactionally before notification and realtime", async () => {
  const order = [];
  const timeline = [];
  const created = conversation({
    messages: [{ id: "m1", conversationId: "c1", senderUserId: "u1", body: "Help", createdAt: new Date() }],
  });
  const customPrisma = {
    supportConversation: { create: async () => { order.push("create"); return created; } },
    user: { findMany: async () => [{ id: "staff-1" }] },
  };
  customPrisma.$transaction = async (work) => {
    order.push("transaction-start");
    const result = await work(customPrisma);
    order.push("persisted");
    timeline.push("persisted");
    return result;
  };
  const { module: service, restore } = loadService({
    prisma: customPrisma,
    notifications: [],
    realtime: [],
    timeline,
  });
  try {
    const result = await service.createConversation({ ownerUserId: "u1", subject: "  Cannot   connect ", body: " Help  me " });
    assert.equal(result.id, "c1");
    assert.deepEqual(order, ["transaction-start", "create", "persisted"]);
    assert.deepEqual(timeline, ["persisted", "notification", "realtime"]);
  } finally { restore(); }
});

test("subject and body are required and length limited", async () => {
  const { module: service, restore } = loadService({ prisma: { supportConversation: { create: async () => conversation() } } });
  try {
    await assert.rejects(service.createConversation({ ownerUserId: "u1", subject: "", body: "hello" }), { statusCode: 400 });
    await assert.rejects(service.createConversation({ ownerUserId: "u1", subject: "hello", body: "" }), { statusCode: 400 });
    await assert.rejects(service.createConversation({ ownerUserId: "u1", subject: "x".repeat(161), body: "hello" }), { statusCode: 400 });
    await assert.rejects(service.createConversation({ ownerUserId: "u1", subject: "hello", body: "x".repeat(2001) }), { statusCode: 400 });
  } finally { restore(); }
});

test("exports all requested operations and rejects missing user IDs before scoped queries", async () => {
  const calls = [];
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findMany: async () => { calls.push("list"); return []; },
        findFirst: async () => { calls.push("detail"); return null; },
      },
    },
  });
  try {
    assert.deepEqual(Object.keys(service).sort(), [
      "assignConversation",
      "changeConversationStatus",
      "createConversation",
      "getAttachmentContent",
      "getConversation",
      "getUserUnreadSummary",
      "listStaffConversations",
      "listUserConversations",
      "markConversationRead",
      "sendMessage",
    ]);
    await assert.rejects(service.listUserConversations({ userId: "  " }), { statusCode: 400 });
    await assert.rejects(service.getConversation({ conversationId: "c1", userId: undefined }), { statusCode: 400 });
    await assert.rejects(service.markConversationRead({ conversationId: "c1", userId: "" }), { statusCode: 400 });
    await assert.rejects(service.changeConversationStatus({ conversationId: "c1", actorUserId: "\t", status: "RESOLVED" }), { statusCode: 400 });
    assert.deepEqual(calls, []);
  } finally { restore(); }
});

test("listUserConversations scopes Prisma queries by ownerUserId", async () => {
  let query;
  const { module: service, restore } = loadService({
    prisma: { supportConversation: { findMany: async (input) => { query = input; return []; } } },
  });
  try {
    await service.listUserConversations({ userId: "u1", limit: 10 });
    assert.equal(query.where.ownerUserId, "u1");
  } finally { restore(); }
});

test("user cannot read another user's conversation", async () => {
  const { module: service, restore } = loadService({
    prisma: { supportConversation: { findFirst: async () => null } },
  });
  try {
    await assert.rejects(
      service.getConversation({ conversationId: "c1", userId: "u2", isStaff: false }),
      (error) => [403, 404].includes(error.statusCode),
    );
  } finally { restore(); }
});

test("user replies reopen a resolved conversation and move it to pending staff", async () => {
  const calls = [];
  const existing = conversation({ status: "RESOLVED", resolvedAt: new Date() });
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => { calls.push(["update", data]); return { ...existing, ...data }; },
      },
      supportMessage: {
        create: async ({ data }) => { calls.push(["message", data]); return { id: "m2", ...data, createdAt: new Date() }; },
        count: async () => 1,
      },
      user: { findMany: async () => [{ id: "staff-1" }] },
    },
  });
  try {
    const result = await service.sendMessage({ conversationId: "c1", senderUserId: "u1", body: "Still need help", isStaff: false });
    assert.equal(result.status, "PENDING_STAFF");
    assert.deepEqual(calls[0][0], "message");
    assert.equal(calls[1][1].status, "PENDING_STAFF");
    assert.equal(calls[1][1].resolvedAt, null);
  } finally { restore(); }
});

test("staff assignment is restricted to staff users", async () => {
  const { module: service, restore } = loadService({
    prisma: {
      user: { findUnique: async ({ where }) => where.id === "user-1" ? { id: "user-1", role: "user" } : null },
    },
  });
  try {
    await assert.rejects(
      service.assignConversation({ conversationId: "c1", assignedStaffUserId: "staff-1", actorUserId: "user-1" }),
      { statusCode: 403 },
    );
  } finally { restore(); }
});

test("read acknowledgements retain later unread replies and reconcile only displayed alerts", async () => {
  const readAt = new Date("2026-08-19T01:00:00.000Z");
  let saved = null;
  let alertQuery;
  let boundaryQuery;
  let unreadWhere;
  const { module: service, restore } = loadService({ prisma: {
    supportConversation: { findFirst: async () => conversation() },
    supportConversationRead: {
      findUnique: async () => saved,
      upsert: async ({ create }) => { saved ||= create; },
      updateMany: async ({ where, data }) => { if (saved.lastReadAt < where.lastReadAt.lt) saved = data; },
    },
    supportMessage: {
      findFirst: async (query) => { boundaryQuery = query; return { id: "displayed", createdAt: readAt }; },
      findMany: async ({ where }) => { assert.deepEqual(where.createdAt, { lte: readAt }); return [{ id: "displayed" }]; },
      count: async ({ where }) => { unreadWhere = where; return 1; },
    },
    notificationRecipient: { updateMany: async (query) => { alertQuery = query; } },
  } });
  try {
    const result = await service.markConversationRead({ conversationId: "c1", userId: "u1", throughMessageId: "displayed" });
    assert.deepEqual(boundaryQuery.where, { conversationId: "c1", id: "displayed" });
    assert.equal(result.lastReadAt, readAt);
    assert.equal(result.unreadCount, 1);
    assert.equal(unreadWhere.OR[0].senderUserId.not, "u1");
    assert.deepEqual(unreadWhere.createdAt, { gt: readAt });
    assert.deepEqual(alertQuery.where.notification.eventKey, { in: ["support-message:displayed"] });
    assert.equal(alertQuery.where.userId, "u1");
    saved = { lastReadAt: new Date("2026-08-20T01:00:00.000Z") };
    const olderTab = await service.markConversationRead({ conversationId: "c1", userId: "u1", throughMessageId: "displayed" });
    assert.equal(olderTab.lastReadAt.toISOString(), "2026-08-20T01:00:00.000Z");
  } finally { restore(); }
});

 test("unread summary uses a parameterized owner query without pagination or notification state", async () => {
  let query;
  const { module: service, restore } = loadService({ prisma: { $queryRaw: async (...args) => { query = args; return [{ unreadConversations: 2 }]; } } });
  try {
    assert.deepEqual(await service.getUserUnreadSummary({ userId: "u1" }), { unreadConversations: 2 });
    assert.deepEqual(query.slice(1), ["u1", "u1", "u1"]);
    assert.match(query[0].join("?"), /c.owner_user_id =/);
    assert.match(query[0].join("?"), /EXISTS/);
    await assert.rejects(service.getUserUnreadSummary({ userId: "" }), { statusCode: 400 });
  } finally { restore(); }
});

test("listStaffConversations uses the authenticated staff cursor for unread counts", async () => {
  let query;
  let readQuery;
  const row = conversation({ messages: [{ id: "m4", conversationId: "c1", senderUserId: "u1", body: "Please help", createdAt: new Date() }] });
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: { findMany: async (input) => { query = input; return [row]; } },
      supportConversationRead: { findUnique: async (input) => { readQuery = input; return { lastReadAt: new Date("2026-08-19T00:30:00.000Z") }; } },
      supportMessage: { count: async ({ where }) => where.createdAt?.gt ? 3 : 0 },
    },
  });
  try {
    const result = await service.listStaffConversations({ staffUserId: "staff-1", assigned: "unassigned" });
    assert.equal(query.where.assignedStaffUserId, null);
    assert.equal(readQuery.where.conversationId_userId.userId, "staff-1");
    assert.equal(result.items[0].unreadCount, 3);
    await assert.rejects(service.listStaffConversations({}), { statusCode: 400 });
  } finally { restore(); }
});

test("status transitions resolve and reopen a scoped conversation", async () => {
  const existing = conversation();
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async ({ where }) => where.ownerUserId === "u1" ? existing : null,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
    },
  });
  try {
    const resolved = await service.changeConversationStatus({ conversationId: "c1", actorUserId: "u1", status: "RESOLVED" });
    assert.equal(resolved.status, "RESOLVED");
    assert.ok(resolved.resolvedAt instanceof Date);
    const reopened = await service.changeConversationStatus({ conversationId: "c1", actorUserId: "u1", status: "OPEN" });
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.resolvedAt, null);
  } finally { restore(); }
});

test("resolving a conversation does not advance its read cursor or clear unread messages", async () => {
  const existing = conversation({ messages: [{ id: "m-unread", conversationId: "c1", senderUserId: "staff-1", body: "Reply", createdAt: new Date() }] });
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
      supportConversationRead: { findUnique: async () => null },
      supportMessage: { count: async () => 1 },
    },
  });
  try {
    const resolved = await service.changeConversationStatus({ conversationId: "c1", actorUserId: "u1", status: "RESOLVED" });
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.unreadCount, 1);
  } finally { restore(); }
});

test("staff can successfully assign a conversation", async () => {
  const existing = conversation();
  const { module: service, restore } = loadService({
    prisma: {
      user: { findUnique: async () => ({ id: "staff-1", role: "admin" }) },
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
    },
  });
  try {
    const result = await service.assignConversation({ conversationId: "c1", assignedStaffUserId: "staff-1", actorUserId: "staff-1" });
    assert.equal(result.assignedStaffUserId, "staff-1");
  } finally { restore(); }
});

test("staff replies notify the owner with the required support realtime payload", async () => {
  const notifications = [];
  const realtime = [];
  const existing = conversation({ assignedStaffUserId: "staff-1" });
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
      supportMessage: { create: async ({ data }) => ({ id: "m3", ...data, createdAt: new Date() }), count: async () => 1 },
      supportConversationRead: { findUnique: async () => null },
    },
    notifications,
    realtime,
  });
  try {
    await service.sendMessage({ conversationId: "c1", senderUserId: "staff-1", body: "We are looking into this", isStaff: true });
    assert.equal(notifications[0].eventKey, "support-message:m3");
    assert.equal(notifications[0].type, "support_message");
    assert.equal(notifications[0].actionUrl, "/support/c1");
    assert.deepEqual(realtime[0], {
      topic: "user:u1",
      payload: { kind: "support", conversationId: "c1", messageId: "m3", status: "PENDING_USER", unreadCount: 1 },
    });
  } finally { restore(); }
});

test("user messages notify staff with the admin conversation action URL", async () => {
  const notifications = [];
  const existing = conversation();
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
      supportMessage: { create: async ({ data }) => ({ id: "m-user", ...data, createdAt: new Date() }), count: async () => 1 },
      supportConversationRead: { findUnique: async () => null },
      user: { findMany: async () => [{ id: "staff-1", role: "admin" }] },
    },
    notifications,
  });
  try {
    await service.sendMessage({ conversationId: "c1", senderUserId: "u1", body: "Any update?" });
    assert.equal(notifications[0].actionUrl, "/admin/support?conversationId=c1");
  } finally { restore(); }
});

test("notification persistence and realtime failures are observable but do not reject saved messages", async () => {
  const loggerErrors = [];
  const loggerWarnings = [];
  const notifications = [];
  let persisted = false;
  const existing = conversation();
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
      supportMessage: {
        create: async ({ data }) => { persisted = true; return { id: "m5", ...data, createdAt: new Date() }; },
        count: async () => 1,
      },
      supportConversationRead: { findUnique: async () => null },
      user: { findMany: async () => [{ id: "staff-1" }] },
    },
    notificationError: new Error("notification database unavailable"),
    realtimeError: new Error("realtime unavailable"),
    notifications,
    loggerErrors,
    loggerWarnings,
  });
  try {
    const result = await service.sendMessage({ conversationId: "c1", senderUserId: "u1", body: "Saved despite delivery failures" });
    assert.equal(result.status, "PENDING_STAFF");
    assert.equal(persisted, true);
    assert.equal(loggerErrors[0].message, "Support notification persistence failed");
    assert.equal(loggerErrors[0].metadata.messageId, "m5");
    assert.equal(notifications[0].publishRealtime, false);
    assert.equal(loggerWarnings[0].message, "Support realtime delivery failed");
  } finally { restore(); }
});
