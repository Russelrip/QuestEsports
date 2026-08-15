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

test("createSeries controller passes the optional tournamentId through (null when omitted)", async () => {
  const received = [];
  const serviceMock = {
    createSeries: async (args) => {
      received.push(args);
      return { id: "quest-series-1", externalKey: "ext-1", format: "bo3" };
    },
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async () => {},
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const baseBody = {
      bindingTeamAId: "binding-a",
      bindingTeamBId: "binding-b",
      format: "bo3",
      playedAt: "2026-08-02T18:00:00Z",
      anchorPlayerA: { name: "TenZ", tag: "SEN" },
      anchorPlayerB: { name: "Demon1", tag: "NA" },
    };
    const { res, nextErrors } = await callHandler(controller.createSeries, {
      user: { id: "admin-1" },
      requestId: "req-6",
      ip: "127.0.0.1",
      body: { ...baseBody, tournamentId: "tournament-1" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(received[0].tournamentId, "tournament-1", "the controller forwards an explicit tournamentId");
    assert.deepEqual(nextErrors, []);

    await callHandler(controller.createSeries, {
      user: { id: "admin-1" },
      requestId: "req-6b",
      ip: "127.0.0.1",
      body: baseBody,
    });
    assert.equal(received[1].tournamentId, null, "a standalone series omits the tournament");
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

test("createManualSeries controller passes camelCase body, records the audit, and surfaces FinalizeResult fields under data", async () => {
  const audits = [];
  const received = [];
  const serviceMock = {
    createManualSeries: async (args) => {
      received.push(args);
      return {
        seriesId: "quest-series-manual",
        status: "finalized",
        ratingMode: args.ratingMode,
        operationId: "op-manual",
        series: { id: "quest-series-manual", externalKey: "ext-manual", status: "finalized" },
      };
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
    const { res, nextErrors } = await callHandler(controller.createManualSeries, {
      user: { id: "admin-1" },
      requestId: "req-manual",
      ip: "127.0.0.1",
      body: {
        bindingTeamAId: "binding-a",
        bindingTeamBId: "binding-b",
        format: "bo3",
        playedAt: "2026-08-15T18:00:00Z",
        ratingMode: "normal",
        winnerTeamId: "binding-winner",
        teamAMapsWon: 2,
        teamBMapsWon: 1,
        tournamentId: "tournament-1",
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.status, "finalized");
    assert.equal(res.payload.data.ratingMode, "normal");
    assert.equal(res.payload.data.series.id, "quest-series-manual");
    assert.ok(res.payload.meta.serverNow);
    assert.deepEqual(nextErrors, []);
    assert.equal(received[0].bindingTeamAId, "binding-a");
    assert.equal(received[0].winnerTeamId, "binding-winner");
    assert.equal(received[0].ratingMode, "normal");
    assert.equal(received[0].tournamentId, "tournament-1", "the optional tournamentId passes through to the service");
    assert.ok(received[0].playedAt instanceof Date, "the controller parses playedAt into a Date");
    assert.equal(received[0].actorUserId, "admin-1");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].targetType, "valorant_series");
    assert.equal(audits[0].afterData.action, "create_manual");
    assert.equal(audits[0].afterData.operationId, "op-manual");
  } finally {
    restore();
  }
});

test("createManualSeries controller rejects an invalid playedAt without calling the service", async () => {
  let serviceCalls = 0;
  const serviceMock = {
    createManualSeries: async () => { serviceCalls += 1; },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { nextErrors } = await callHandler(controller.createManualSeries, {
      user: { id: "admin-1" },
      requestId: "req-manual-bad",
      ip: "127.0.0.1",
      body: {
        bindingTeamAId: "binding-a",
        bindingTeamBId: "binding-b",
        format: "bo3",
        playedAt: "not-a-date",
        ratingMode: "manual_override",
        winnerTeamId: "binding-winner",
        teamAMapsWon: 2,
        teamBMapsWon: 1,
      },
    });
    assert.ok(nextErrors[0] instanceof HttpError);
    assert.equal(nextErrors[0].statusCode, 400);
    assert.equal(serviceCalls, 0);
  } finally {
    restore();
  }
});

test("createManualSeries controller rejects an unsupported ratingMode with 400 without calling the service", async () => {
  let serviceCalls = 0;
  const serviceMock = {
    createManualSeries: async () => { serviceCalls += 1; },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { nextErrors } = await callHandler(controller.createManualSeries, {
      user: { id: "admin-1" },
      requestId: "req-manual-bad-rating",
      ip: "127.0.0.1",
      body: {
        bindingTeamAId: "binding-a",
        bindingTeamBId: "binding-b",
        format: "bo3",
        playedAt: "2026-08-15T18:00:00Z",
        ratingMode: "manual_override",
        winnerTeamId: "binding-winner",
        teamAMapsWon: 2,
        teamBMapsWon: 1,
      },
    });
    assert.ok(nextErrors[0] instanceof HttpError);
    assert.equal(nextErrors[0].statusCode, 400);
    assert.equal(serviceCalls, 0, "the invalid ratingMode is rejected before the service is called");
  } finally {
    restore();
  }
});

test("updateSeriesPlayedAt controller passes camelCase playedAt, records the audit, and returns the SeriesView envelope", async () => {
  const audits = [];
  const received = [];
  const serviceMock = {
    updateSeriesPlayedAt: async (args) => {
      received.push(args);
      return {
        series: { id: "series-uuid-1", status: "draft", playedAt: args.playedAt.toISOString() },
        projection: { id: "quest-series-1", playedAt: args.playedAt },
      };
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
    const { res, nextErrors } = await callHandler(controller.updateSeriesPlayedAt, {
      user: { id: "admin-1" },
      requestId: "req-patch-1",
      ip: "127.0.0.1",
      params: { seriesId: "quest-series-1" },
      body: { playedAt: "2026-08-16T18:00:00Z" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.series.id, "series-uuid-1");
    assert.equal(res.payload.data.series.playedAt, "2026-08-16T18:00:00.000Z");
    assert.equal(res.payload.data.projection.id, "quest-series-1");
    assert.ok(res.payload.meta.serverNow);
    assert.deepEqual(nextErrors, []);
    assert.equal(received[0].seriesId, "quest-series-1");
    assert.ok(received[0].playedAt instanceof Date, "the controller parses playedAt into a Date");
    assert.equal(received[0].actorUserId, "admin-1");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].targetType, "valorant_series");
    assert.equal(audits[0].targetId, "quest-series-1");
    assert.equal(audits[0].afterData.action, "update_played_at");
    assert.equal(audits[0].afterData.playedAt, "2026-08-16T18:00:00.000Z");
  } finally {
    restore();
  }
});

test("updateSeriesPlayedAt controller rejects an invalid playedAt with 400 without calling the service", async () => {
  let serviceCalls = 0;
  const serviceMock = {
    updateSeriesPlayedAt: async () => { serviceCalls += 1; },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { nextErrors } = await callHandler(controller.updateSeriesPlayedAt, {
      user: { id: "admin-1" },
      requestId: "req-patch-bad",
      ip: "127.0.0.1",
      params: { seriesId: "quest-series-1" },
      body: { playedAt: "not-a-date" },
    });
    assert.ok(nextErrors[0] instanceof HttpError);
    assert.equal(nextErrors[0].statusCode, 400);
    assert.equal(serviceCalls, 0, "the invalid playedAt is rejected before the service is called");
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
