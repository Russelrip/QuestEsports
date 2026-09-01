const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const backend = path.join(__dirname, "../src");
const v1Path = path.join(backend, "routes/v1.js");
const envPath = path.join(backend, "config/env.js");
const authPath = path.join(backend, "modules/auth/auth.middleware.js");
const asyncHandlerPath = path.join(backend, "lib/async-handler.js");
const prismaPath = path.join(backend, "lib/prisma.js");
const cacheControlPath = path.join(backend, "middleware/cache-control.js");
const responseCachePath = path.join(backend, "middleware/response-cache.js");
const tournamentServicePath = path.join(backend, "modules/tournaments/tournament.service.js");
const matchControllerPath = path.join(backend, "modules/matches/match.controller.js");
const vetoControllerPath = path.join(backend, "modules/veto/veto.controller.js");
const vetoServicePath = path.join(backend, "modules/veto/veto.service.js");
const auditPath = path.join(backend, "lib/audit.js");
const realtimeServicePath = path.join(backend, "modules/realtime/realtime.service.js");
const matchRoomServicePath = path.join(backend, "modules/match-rooms/match-room.service.js");
const matchRoomControllerPath = path.join(backend, "modules/match-rooms/match-room.controller.js");
const notificationControllerPath = path.join(backend, "modules/notifications/notification.controller.js");
const supportRoutesPath = path.join(backend, "modules/support/support.routes.js");
const authRoutesPath = path.join(backend, "modules/auth/auth.routes.js");
const challongeControllerPath = path.join(backend, "modules/challonge/challonge.controller.js");
const staffControllerPath = path.join(backend, "modules/permissions/staff.controller.js");
const realtimeControllerPath = path.join(backend, "modules/realtime/realtime.controller.js");
const permissionMiddlewarePath = path.join(backend, "modules/permissions/permission.middleware.js");
const valorantControllerPath = path.join(backend, "modules/valorant/valorant.controller.js");
const valorantLeaderboardControllerPath = path.join(backend, "modules/valorant-leaderboard/controller.js");

const pass = (_req, _res, next) => next();
const controller = new Proxy({}, { get: () => pass });
const route = (router, method, pathname) => router.stack.find((layer) => layer.route?.path === pathname && layer.route.methods[method]);

const runRoute = async (layer, req) => {
  const errors = [];
  let finish;
  const res = {
    status: () => res,
    json: (body) => { req.responseBody = body; finish?.(); return res; },
    send: () => { finish?.(); return res; },
    locals: {},
  };
  let index = 0;
  await new Promise((resolve) => {
    finish = resolve;
    const next = (error) => {
      if (error || index >= layer.route.stack.length) {
        if (error) errors.push(error);
        resolve();
        return;
      }
      const handler = layer.route.stack[index++].handle;
      Promise.resolve(handler(req, res, next)).catch(next);
    };
    next();
  });
  return errors[0] || null;
};

test("admin veto mutations enforce scoped staff access while public code routes keep their own guards", async () => {
  const prisma = {
    tournament: {
      findUnique: async ({ where }) => where.id === "missing-tournament" ? null : ({ id: where.id }),
    },
    vetoRoom: {
      findUnique: async ({ where }) => where.id === "room-1"
        ? { id: "room-1", tournamentId: "tournament-1" }
        : where.id === "room-standalone"
          ? { id: "room-standalone", tournamentId: null }
          : null,
    },
    match: {
      findUnique: async ({ where }) => where.id === "match-1" ? { tournamentId: "tournament-1" } : null,
    },
    matchRoom: {
      findFirst: async ({ where }) => where.match?.assignedStaffId === "direct-staff-1" ? { id: "room-direct" } : null,
    },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => {
        if (!where.tournamentId && where.userId === "staff-1" && where.role.in.includes("tournament_admin")) return { id: "assignment-1" };
        if (!where.tournamentId && where.userId === "referee-1" && where.role.in.includes("referee")) return { id: "assignment-2" };
        if (where.userId === "other-tournament-staff" && where.tournamentId === "tournament-2") return { id: "assignment-other" };
        if (where.tournamentId !== "tournament-1") return null;
        if (where.userId === "staff-1" && where.role.in.includes("tournament_admin")) return { id: "assignment-1" };
        if (where.userId === "referee-1" && where.role.in.includes("referee")) return { id: "assignment-2" };
        return null;
      },
    },
  };
  const serviceCalls = [];
  const vetoRoom = { id: "room-1", code: "room-code", status: "open", revision: 1 };
  const vetoController = loadModuleWithMocks(vetoControllerPath, {
    [vetoServicePath]: {
      openRoom: async () => { serviceCalls.push(["openRoom"]); return vetoRoom; },
      assignTeamA: async () => { serviceCalls.push(["assignTeamA"]); return vetoRoom; },
      createRoom: async ({ body }) => { serviceCalls.push(["createRoom", body]); return { room: vetoRoom }; },
      listRooms: async () => [],
      listCatalog: async () => ({ maps: [], pools: [], presets: [], templates: [] }),
      getAdminRoom: async () => vetoRoom,
      createMap: async () => ({ id: "map-1" }),
      updateMapAvailability: async () => ({ id: "map-1", slug: "ascent", name: "Ascent", isActive: true }),
      createPool: async () => ({ id: "pool-1" }),
      createPreset: async () => ({ id: "preset-1" }),
      createTemplate: async () => ({ id: "template-1" }),
      saveTournamentConfig: async () => ({ tournamentId: "tournament-1" }),
      readyRoom: async ({ user, token }) => { serviceCalls.push(["readyRoom", user, token]); return vetoRoom; },
      submitAction: async ({ user, token }) => { serviceCalls.push(["submitAction", user, token]); return vetoRoom; },
      chooseTeamA: async ({ user, token }) => { serviceCalls.push(["chooseTeamA", user, token]); return vetoRoom; },
    },
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [realtimeServicePath]: { publishRealtimeEvent: () => undefined },
    [matchRoomServicePath]: { notifyVetoTurn: async () => undefined },
  });
  const permission = loadModuleWithMocks(permissionMiddlewarePath, { [prismaPath]: { prisma } });
  const loaded = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: {
      attachSession: pass,
      requireAuth: (req, res, next) => req.user ? next() : next(Object.assign(new Error("auth"), { statusCode: 401 })),
      requireAdmin: (req, res, next) => req.user?.role === "admin"
        ? next()
        : next(Object.assign(new Error("admin"), { statusCode: 403 })),
    },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => pass },
    [responseCachePath]: { cacheJson: () => pass, invalidateCache: () => pass },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controller,
    [vetoControllerPath]: vetoController.module,
    [matchRoomControllerPath]: controller,
    [notificationControllerPath]: controller,
    [supportRoutesPath]: pass,
    [authRoutesPath]: { oauthLinkRoutes: pass },
    [challongeControllerPath]: controller,
    [staffControllerPath]: controller,
    [realtimeControllerPath]: { getRealtimeEvents: pass },
    [permissionMiddlewarePath]: permission.module,
    [valorantControllerPath]: controller,
    [valorantLeaderboardControllerPath]: controller,
  });

  try {
    const adminRoomMutation = route(loaded.module, "post", "/admin/veto-rooms/:roomId/open");
    assert.ok(adminRoomMutation);
    const unauthorized = await runRoute(adminRoomMutation, {
      user: { id: "not-staff", role: "user" },
      params: { roomId: "room-1" },
      body: {},
    });
    assert.equal(unauthorized?.statusCode, 403);

    const validStaff = await runRoute(adminRoomMutation, {
      user: { id: "staff-1", role: "referee" },
      params: { roomId: "room-1" },
      body: {},
    });
    assert.equal(validStaff, null);

    const wrongTournamentStaff = await runRoute(adminRoomMutation, {
      user: { id: "other-tournament-staff", role: "referee" },
      params: { roomId: "room-1" },
      body: {},
    });
    assert.equal(wrongTournamentStaff?.statusCode, 403);

    const unauthenticated = await runRoute(adminRoomMutation, {
      user: null,
      params: { roomId: "room-1" },
      body: {},
    });
    assert.equal(unauthenticated?.message, "auth");

    const referee = await runRoute(adminRoomMutation, {
      user: { id: "referee-1", role: "user" },
      params: { roomId: "room-1" },
      body: {},
    });
    assert.equal(referee, null);

    const assignmentMutation = route(loaded.module, "post", "/admin/veto-rooms/:roomId/assign-team-a");
    assert.equal((await runRoute(assignmentMutation, {
      user: { id: "not-staff", role: "user" },
      params: { roomId: "room-1" },
      body: {},
    }))?.statusCode, 403);
    assert.equal(await runRoute(assignmentMutation, {
      user: { id: "referee-1", role: "referee" },
      params: { roomId: "room-1" },
      body: {},
    }), null);

    const tournamentMatchRead = route(loaded.module, "get", "/admin/tournaments/:id/matches");
    assert.equal(await runRoute(tournamentMatchRead, {
      user: { id: "referee-1", role: "user" }, params: { id: "tournament-1" }, body: {},
    }), null);
    assert.equal((await runRoute(tournamentMatchRead, {
      user: { id: "referee-1", role: "user" }, params: { id: "tournament-1" }, query: { tournamentId: "tournament-2" }, body: {},
    }))?.statusCode, 400);
    const vetoRoomListRead = route(loaded.module, "get", "/admin/veto-rooms");
    assert.equal(await runRoute(vetoRoomListRead, {
      user: { id: "referee-1", role: "user" }, params: {}, query: {}, body: {},
    }), null);
    assert.equal(await runRoute(vetoRoomListRead, {
      user: { id: "referee-1", role: "user" }, params: {}, query: { tournamentId: "tournament-1" }, body: {},
    }), null);
    assert.equal((await runRoute(vetoRoomListRead, {
      user: { id: "admin-1", role: "admin" }, params: {}, query: { tournamentId: "missing-tournament" }, body: {},
    }))?.statusCode, 404);
    const vetoRoomRead = route(loaded.module, "get", "/admin/veto-rooms/:roomId");
    assert.equal(await runRoute(vetoRoomRead, {
      user: { id: "referee-1", role: "user" }, params: { roomId: "room-1" }, body: {},
    }), null);
    assert.equal((await runRoute(vetoRoomRead, {
      user: { id: "admin-1", role: "admin" }, params: { roomId: "room-standalone" }, query: { tournamentId: "tournament-1" }, body: {},
    }))?.statusCode, 400);
    const matchRoomRead = route(loaded.module, "get", "/admin/match-rooms");
    assert.equal(await runRoute(matchRoomRead, {
      user: { id: "referee-1", role: "user" }, params: {}, query: {}, body: {},
    }), null);
    assert.equal(await runRoute(matchRoomRead, {
      user: { id: "direct-staff-1", role: "user" }, params: {}, query: {}, body: {},
    }), null);
    assert.equal(await runRoute(matchRoomRead, {
      user: { id: "admin-1", role: "admin" }, params: {}, query: {}, body: {},
    }), null);
    assert.equal((await runRoute(matchRoomRead, {
      user: { id: "unrelated-user", role: "user" }, params: {}, query: {}, body: {},
    }))?.statusCode, 403);
    const catalogRead = route(loaded.module, "get", "/admin/veto/catalog");
    assert.equal(await runRoute(catalogRead, {
      user: { id: "staff-1", role: "user" }, params: {}, query: {}, body: {},
    }), null);
    assert.equal(await runRoute(catalogRead, {
      user: { id: "staff-1", role: "user" }, params: {}, query: { tournamentId: "tournament-1" }, body: {},
    }), null);
    assert.equal((await runRoute(catalogRead, {
      user: { id: "not-staff", role: "user" }, params: {}, query: {}, body: {},
    }))?.statusCode, 403);

    const mapMutation = route(loaded.module, "post", "/admin/veto/maps");
    assert.ok(mapMutation);
    assert.equal((await runRoute(mapMutation, { user: { id: "staff-1", role: "user" }, params: {}, body: {} }))?.statusCode, 403);
    assert.equal(await runRoute(mapMutation, { user: { id: "admin-1", role: "admin" }, params: {}, body: {} }), null);

    const poolMutation = route(loaded.module, "post", "/admin/veto/pools");
    const presetMutation = route(loaded.module, "post", "/admin/veto/presets");
    const templateMutation = route(loaded.module, "post", "/admin/veto/templates");
    const configMutation = route(loaded.module, "put", "/admin/tournaments/:id/veto-config");
    for (const [mutation, req, expected] of [
      [poolMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }, 403],
      [presetMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }, 403],
      [templateMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }, 403],
      [poolMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: {} }, 403],
      [presetMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: {} }, 403],
      [templateMutation, { user: { id: "not-staff", role: "user" }, params: {}, body: {} }, 403],
      [configMutation, { user: { id: "not-staff", role: "user" }, params: { id: "tournament-1" }, body: {} }, 403],
    ]) {
      assert.ok(mutation);
      assert.equal((await runRoute(mutation, req))?.statusCode, expected);
    }
    assert.equal(await runRoute(poolMutation, { user: { id: "staff-1", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }), null);
    assert.equal(await runRoute(presetMutation, { user: { id: "staff-1", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }), null);
    assert.equal(await runRoute(templateMutation, { user: { id: "staff-1", role: "user" }, params: {}, body: { tournamentId: "tournament-1" } }), null);
    assert.equal(await runRoute(configMutation, { user: { id: "staff-1", role: "user" }, params: { id: "tournament-1" }, body: {} }), null);
    for (const mutation of [poolMutation, presetMutation, templateMutation]) {
      assert.equal(await runRoute(mutation, { user: { id: "admin-1", role: "admin" }, params: {}, body: {} }), null);
    }
    assert.equal((await runRoute(poolMutation, { user: { id: "referee-1", role: "referee" }, params: {}, body: { tournamentId: "tournament-1" } }))?.statusCode, 403);
    assert.equal((await runRoute(configMutation, { user: { id: "referee-1", role: "referee" }, params: { id: "tournament-1" }, body: {} }))?.statusCode, 403);

    const conflictingCreate = route(loaded.module, "post", "/admin/veto-rooms");
    assert.equal(await runRoute(conflictingCreate, {
      user: { id: "staff-1", role: "user" },
      params: {},
      body: { tournamentId: "tournament-1" },
    }), null);
    serviceCalls.length = 0;
    const conflict = await runRoute(conflictingCreate, {
      user: { id: "staff-1", role: "user" },
      params: {},
      body: { matchId: "match-1", tournamentId: "other-tournament" },
    });
    assert.equal(conflict?.statusCode, 400);
    assert.equal(serviceCalls.some(([name]) => name === "createRoom"), false);
    const adminConflict = await runRoute(conflictingCreate, {
      user: { id: "admin-1", role: "admin" },
      params: {},
      body: { matchId: "match-1", tournamentId: "other-tournament" },
    });
    assert.equal(adminConflict?.statusCode, 400);

    assert.ok(route(loaded.module, "get", "/veto-rooms/:code"));
    assert.ok(route(loaded.module, "post", "/veto-rooms/:code/ready"));
    assert.ok(route(loaded.module, "post", "/veto-rooms/:code/toss"));
    assert.ok(route(loaded.module, "post", "/veto-rooms/:code/team-a"));
    assert.ok(route(loaded.module, "post", "/veto-rooms/:code/actions"));
  } finally {
    loaded.restore();
    vetoController.restore();
    permission.restore();
  }
});

test("public veto code routes use real captain, grant, and published-room access resolution", async () => {
  const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
  const room = (overrides = {}) => ({
    id: `room-${overrides.code || "access"}`,
    code: overrides.code || "access-room",
    tournamentId: "tournament-1",
    title: "Access Room",
    format: "bo1",
    status: "open",
    revision: 1,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 2,
    tossCall: null,
    tossResult: null,
    tossWinnerSlot: null,
    teamASlot: null,
    currentStep: 0,
    turnSeconds: null,
    turnDeadline: null,
    viewerEnabled: true,
    publishResult: false,
    participants: [],
    actions: [],
    configSnapshot: { maps: [], steps: [] },
    tournament: null,
    match: null,
    openedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
    ...overrides,
  });
  const rooms = [
    room({
      code: "captain-room",
      participants: [{ id: "participant-1", slot: 1, registrationId: "registration-1", displayName: "Captain Team", seed: 1, accentColor: "#22d3ee", readyAt: null, joinedAt: null }],
    }),
    room({
      code: "token-room",
      controlMode: "link_only",
      status: "in_progress",
      configSnapshot: { maps: [{ slug: "ascent", name: "Ascent" }], steps: [{ kind: "ban", seriesIndex: 0 }] },
    }),
    room({ code: "public-room", status: "completed", publishResult: true }),
  ];
  const prisma = {
    vetoRoom: {
      findUnique: async ({ where }) => rooms.find((entry) => where.code ? entry.code === where.code : entry.id === where.id) || null,
    },
    tournamentStaffAssignment: { findFirst: async () => null },
    teamRegistration: {
      findMany: async ({ where }) => where.OR?.some((entry) => entry.userId === "captain-1") ? [{ id: "registration-1" }] : [],
    },
    vetoAccessGrant: {
      findFirst: async ({ where }) => where.tokenHash === tokenHash("valid-grant")
        ? { id: "grant-1", role: "team_1", expiresAt: new Date(Date.now() + 60_000) }
        : where.tokenHash === tokenHash("caster-grant")
          ? { id: "grant-caster", role: "caster", expiresAt: new Date(Date.now() + 60_000) }
        : where.tokenHash === tokenHash("expired-grant")
          ? { id: "grant-expired", role: "team_1", expiresAt: new Date(Date.now() - 60_000) }
        : null,
      update: async () => undefined,
    },
  };
  const actualService = loadModuleWithMocks(vetoServicePath, { [prismaPath]: { prisma } });
  const actualController = loadModuleWithMocks(vetoControllerPath, {
    [vetoServicePath]: actualService.module,
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [realtimeServicePath]: { publishRealtimeEvent: () => undefined },
    [matchRoomServicePath]: { notifyVetoTurn: async () => undefined },
  });
  const permission = loadModuleWithMocks(permissionMiddlewarePath, { [prismaPath]: { prisma } });
  const loaded = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: {
      attachSession: pass,
      requireAuth: (req, res, next) => req.user ? next() : next(Object.assign(new Error("auth"), { statusCode: 401 })),
      requireAdmin: (req, res, next) => req.user?.role === "admin"
        ? next()
        : next(Object.assign(new Error("admin"), { statusCode: 403 })),
    },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => pass },
    [responseCachePath]: { cacheJson: () => pass, invalidateCache: () => pass },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controller,
    [vetoControllerPath]: actualController.module,
    [matchRoomControllerPath]: controller,
    [notificationControllerPath]: controller,
    [supportRoutesPath]: pass,
    [authRoutesPath]: { oauthLinkRoutes: pass },
    [challongeControllerPath]: controller,
    [staffControllerPath]: controller,
    [realtimeControllerPath]: { getRealtimeEvents: pass },
    [permissionMiddlewarePath]: permission.module,
    [valorantControllerPath]: controller,
    [valorantLeaderboardControllerPath]: controller,
  });

  try {
    const getRoom = route(loaded.module, "get", "/veto-rooms/:code");
    const captainRequest = { user: { id: "captain-1", role: "user" }, params: { code: "captain-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, captainRequest), null);
    assert.equal(captainRequest.responseBody.data.access.kind, "team");
    assert.equal(captainRequest.responseBody.data.access.slot, 1);

    const grantRequest = { user: null, params: { code: "token-room" }, headers: { "x-veto-token": "valid-grant" } };
    assert.equal(await runRoute(getRoom, grantRequest), null);
    assert.equal(grantRequest.responseBody.data.access.kind, "team");
    assert.equal(grantRequest.responseBody.data.access.slot, 1);

    const casterRequest = { user: null, params: { code: "token-room" }, headers: { "x-veto-token": "caster-grant" } };
    assert.equal(await runRoute(getRoom, casterRequest), null);
    assert.deepEqual(casterRequest.responseBody.data.access, { kind: "caster", slot: null });

    const casterMutation = {
      user: null,
      params: { code: "token-room" },
      headers: { "x-veto-token": "caster-grant" },
      body: { expectedRevision: 1, mapSlug: "ascent" },
    };
    assert.equal((await runRoute(route(loaded.module, "post", "/veto-rooms/:code/actions"), casterMutation))?.statusCode, 403);

    const publicRequest = { user: null, params: { code: "public-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, publicRequest), null);
    assert.equal(publicRequest.responseBody.data.access.kind, "public");

    const expiredGrantRequest = { user: null, params: { code: "token-room" }, headers: { "x-veto-token": "expired-grant" } };
    assert.equal((await runRoute(getRoom, expiredGrantRequest))?.statusCode, 401);

    const unauthenticatedRequest = { user: null, params: { code: "captain-room" }, headers: {} };
    assert.equal((await runRoute(getRoom, unauthenticatedRequest))?.statusCode, 401);
  } finally {
    loaded.restore();
    permission.restore();
    actualController.restore();
    actualService.restore();
  }
});

test("public veto code routes are route-guarded before the service resolves access", async () => {
  const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
  const roomLookups = [];
  const room = (overrides = {}) => ({
    id: `room-${overrides.code || "guard"}`,
    code: overrides.code || "guard-room",
    tournamentId: "tournament-1",
    title: "Guard Room",
    format: "bo1",
    status: "open",
    revision: 1,
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 2,
    tossCall: null,
    tossResult: null,
    tossWinnerSlot: null,
    teamASlot: null,
    currentStep: 0,
    turnSeconds: null,
    turnDeadline: null,
    viewerEnabled: true,
    publishResult: false,
    participants: [],
    actions: [],
    configSnapshot: { maps: [], steps: [] },
    tournament: null,
    match: null,
    openedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
    ...overrides,
  });
  const participant = (slot, registrationId) => ({
    id: `participant-${slot}`,
    slot,
    registrationId,
    displayName: `Team ${slot}`,
    seed: slot,
    accentColor: "#22d3ee",
    readyAt: null,
    joinedAt: null,
  });
  const rooms = [
    room({
      code: "captain-room",
      participants: [participant(1, "registration-1"), participant(2, "registration-2")],
    }),
    room({ code: "link-room", controlMode: "link_only" }),
    room({ code: "published-room", status: "completed", publishResult: true }),
  ];
  const prisma = {
    vetoRoom: {
      findUnique: async ({ where }) => {
        roomLookups.push(where);
        return rooms.find((entry) => (where.code ? entry.code === where.code : entry.id === where.id)) || null;
      },
    },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => (where.tournamentId === "tournament-1" && where.userId === "staff-1"
        ? { id: "assignment-1" }
        : null),
    },
    teamRegistration: {
      findMany: async ({ where }) => {
        const owners = { "captain-1": "registration-1", "captain-2": "registration-2" };
        const userId = where.OR?.map((entry) => entry.userId).find(Boolean);
        const registrationId = owners[userId];
        if (!registrationId) return [];
        return where.id.in.includes(registrationId) ? [{ id: registrationId }] : [];
      },
    },
    vetoAccessGrant: {
      findFirst: async ({ where }) => (where.tokenHash === tokenHash("live-grant")
        ? { id: "grant-live", role: "team_1", expiresAt: new Date(Date.now() + 60_000) }
        : where.tokenHash === tokenHash("stale-grant")
          ? { id: "grant-stale", role: "team_1", expiresAt: new Date(Date.now() - 60_000) }
          : null),
      update: async () => undefined,
    },
  };
  const actualService = loadModuleWithMocks(vetoServicePath, { [prismaPath]: { prisma } });
  const actualController = loadModuleWithMocks(vetoControllerPath, {
    [vetoServicePath]: actualService.module,
    [auditPath]: { recordAudit: async () => undefined, requestAuditContext: () => ({}) },
    [realtimeServicePath]: { publishRealtimeEvent: () => undefined },
    [matchRoomServicePath]: { notifyVetoTurn: async () => undefined },
  });
  const permission = loadModuleWithMocks(permissionMiddlewarePath, { [prismaPath]: { prisma } });
  const loaded = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: {
      attachSession: pass,
      requireAuth: (req, res, next) => (req.user ? next() : next(Object.assign(new Error("auth"), { statusCode: 401 }))),
      requireAdmin: (req, res, next) => (req.user?.role === "admin"
        ? next()
        : next(Object.assign(new Error("admin"), { statusCode: 403 }))),
    },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => pass },
    [responseCachePath]: { cacheJson: () => pass, invalidateCache: () => pass },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controller,
    [vetoControllerPath]: actualController.module,
    [matchRoomControllerPath]: controller,
    [notificationControllerPath]: controller,
    [supportRoutesPath]: pass,
    [authRoutesPath]: { oauthLinkRoutes: pass },
    [challongeControllerPath]: controller,
    [staffControllerPath]: controller,
    [realtimeControllerPath]: { getRealtimeEvents: pass },
    [permissionMiddlewarePath]: permission.module,
    [valorantControllerPath]: controller,
    [valorantLeaderboardControllerPath]: controller,
  });

  const getRoom = route(loaded.module, "get", "/veto-rooms/:code");
  const readyRoom = route(loaded.module, "post", "/veto-rooms/:code/ready");
  const tossRoom = route(loaded.module, "post", "/veto-rooms/:code/toss");
  const teamARoom = route(loaded.module, "post", "/veto-rooms/:code/team-a");
  const actionsRoom = route(loaded.module, "post", "/veto-rooms/:code/actions");
  const codeRoutes = [getRoom, readyRoom, tossRoom, teamARoom, actionsRoom];
  const mutationRoutes = [readyRoom, tossRoom, teamARoom, actionsRoom];

  try {
    for (const layer of codeRoutes) {
      assert.ok(layer, "every public veto code route stays registered");
      assert.ok(layer.route.stack.length > 1, "public veto code routes gain route-level guards");
    }

    // A malformed room code is rejected at the route boundary with the existing
    // not-found contract and never reaches the database.
    for (const layer of codeRoutes) {
      for (const code of ["../admin", "code with spaces", "", "a".repeat(65)]) {
        roomLookups.length = 0;
        const rejected = await runRoute(layer, {
          user: { id: "captain-1", role: "user" },
          params: { code },
          headers: {},
          body: {},
        });
        assert.equal(rejected?.statusCode, 404, "a malformed veto code is rejected with the existing not-found status");
        assert.equal(roomLookups.length, 0, "a malformed veto code never reaches the veto room lookup");
      }
    }

    // Credential-free mutations stop at the route boundary with the same
    // permission response the service produces for anonymous callers.
    for (const layer of mutationRoutes) {
      roomLookups.length = 0;
      const anonymous = await runRoute(layer, { user: null, params: { code: "captain-room" }, headers: {}, body: {} });
      assert.equal(anonymous?.statusCode, 401);
      assert.equal(roomLookups.length, 0, "an anonymous mutation never reaches the veto room lookup");

      roomLookups.length = 0;
      const publishedAnonymous = await runRoute(layer, { user: null, params: { code: "published-room" }, headers: {}, body: {} });
      assert.equal(publishedAnonymous?.statusCode, 401, "a published room does not expose mutation state to anonymous callers");
      assert.equal(roomLookups.length, 0);
    }

    // The public read stays public for a published room without any credential.
    const publicRead = { user: null, params: { code: "published-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, publicRead), null);
    assert.equal(publicRead.responseBody.data.access.kind, "public");

    // The service remains authoritative for every credential-bearing caller.
    const captainRead = { user: { id: "captain-1", role: "user" }, params: { code: "captain-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, captainRead), null);
    assert.deepEqual(captainRead.responseBody.data.access, { kind: "team", slot: 1 });

    const grantRead = { user: null, params: { code: "link-room" }, headers: { "x-veto-token": "live-grant" } };
    assert.equal(await runRoute(getRoom, grantRead), null);
    assert.deepEqual(grantRead.responseBody.data.access, { kind: "team", slot: 1 });

    const staffRead = { user: { id: "staff-1", role: "user" }, params: { code: "captain-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, staffRead), null);
    assert.equal(staffRead.responseBody.data.access.kind, "staff");

    const superAdminRead = { user: { id: "admin-1", role: "admin" }, params: { code: "captain-room" }, headers: {} };
    assert.equal(await runRoute(getRoom, superAdminRead), null);
    assert.equal(superAdminRead.responseBody.data.access.kind, "staff");

    // Cross-tournament staff hold no code-route access; the service rejects them.
    const crossTournamentRead = { user: { id: "other-tournament-staff", role: "user" }, params: { code: "captain-room" }, headers: {} };
    assert.equal((await runRoute(getRoom, crossTournamentRead))?.statusCode, 403);

    // An expired grant passes the route credential check and is refused by the service.
    roomLookups.length = 0;
    const expiredGrantAction = { user: null, params: { code: "link-room" }, headers: { "x-veto-token": "stale-grant" }, body: {} };
    assert.equal((await runRoute(actionsRoom, expiredGrantAction))?.statusCode, 401);
    assert.ok(roomLookups.length > 0, "a supplied credential still reaches service-level authorization");

    // A captain who is not the designated caller is refused by the service, not the route.
    const wrongTeamToss = {
      user: { id: "captain-1", role: "user" },
      params: { code: "captain-room" },
      headers: {},
      body: { call: "heads", expectedRevision: 1 },
    };
    assert.equal((await runRoute(tossRoom, wrongTeamToss))?.statusCode, 409);

    // An unknown but well-formed code still resolves to the existing 404.
    const unknownRoom = { user: { id: "captain-1", role: "user" }, params: { code: "no-such-room" }, headers: {} };
    assert.equal((await runRoute(getRoom, unknownRoom))?.statusCode, 404);
  } finally {
    loaded.restore();
    permission.restore();
    actualController.restore();
    actualService.restore();
  }
});
