const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/support/support.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const notificationPath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const realtimePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");

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

const loadService = ({ prisma = {}, notifications = [], realtime = [] } = {}) => {
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
        notifications.push(input);
        return { id: "notification-1" };
      },
    },
    [realtimePath]: {
      publishRealtimeEvent: (topic, payload) => {
        events.push(["realtime", topic, payload]);
        realtime.push({ topic, payload });
      },
    },
  });
  return { ...loaded, prisma: completePrisma, events };
};

test("createConversation persists the initial message transactionally before notification and realtime", async () => {
  const order = [];
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
    return result;
  };
  const { module: service, restore } = loadService({
    prisma: customPrisma,
    notifications: [],
    realtime: [],
  });
  try {
    const result = await service.createConversation({ ownerUserId: "u1", subject: "  Cannot   connect ", body: " Help  me " });
    assert.equal(result.id, "c1");
    assert.deepEqual(order, ["transaction-start", "create", "persisted"]);
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

test("markConversationRead upserts the per-user read cursor and unread counts exclude the sender", async () => {
  let upsertInput;
  const readAt = new Date("2026-08-19T01:00:00.000Z");
  const { module: service, restore } = loadService({
    prisma: {
      supportConversation: { findFirst: async () => conversation() },
      supportConversationRead: {
        findUnique: async () => ({ lastReadAt: new Date("2026-08-19T00:30:00.000Z") }),
        upsert: async (input) => { upsertInput = input; return { lastReadAt: readAt }; },
      },
      supportMessage: { count: async ({ where }) => where.senderUserId.not === "u1" ? 2 : 0 },
    },
  });
  try {
    const result = await service.markConversationRead({ conversationId: "c1", userId: "u1", isStaff: false });
    assert.equal(result.lastReadAt, readAt);
    assert.equal(upsertInput.where.conversationId_userId.userId, "u1");
    const detail = await service.getConversation({ conversationId: "c1", userId: "u1", isStaff: false });
    assert.equal(detail.unreadCount, 2);
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
