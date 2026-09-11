const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/support/support.controller.js");
const servicePath = path.join(__dirname, "../src/modules/support/support.service.js");
const routesPath = path.join(__dirname, "../src/modules/support/support.routes.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");

const callController = async (method, req, service = {}) => {
  const calls = [];
  const result = { id: "result-1" };
  const mockedService = new Proxy(service, {
    get(target, property) {
      if (property in target) return target[property];
      return async (input) => {
        calls.push([property, input]);
        return result;
      };
    },
  });
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: mockedService,
    [path.join(__dirname, "../src/lib/async-handler.js")]: { asyncHandler: (handler) => handler },
  });
  const response = {};
  response.status = (status) => {
    response.statusCode = status;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  try {
    await controller[method](req, response);
    return { calls, response };
  } finally {
    restore();
  }
};

test("user controllers use the authenticated ID and ignore client owner IDs", async () => {
  const req = {
    user: { id: "authenticated-user" },
    body: { ownerUserId: "attacker", subject: "Need help", body: "Please help" },
    query: { ownerUserId: "attacker", limit: "10" },
    params: { conversationId: "conversation-1" },
  };

  const listed = await callController("listConversations", req);
  assert.equal(listed.calls[0][0], "listUserConversations");
  assert.equal(listed.calls[0][1].userId, "authenticated-user");
  assert.equal(listed.calls[0][1].ownerUserId, undefined);
  assert.deepEqual(listed.response.body, {
    success: true,
    data: { id: "result-1" },
    meta: listed.response.body.meta,
  });

  const created = await callController("createConversation", req);
  assert.deepEqual(created.calls[0], ["createConversation", {
    ownerUserId: "authenticated-user",
    subject: "Need help",
    body: "Please help",
  }]);
  assert.equal(created.response.statusCode, 201);

  const detail = await callController("getConversation", req);
  assert.deepEqual(detail.calls[0], ["getConversation", {
    conversationId: "conversation-1",
    userId: "authenticated-user",
    isStaff: false,
  }]);
});

test("user message, read, and status controllers pass authenticated ownership context", async () => {
  const req = {
    user: { id: "user-1" },
    body: { body: "A reply", ownerUserId: "other-user" },
    params: { conversationId: "conversation-1" },
  };

  const message = await callController("sendMessage", req);
  assert.deepEqual(message.calls[0], ["sendMessage", {
    conversationId: "conversation-1",
    senderUserId: "user-1",
    body: "A reply",
    isStaff: false,
  }]);
  assert.equal(message.response.statusCode, 201);

  const read = await callController("markRead", req);
  assert.deepEqual(read.calls[0], ["markConversationRead", {
    conversationId: "conversation-1",
    userId: "user-1",
    isStaff: false,
    throughMessageId: undefined,
  }]);

  const resolved = await callController("resolveConversation", req);
  assert.equal(resolved.calls[0][1].actorUserId, "user-1");
  assert.equal(resolved.calls[0][1].status, "RESOLVED");
  assert.equal(resolved.calls[0][1].isStaff, false);

  const reopened = await callController("reopenConversation", req);
  assert.equal(reopened.calls[0][1].actorUserId, "user-1");
  assert.equal(reopened.calls[0][1].status, "OPEN");
});

test("admin queue normalizes filters and uses the authenticated staff cursor", async () => {
  const req = {
    user: { id: "admin-1" },
    query: {
      status: " OPEN ",
      assigned: "mine",
      search: "  login issue  ",
      ownerUserId: "must-be-ignored",
    },
  };
  const result = await callController("listAdminConversations", req);
  assert.deepEqual(result.calls[0], ["listStaffConversations", {
    staffUserId: "admin-1",
    status: "OPEN",
    assigned: "admin-1",
    search: "login issue",
    limit: undefined,
    cursor: undefined,
  }]);
});

test("admin controllers pass staff actor context and never use client owner IDs", async () => {
  const req = {
    user: { id: "admin-1" },
    body: { assignedStaffUserId: null, body: "Staff reply", status: "RESOLVED", ownerUserId: "attacker" },
    query: { ownerUserId: "attacker" },
    params: { conversationId: "conversation-1" },
  };
  const detail = await callController("getAdminConversation", req);
  assert.deepEqual(detail.calls[0], ["getConversation", {
    conversationId: "conversation-1",
    userId: "admin-1",
    isStaff: true,
  }]);

  const assignment = await callController("assignConversation", req);
  assert.deepEqual(assignment.calls[0], ["assignConversation", {
    conversationId: "conversation-1",
    assignedStaffUserId: null,
    actorUserId: "admin-1",
  }]);

  const message = await callController("sendAdminMessage", req);
  assert.equal(message.calls[0][1].senderUserId, "admin-1");
  assert.equal(message.calls[0][1].isStaff, true);
  assert.equal(message.response.statusCode, 201);

  const status = await callController("updateAdminStatus", req);
  assert.deepEqual(status.calls[0], ["changeConversationStatus", {
    conversationId: "conversation-1",
    actorUserId: "admin-1",
    status: "RESOLVED",
    isStaff: true,
  }]);
});

test("admin read controller marks the conversation read for the authenticated staff member", async () => {
  const req = { user: { id: "admin-1" }, params: { conversationId: "conversation-1" }, body: { userId: "attacker" } };
  const result = await callController("markAdminRead", req);
  assert.deepEqual(result.calls[0], ["markConversationRead", {
    conversationId: "conversation-1",
    userId: "admin-1",
    isStaff: true,
  }]);
});

test("support routes require authentication and admin authorization for the queue", () => {
  const requireAuth = () => {};
  const requireAdmin = () => {};
  const controllerHandler = () => {};
  const controller = new Proxy({}, { get: () => controllerHandler });
  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: { requireAuth, requireAdmin },
    [controllerPath]: controller,
  });
  try {
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        method: Object.keys(layer.route.methods)[0].toUpperCase(),
        path: layer.route.path,
        handlers: layer.route.stack.map((entry) => entry.handle),
      }));
    for (const expected of [
      ["GET", "/support/conversations"],
      ["POST", "/support/conversations"],
      ["GET", "/support/conversations/:conversationId"],
      ["POST", "/support/conversations/:conversationId/messages"],
      ["GET", "/support/attachments/:attachmentId/content"],
      ["PATCH", "/support/conversations/:conversationId/read"],
      ["POST", "/support/conversations/:conversationId/resolve"],
      ["POST", "/support/conversations/:conversationId/reopen"],
      ["GET", "/admin/support/conversations"],
      ["GET", "/admin/support/conversations/:conversationId"],
      ["PATCH", "/admin/support/conversations/:conversationId/read"],
      ["PATCH", "/admin/support/conversations/:conversationId/assignment"],
      ["POST", "/admin/support/conversations/:conversationId/messages"],
      ["PATCH", "/admin/support/conversations/:conversationId/status"],
    ]) {
      assert.ok(routes.some((route) => route.method === expected[0] && route.path === expected[1]), `missing route ${expected.join(" ")}`);
    }
    const adminRoutes = routes.filter((route) => route.path.startsWith("/admin/support/"));
    assert.equal(adminRoutes.length, 6);
    for (const route of adminRoutes) {
      assert.ok(route.handlers.includes(requireAuth));
      assert.ok(route.handlers.includes(requireAdmin));
    }
    const userRoutes = routes.filter((route) => route.path.startsWith("/support/"));
    assert.equal(userRoutes.length, 9);
    for (const route of userRoutes) assert.ok(route.handlers.includes(requireAuth));
  } finally {
    restore();
  }
});

test("actual admin middleware rejects non-admin requests for every admin route", async () => {
  const actualAuth = require(authPath);
  const controllerHandler = () => {};
  const controller = new Proxy({}, { get: () => controllerHandler });
  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: actualAuth,
    [controllerPath]: controller,
  });
  try {
    const adminRoutes = router.stack
      .filter((layer) => layer.route && layer.route.path.startsWith("/admin/support/"));
    assert.equal(adminRoutes.length, 6);
    for (const layer of adminRoutes) {
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers[0], actualAuth.requireAuth);
      assert.equal(handlers[1], actualAuth.requireAdmin);
      const errors = [];
      const req = {
        user: { id: "user-1", role: "user" },
        method: Object.keys(layer.route.methods)[0].toUpperCase(),
        originalUrl: layer.route.path,
        ip: "127.0.0.1",
      };
      const next = (error) => { if (error) errors.push(error); };
      handlers[0](req, {}, next);
      handlers[1](req, {}, next);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].statusCode, 403);
    }
  } finally {
    restore();
  }
});
