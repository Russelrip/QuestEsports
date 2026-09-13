const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const express = require("express");

const { HttpError } = require("../src/lib/http-error");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/permissions/staff-permission.service.js");
const staffPermissionControllerPath = path.join(__dirname, "../src/modules/permissions/staff-permission.controller.js");
const middlewarePath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const run = async (handler, req) => {
  let result;
  await handler(req, {}, (error) => { result = error || null; });
  return result;
};

// In-memory grants table with the Prisma calls the service makes.
const makePrisma = ({ grants = [], users = {} } = {}) => {
  const rows = grants.map((grant) => ({ ...grant }));
  const client = {
    rows,
    user: { findUnique: async ({ where }) => users[where.id] ?? null },
    userStaffPermission: {
      findUnique: async ({ where }) => {
        const { userId, permission } = where.userId_permission;
        return rows.find((row) => row.userId === userId && row.permission === permission) ? { id: "grant" } : null;
      },
      findMany: async ({ where }) => rows.filter((row) => row.userId === where.userId).map((row) => ({ permission: row.permission })),
      deleteMany: async ({ where }) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index].userId === where.userId && where.permission.in.includes(rows[index].permission)) rows.splice(index, 1);
        }
        return { count: before - rows.length };
      },
      createMany: async ({ data }) => {
        rows.push(...data);
        return { count: data.length };
      },
    },
  };
  client.$transaction = async (callback) => callback(client);
  return client;
};

const loadService = (prisma) => loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } }).module;

const loadMiddleware = (prisma) =>
  loadModuleWithMocks(middlewarePath, {
    [prismaPath]: { prisma },
    [servicePath]: loadService(prisma),
  }).module;

test("requireStaffPermission lets admins and grant holders in, and nobody else", async () => {
  let lookups = 0;
  const prisma = makePrisma({ grants: [{ userId: "staff-1", permission: "valorant_leaderboard" }] });
  const findUnique = prisma.userStaffPermission.findUnique;
  prisma.userStaffPermission.findUnique = async (args) => { lookups += 1; return findUnique(args); };
  const guard = loadMiddleware(prisma).requireStaffPermission("valorant_leaderboard");

  assert.equal(await run(guard, { user: { id: "admin-1", role: "admin" } }), null);
  assert.equal(lookups, 0, "admins never need a grant lookup");

  assert.equal(await run(guard, { user: { id: "staff-1", role: "user" } }), null);

  const denied = await run(guard, { user: { id: "user-2", role: "user" } });
  assert.equal(denied.statusCode, 403);

  const anonymous = await run(guard, { user: null });
  assert.equal(anonymous.statusCode, 401);
});

test("requireStaffPermission refuses to build a guard for an unknown area", () => {
  const middleware = loadMiddleware(makePrisma());
  assert.throws(() => middleware.requireStaffPermission("shop_orders"), /Unknown staff permission/);
});

test("listEffectivePermissions gives admins every area and users only their grants", async () => {
  const service = loadService(makePrisma({ grants: [{ userId: "staff-1", permission: "valorant_leaderboard" }] }));

  assert.deepEqual(await service.listEffectivePermissions({ id: "admin-1", role: "admin" }), service.STAFF_PERMISSION_KEYS);
  assert.deepEqual(await service.listEffectivePermissions({ id: "staff-1", role: "user" }), ["valorant_leaderboard"]);
  assert.deepEqual(await service.listEffectivePermissions({ id: "user-2", role: "user" }), []);
  assert.deepEqual(await service.listEffectivePermissions(null), []);
});

test("setUserStaffPermissions validates the list and the user", async () => {
  const service = loadService(makePrisma({ users: { "user-1": { id: "user-1", role: "user" } } }));

  await assert.rejects(
    service.setUserStaffPermissions({ userId: "user-1", permissions: "valorant_leaderboard", actorUserId: "admin-1" }),
    (error) => error.statusCode === 400 && /must be a list/.test(error.message),
  );
  await assert.rejects(
    service.setUserStaffPermissions({ userId: "user-1", permissions: ["valorant_leaderboard", "everything"], actorUserId: "admin-1" }),
    (error) => error.statusCode === 400 && /everything/.test(error.message),
  );
  await assert.rejects(
    service.setUserStaffPermissions({ userId: "ghost", permissions: [], actorUserId: "admin-1" }),
    (error) => error.statusCode === 404,
  );
});

test("setUserStaffPermissions grants and revokes exactly the difference", async () => {
  const prisma = makePrisma({ users: { "user-1": { id: "user-1", role: "user" } } });
  const service = loadService(prisma);

  const granted = await service.setUserStaffPermissions({
    userId: "user-1",
    permissions: ["valorant_leaderboard", "valorant_leaderboard"],
    actorUserId: "admin-1",
  });
  assert.deepEqual(granted, { userRole: "user", before: [], after: ["valorant_leaderboard"], added: ["valorant_leaderboard"], removed: [] });
  assert.equal(prisma.rows.length, 1);
  assert.equal(prisma.rows[0].grantedByUserId, "admin-1");

  const unchanged = await service.setUserStaffPermissions({ userId: "user-1", permissions: ["valorant_leaderboard"], actorUserId: "admin-1" });
  assert.deepEqual([unchanged.added, unchanged.removed], [[], []]);
  assert.equal(prisma.rows.length, 1);

  const revoked = await service.setUserStaffPermissions({ userId: "user-1", permissions: [], actorUserId: "admin-1" });
  assert.deepEqual([revoked.added, revoked.removed], [[], ["valorant_leaderboard"]]);
  assert.equal(prisma.rows.length, 0);
});

test("updating staff permissions is audited only when something changed", async () => {
  const audits = [];
  const load = (result) => loadModuleWithMocks(staffPermissionControllerPath, {
    [servicePath]: {
      listGrantedPermissions: async () => [],
      listStaffPermissionCatalog: () => [{ key: "valorant_leaderboard", label: "VALORANT leaderboard", description: "" }],
      setUserStaffPermissions: async () => result,
    },
    [auditPath]: {
      recordAudit: async (entry) => { audits.push(entry); },
      requestAuditContext: (req) => ({ actorUserId: req.user.id, requestId: null, ipAddress: null, source: "web" }),
    },
  }).module;
  const res = () => {
    const out = {};
    const response = { status(code) { out.status = code; return response; }, json(body) { out.body = body; return response; } };
    return { response, out };
  };
  const req = { params: { userId: "user-1" }, body: { permissions: ["valorant_leaderboard"] }, user: { id: "admin-1" } };

  const changed = load({ userRole: "user", before: [], after: ["valorant_leaderboard"], added: ["valorant_leaderboard"], removed: [] });
  const first = res();
  await changed.updateUserStaffPermissions(req, first.response, (error) => { throw error; });
  assert.equal(first.out.status, 200);
  assert.deepEqual(first.out.body.data.permissions, ["valorant_leaderboard"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "admin.user.staff_permissions.updated");
  assert.equal(audits[0].targetId, "user-1");
  assert.equal(audits[0].source, "admin");
  assert.deepEqual(audits[0].beforeData, { permissions: [] });

  const noop = load({ userRole: "user", before: ["valorant_leaderboard"], after: ["valorant_leaderboard"], added: [], removed: [] });
  await noop.updateUserStaffPermissions(req, res().response, (error) => { throw error; });
  assert.equal(audits.length, 1);
});

// --- Mounted router ---------------------------------------------------------
//
// The real v1 router with the real permission middleware and a role-checking
// requireAdmin, so these prove what a leaderboard-only staff member can and
// cannot reach, not just that a guard is attached.

const v1Path = path.join(__dirname, "../src/routes/v1.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const authRoutesPath = path.join(__dirname, "../src/modules/auth/auth.routes.js");
const supportRoutesPath = path.join(__dirname, "../src/modules/support/support.routes.js");
const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const tournamentServicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const matchControllerPath = path.join(__dirname, "../src/modules/matches/match.controller.js");
const challongeControllerPath = path.join(__dirname, "../src/modules/challonge/challonge.controller.js");
const staffControllerPath = path.join(__dirname, "../src/modules/permissions/staff.controller.js");
const realtimeControllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const valorantControllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");
const gameAccountControllerPath = path.join(__dirname, "../src/modules/game-accounts/game-account.controller.js");
const leaderboardControllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");

const ok = (_req, res) => res.status(200).json({ success: true });
const okController = new Proxy({}, { get: () => ok });
const pass = (_req, _res, next) => next();

const USERS = {
  admin: { id: "admin-1", role: "admin" },
  staff: { id: "staff-1", role: "user" },
  player: { id: "player-1", role: "user" },
};

const mount = () => {
  const prisma = makePrisma({
    grants: [{ userId: "staff-1", permission: "valorant_leaderboard" }],
    users: { "player-1": USERS.player },
  });
  const service = loadService(prisma);
  const middleware = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma }, [servicePath]: service }).module;
  const staffPermissionController = loadModuleWithMocks(staffPermissionControllerPath, {
    [servicePath]: service,
    [auditPath]: { recordAudit: async () => {}, requestAuditContext: () => ({}) },
  }).module;

  const { module: router, restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: {
      attachSession: (req, _res, next) => { req.user = USERS[req.headers["x-test-user"]] ?? null; next(); },
      requireAuth: (req, _res, next) => next(req.user ? undefined : new HttpError(401, "Login required.")),
      requireAdmin: (req, _res, next) => next(req.user?.role === "admin" ? undefined : new HttpError(403, "Admin access is required.")),
    },
    [authRoutesPath]: { oauthLinkRoutes: express.Router() },
    [supportRoutesPath]: express.Router(),
    [cacheControlPath]: { cachePublicData: () => pass },
    [responseCachePath]: { cacheJson: () => pass, invalidateCache: () => pass },
    [rateLimitPath]: { createRateLimiter: () => pass, getClientIp: () => "127.0.0.1" },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: okController,
    [challongeControllerPath]: okController,
    [staffControllerPath]: okController,
    [realtimeControllerPath]: { getRealtimeEvents: pass },
    [middlewarePath]: middleware,
    [staffPermissionControllerPath]: staffPermissionController,
    [valorantControllerPath]: okController,
    [gameAccountControllerPath]: okController,
    [leaderboardControllerPath]: okController,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ success: false, message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  return { server, prisma, restore: () => { server.close(); restore(); } };
};

const call = (server, method, requestPath, as, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: "127.0.0.1",
      port: server.address().port,
      path: requestPath,
      headers: {
        ...(as ? { "x-test-user": as } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

test("a leaderboard staff member reaches the leaderboard area and nothing else", async () => {
  const mounted = mount();
  try {
    await new Promise((resolve) => mounted.server.once("listening", resolve));
    const { server } = mounted;
    const players = "/api/v1/admin/valorant/leaderboard/players";

    assert.equal((await call(server, "GET", players, "staff")).status, 200);
    assert.equal((await call(server, "DELETE", `${players}/p-1`, "staff", { reason: "x" })).status, 200);

    // The rest of /admin/valorant stays admin-only.
    for (const [method, adminOnly] of [
      ["GET", "/api/v1/admin/valorant/teams"],
      ["GET", "/api/v1/admin/valorant/series"],
      ["POST", "/api/v1/admin/valorant/series/s-1/finalize"],
      ["GET", "/api/v1/admin/game-accounts/change-requests"],
    ]) {
      assert.equal((await call(server, method, adminOnly, "staff", method === "POST" ? {} : undefined)).status, 403, `${method} ${adminOnly}`);
    }

    // Staff cannot hand out access, including to themselves.
    assert.equal((await call(server, "PUT", "/api/v1/admin/users/staff-1/staff-permissions", "staff", { permissions: [] })).status, 403);
    assert.equal((await call(server, "GET", "/api/v1/admin/users/player-1/staff-permissions", "staff")).status, 403);
  } finally {
    mounted.restore();
  }
});

test("a player with no grant and an anonymous caller are kept out of the leaderboard area", async () => {
  const mounted = mount();
  try {
    await new Promise((resolve) => mounted.server.once("listening", resolve));
    const players = "/api/v1/admin/valorant/leaderboard/players";
    assert.equal((await call(mounted.server, "GET", players, "player")).status, 403);
    assert.equal((await call(mounted.server, "DELETE", `${players}/p-1`, "player", { reason: "x" })).status, 403);
    assert.equal((await call(mounted.server, "GET", players)).status, 401);
  } finally {
    mounted.restore();
  }
});

test("an admin grants the leaderboard area and the grant takes effect on the next request", async () => {
  const mounted = mount();
  try {
    await new Promise((resolve) => mounted.server.once("listening", resolve));
    const { server } = mounted;
    const players = "/api/v1/admin/valorant/leaderboard/players";

    assert.equal((await call(server, "GET", players, "player")).status, 403);

    const granted = await call(server, "PUT", "/api/v1/admin/users/player-1/staff-permissions", "admin", { permissions: ["valorant_leaderboard"] });
    assert.equal(granted.status, 200);
    assert.deepEqual(granted.body.data.permissions, ["valorant_leaderboard"]);
    assert.equal((await call(server, "GET", players, "player")).status, 200);

    const revoked = await call(server, "PUT", "/api/v1/admin/users/player-1/staff-permissions", "admin", { permissions: [] });
    assert.equal(revoked.status, 200);
    assert.equal((await call(server, "GET", players, "player")).status, 403);

    const invalid = await call(server, "PUT", "/api/v1/admin/users/player-1/staff-permissions", "admin", { permissions: ["everything"] });
    assert.equal(invalid.status, 400);
  } finally {
    mounted.restore();
  }
});
