const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/support/support.service.js");
const controllerPath = path.join(__dirname, "../src/modules/support/support.controller.js");
const routesPath = path.join(__dirname, "../src/modules/support/support.routes.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const streamPath = path.join(__dirname, "../src/lib/stream-response.js");

const loadService = (prisma = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: {
    prisma: {
      $transaction: async (work) => typeof work === "function" ? work(prisma) : work,
      supportConversationRead: { findUnique: async () => null },
      supportMessage: { count: async () => 0 },
      ...prisma,
    },
  },
  [path.join(__dirname, "../src/modules/notifications/notification.service.js")]: {
    createNotification: async () => undefined,
  },
  [path.join(__dirname, "../src/modules/realtime/realtime.service.js")]: {
    publishRealtimeEvent: () => undefined,
  },
  [path.join(__dirname, "../src/lib/logger.js")]: {
    logger: { error: () => undefined, warn: () => undefined },
  },
});

test("support messages reject more than three screenshots and invalid screenshot buffers", async () => {
  const { module: service, restore } = loadService({
    supportConversation: {
      create: async () => ({ messages: [] }),
    },
  });
  try {
    const screenshots = Array.from({ length: 4 }, () => ({
      originalname: "shot.png",
      mimetype: "image/png",
      buffer: Buffer.from("not an image"),
    }));
    await assert.rejects(
      service.createConversation({ ownerUserId: "u1", subject: "Help", body: "Details", screenshots }),
      (error) => error.statusCode === 400,
    );
  } finally {
    restore();
  }
});

test("support messages reject spoofed or truncated screenshot buffers", async () => {
  const { module: service, restore } = loadService({
    supportConversation: { create: async () => ({ messages: [] }) },
  });
  try {
    await assert.rejects(
      service.createConversation({
        ownerUserId: "u1",
        subject: "Help",
        body: "Details",
        screenshots: [{ originalname: "shot.png", mimetype: "image/png", buffer: Buffer.from("not an image") }],
      }),
      { statusCode: 400 },
    );
  } finally {
    restore();
  }
});

test("support message mapping exposes only safe attachment metadata and an authenticated content URL", async () => {
  const createdAt = new Date("2026-09-10T00:00:00.000Z");
  const { module: service, restore } = loadService({
    supportConversation: {
      findFirst: async () => ({
        id: "c1",
        ownerUserId: "u1",
        subject: "Help",
        status: "OPEN",
        assignedStaffUserId: null,
        createdAt,
        updatedAt: createdAt,
        resolvedAt: null,
        owner: null,
        assignedStaff: null,
        messages: [{
          id: "m1",
          conversationId: "c1",
          senderUserId: "u1",
          body: "Details",
          createdAt,
          sender: null,
          attachments: [{
            id: "a1",
            position: 0,
            storedFilename: "secret-name.png",
            contentType: "image/png",
            byteSize: 123,
            createdAt,
          }],
        }],
      }),
    },
  });
  try {
    const result = await service.getConversation({ conversationId: "c1", userId: "u1" });
    const attachment = result.messages[0].attachments[0];
    assert.deepEqual(attachment, {
      id: "a1",
      position: 0,
      contentType: "image/png",
      byteSize: 123,
      createdAt,
      contentUrl: "/api/v1/support/attachments/a1/content",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(attachment, "storedFilename"), false);
  } finally {
    restore();
  }
});

test("support attachment content is 404 for unauthorized users and returns private file metadata for the owner", async () => {
  const attachment = {
    id: "a1",
    storedFilename: "safe.png",
    contentType: "image/png",
    byteSize: 12,
    message: { conversation: { ownerUserId: "owner-1" } },
  };
  const { module: service, restore } = loadService({
    supportMessageAttachment: { findUnique: async () => attachment },
  });
  const upload = require(uploadPath);
  await fs.mkdir(upload.supportScreenshotDirectory, { recursive: true });
  await fs.writeFile(path.join(upload.supportScreenshotDirectory, "safe.png"), Buffer.from("png"));
  try {
    await assert.rejects(
      service.getAttachmentContent({ attachmentId: "a1", userId: "other-1", isAdmin: false }),
      { statusCode: 404 },
    );
    const result = await service.getAttachmentContent({ attachmentId: "a1", userId: "owner-1", isAdmin: false });
    assert.equal(result.id, "a1");
    assert.equal(result.contentType, "image/png");
    assert.equal(result.byteSize, 12);
    assert.equal(result.storedFilename, undefined);
    assert.match(result.path, /support/);
  } finally {
    restore();
    await fs.rm(path.join(upload.supportScreenshotDirectory, "safe.png"), { force: true });
  }
});

test("JSON support requests remain compatible while attachment fields are omitted", async () => {
  const calls = [];
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: {
      createConversation: async (input) => { calls.push(input); return { id: "c1" }; },
    },
    [path.join(__dirname, "../src/lib/async-handler.js")]: { asyncHandler: (handler) => handler },
  });
  const res = { status: () => res, json: (body) => { res.body = body; return res; } };
  try {
    await controller.createConversation({ user: { id: "u1" }, body: { subject: "Help", body: "Details" } }, res);
    assert.deepEqual(calls[0], { ownerUserId: "u1", subject: "Help", body: "Details" });
    assert.equal(res.body.success, true);
  } finally {
    restore();
  }
});

test("support download route requires authentication and is not public-upload served", () => {
  const requireAuth = () => undefined;
  const controller = new Proxy({}, { get: () => () => undefined });
  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: { requireAuth, requireAdmin: () => undefined },
    [path.join(__dirname, "../src/modules/support/support.controller.js")]: controller,
  });
  try {
    const route = router.stack.find((layer) => layer.route?.path === "/support/attachments/:attachmentId/content");
    assert.ok(route);
    assert.ok(route.route.stack.some((entry) => entry.handle === requireAuth));
  } finally {
    restore();
  }
});

test("support download sets private no-store and nosniff headers before streaming", async () => {
  const streamed = [];
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: {
      getAttachmentContent: async () => ({ path: "private/support/safe.png", contentType: "image/png", byteSize: 42 }),
    },
    [streamPath]: { streamFileToResponse: async (filePath) => streamed.push(filePath) },
    [path.join(__dirname, "../src/lib/async-handler.js")]: { asyncHandler: (handler) => handler },
  });
  const headers = {};
  const res = {
    setHeader: (name, value) => { headers[name] = value; },
    status: (status) => { res.statusCode = status; return res; },
  };
  try {
    await controller.streamAttachment({ params: { attachmentId: "a1" }, user: { id: "owner-1", role: "user" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(headers["Cache-Control"], "private, no-store");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.deepEqual(streamed, ["private/support/safe.png"]);
  } finally {
    restore();
  }
});
