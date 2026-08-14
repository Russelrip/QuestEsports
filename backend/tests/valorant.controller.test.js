const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");
const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);
// Deviation (documented): the brief mocked asyncHandler as identity, which makes
// "propagates HttpError through next()" impossible to satisfy with this repo's
// asyncHandler idiom (handlers never try/catch themselves). Mocking the REAL
// asyncHandler exercises the actual error->next() routing the test name asserts.
const { asyncHandler } = require(asyncHandlerPath);

const callHandler = async (handler, req) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const nextErrors = [];
  await handler(req, res, (error) => nextErrors.push(error));
  return { res, nextErrors };
};

test("bindTeam controller records an AuditLog and returns the binding envelope", async () => {
  const audits = [];
  const serviceMock = {
    bindTeam: async ({ savedTeamId, actorUserId }) => {
      assert.equal(savedTeamId, "saved-team-1");
      assert.equal(actorUserId, "admin-1");
      return { id: "binding-1", valorantTeamUuid: "val-team-1", status: "active" };
    },
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async (entry) => audits.push(entry),
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.bindTeam, {
      user: { id: "admin-1" },
      requestId: "req-1",
      ip: "127.0.0.1",
      body: { savedTeamId: "saved-team-1" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.binding.id, "binding-1");
    assert.deepEqual(nextErrors, []);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, "admin-1");
    assert.equal(audits[0].targetType, "valorant_binding");
    assert.equal(audits[0].targetId, "binding-1");
  } finally {
    restore();
  }
});

test("finalizeSeries controller records the operation id in the audit afterData", async () => {
  const audits = [];
  const serviceMock = {
    finalizeSeries: async ({ seriesId, ratingMode, actorUserId }) => ({
      seriesId,
      ratingMode,
      status: "finalized",
      operationId: "op-abc",
    }),
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async (entry) => audits.push(entry),
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.finalizeSeries, {
      user: { id: "admin-1" },
      requestId: "req-2",
      ip: "127.0.0.1",
      params: { id: "quest-series-1" },
      body: { ratingMode: "normal" },
    });
    assert.equal(res.payload.data.status, "finalized");
    assert.deepEqual(nextErrors, []);
    assert.equal(audits[0].targetType, "valorant_series");
    assert.equal(audits[0].afterData.operationId, "op-abc");
  } finally {
    restore();
  }
});

test("listSeriesMatches returns the matches envelope under data.matches", async () => {
  const serviceMock = {
    listSeriesMatches: async ({ seriesId, actorUserId }) => {
      assert.equal(seriesId, "quest-series-1");
      assert.equal(actorUserId, "admin-1");
      return [{ matchId: "m-1", anchorASide: "red" }];
    },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.listSeriesMatches, {
      user: { id: "admin-1" },
      requestId: "req-4",
      ip: "127.0.0.1",
      params: { seriesId: "quest-series-1" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.matches[0].matchId, "m-1");
    assert.equal(res.payload.data.matches[0].anchorASide, "red");
    assert.ok(res.payload.meta.serverNow);
    assert.deepEqual(nextErrors, []);
  } finally {
    restore();
  }
});

test("attachGame controller accepts a request without teamASide (derived server-side)", async () => {
  const audits = [];
  const serviceMock = {
    attachGame: async ({ seriesId, gameNumber, matchId, teamASide }) => ({
      id: "game-1",
      gameNumber,
      matchId,
      teamASide: teamASide ?? "red",
      teamBSide: teamASide === "red" ? "blue" : "red",
    }),
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async (entry) => audits.push(entry),
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.attachGame, {
      user: { id: "admin-1" },
      requestId: "req-5",
      ip: "127.0.0.1",
      params: { id: "quest-series-1" },
      body: { gameNumber: 1, matchId: "m-1" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.game.teamASide, "red", "the derived side comes back from FastAPI");
    assert.deepEqual(nextErrors, []);
    assert.equal(audits.length, 1);
  } finally {
    restore();
  }
});

test("controller propagates HttpError through next()", async () => {
  const serviceMock = {
    bindTeam: async () => { throw new HttpError(409, "already bound"); },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { nextErrors } = await callHandler(controller.bindTeam, {
      user: { id: "admin-1" },
      requestId: "req-3",
      ip: "127.0.0.1",
      body: { savedTeamId: "saved-team-1" },
    });
    assert.ok(nextErrors[0] instanceof HttpError);
    assert.equal(nextErrors[0].statusCode, 409);
  } finally {
    restore();
  }
});
