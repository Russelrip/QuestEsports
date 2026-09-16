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

// In-memory staff roles and holdings with the Prisma calls the service and the
// permission middleware make. Roles are { id, name, description, color,
// permissions }; holdings are { userId, roleId }.
const makePrisma = ({ roles = [], holdings = [], users = {}, tournaments = ["tournament-a"] } = {}) => {
  const roleRows = roles.map((role) => ({ description: null, color: null, permissions: [], ...role }));
  const holdingRows = holdings.map((holding) => ({ createdAt: new Date(0), ...holding }));
  const roleById = (id) => roleRows.find((role) => role.id === id);
  const withCount = (role) => ({ ...role, _count: { members: holdingRows.filter((row) => row.roleId === role.id).length } });
  const pickHolding = (row, select) => {
    const role = roleById(row.roleId);
    if (select?.roleId) return { roleId: row.roleId, role: { name: role?.name } };
    return { role: select?.role?.select?.permissions && !select.role.select.id ? { permissions: role.permissions } : withCount(role) };
  };

  const client = {
    roleRows,
    holdingRows,
    user: { findUnique: async ({ where }) => users[where.id] ?? null },
    tournament: { findUnique: async ({ where }) => (tournaments.includes(where.id) ? { id: where.id } : null) },
    tournamentStaffAssignment: { findFirst: async () => null },
    userStaffRole: {
      findFirst: async ({ where }) => {
        const wanted = where.role.permissions.hasSome;
        return holdingRows.find((row) => row.userId === where.userId
          && (roleById(row.roleId)?.permissions ?? []).some((key) => wanted.includes(key))) ? { id: "holding" } : null;
      },
      findMany: async ({ where, select }) => holdingRows.filter((row) => row.userId === where.userId).map((row) => pickHolding(row, select)),
      deleteMany: async ({ where }) => {
        const before = holdingRows.length;
        for (let index = holdingRows.length - 1; index >= 0; index -= 1) {
          if (holdingRows[index].userId === where.userId && where.roleId.in.includes(holdingRows[index].roleId)) holdingRows.splice(index, 1);
        }
        return { count: before - holdingRows.length };
      },
      createMany: async ({ data }) => {
        holdingRows.push(...data.map((row) => ({ createdAt: new Date(), ...row })));
        return { count: data.length };
      },
    },
    staffRole: {
      findFirst: async ({ where }) => roleRows.find((role) => role.name.toLowerCase() === where.name.equals.toLowerCase()
        && (!where.id || role.id !== where.id.not)) ?? null,
      findMany: async ({ where } = {}) => roleRows
        .filter((role) => !where?.id || where.id.in.includes(role.id))
        .map(withCount),
      findUnique: async ({ where, select }) => {
        const role = roleById(where.id);
        if (!role) return null;
        return select?.members ? { ...withCount(role), members: [] } : withCount(role);
      },
      create: async ({ data }) => {
        const role = { ...data };
        roleRows.push(role);
        return withCount(role);
      },
      update: async ({ where, data }) => {
        Object.assign(roleById(where.id), data);
        return withCount(roleById(where.id));
      },
      delete: async ({ where }) => {
        roleRows.splice(roleRows.indexOf(roleById(where.id)), 1);
        for (let index = holdingRows.length - 1; index >= 0; index -= 1) {
          if (holdingRows[index].roleId === where.id) holdingRows.splice(index, 1);
        }
        return { id: where.id };
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

const MEDIA_ROLE = { id: "role-media", name: "Media Team", permissions: ["media"] };
const SHOP_ROLE = { id: "role-shop", name: "Shop", permissions: ["shop", "retired_area"] };

test("requireStaffPermission lets admins and role holders in, and nobody else", async () => {
  let lookups = 0;
  const prisma = makePrisma({ roles: [MEDIA_ROLE], holdings: [{ userId: "staff-1", roleId: "role-media" }] });
  const findFirst = prisma.userStaffRole.findFirst;
  prisma.userStaffRole.findFirst = async (args) => { lookups += 1; return findFirst(args); };
  const guard = loadMiddleware(prisma).requireStaffPermission("media");

  assert.equal(await run(guard, { user: { id: "admin-1", role: "admin" } }), null);
  assert.equal(lookups, 0, "admins never need a role lookup");

  assert.equal(await run(guard, { user: { id: "staff-1", role: "user" } }), null);
  assert.equal((await run(guard, { user: { id: "user-2", role: "user" } })).statusCode, 403);
  assert.equal((await run(guard, { user: null })).statusCode, 401);
});

test("requireStaffPermission with several areas admits a holder of any one of them", async () => {
  const prisma = makePrisma({ roles: [SHOP_ROLE], holdings: [{ userId: "shop-1", roleId: "role-shop" }] });
  const middleware = loadMiddleware(prisma);
  assert.equal(await run(middleware.requireStaffPermission("media", "shop"), { user: { id: "shop-1", role: "user" } }), null);
  assert.equal((await run(middleware.requireStaffPermission("media"), { user: { id: "shop-1", role: "user" } })).statusCode, 403);
});

test("requireStaffPermission refuses to build a guard for an unknown or missing area", () => {
  const middleware = loadMiddleware(makePrisma());
  assert.throws(() => middleware.requireStaffPermission("everything"), /Unknown staff permission/);
  assert.throws(() => middleware.requireStaffPermission("media", "everything"), /Unknown staff permission/);
  assert.throws(() => middleware.requireStaffPermission(), /at least one area/);
});

test("requireSuperAdmin admits only an admin carrying the super admin flag", async () => {
  const { requireSuperAdmin } = loadMiddleware(makePrisma());
  assert.equal(await run(requireSuperAdmin, { user: { id: "owner", role: "admin", isSuperAdmin: true } }), null);
  assert.equal((await run(requireSuperAdmin, { user: { id: "admin", role: "admin", isSuperAdmin: false } })).statusCode, 403);
  assert.equal((await run(requireSuperAdmin, { user: { id: "admin", role: "admin" } })).statusCode, 403);
  // The database refuses this combination; the guard does not trust it either.
  assert.equal((await run(requireSuperAdmin, { user: { id: "odd", role: "user", isSuperAdmin: true } })).statusCode, 403);
  assert.equal((await run(requireSuperAdmin, { user: null })).statusCode, 401);
});

test("the tournaments area opens tournament administration for every tournament, and nothing more", async () => {
  const prisma = makePrisma({
    roles: [{ id: "role-t", name: "Tournament Ops", permissions: ["tournaments"] }],
    holdings: [{ userId: "ops-1", roleId: "role-t" }],
    tournaments: ["tournament-a", "tournament-b"],
  });
  const middleware = loadMiddleware(prisma);
  const scopes = middleware.PERMISSION_SCOPES;
  const as = (id, tournamentId) => ({ user: { id, role: "user" }, params: { id: tournamentId } });

  for (const tournamentId of ["tournament-a", "tournament-b"]) {
    assert.equal(await run(middleware.requirePermission(scopes.TOURNAMENT_ADMINISTRATION, { parameter: "id" }), as("ops-1", tournamentId)), null);
  }
  assert.equal((await run(middleware.requirePermission(scopes.TOURNAMENT_ADMINISTRATION, { parameter: "id" }), as("nobody", "tournament-a"))).statusCode, 403);
  for (const scope of [scopes.MATCH_OPERATIONS, scopes.VETO_OPERATIONS, scopes.STAFF_ROSTER_MANAGEMENT]) {
    assert.equal((await run(middleware.requirePermission(scope, { parameter: "id" }), as("ops-1", "tournament-a"))).statusCode, 403, scope);
  }
  // A missing tournament is still a 404, not a pass.
  assert.equal((await run(middleware.requirePermission(scopes.TOURNAMENT_ADMINISTRATION, { parameter: "id" }), as("ops-1", "tournament-z"))).statusCode, 404);
});

test("listEffectivePermissions gives admins every area and users the union of their roles", async () => {
  const prisma = makePrisma({
    roles: [MEDIA_ROLE, SHOP_ROLE, { id: "role-both", name: "Both", permissions: ["shop", "media"] }],
    holdings: [
      { userId: "staff-1", roleId: "role-shop" },
      { userId: "staff-1", roleId: "role-media" },
      { userId: "staff-1", roleId: "role-both" },
    ],
  });
  const service = loadService(prisma);
  assert.deepEqual(await service.listEffectivePermissions({ id: "admin-1", role: "admin" }), service.STAFF_PERMISSION_KEYS);
  // Catalog order, no duplicates, and keys the catalog no longer knows dropped.
  assert.deepEqual(await service.listEffectivePermissions({ id: "staff-1", role: "user" }), ["media", "shop"]);
  assert.deepEqual(await service.listEffectivePermissions({ id: "user-2", role: "user" }), []);
  assert.deepEqual(await service.listEffectivePermissions(null), []);
});

test("isSuperAdmin requires both the admin role and the flag", () => {
  const service = loadService(makePrisma());
  assert.equal(service.isSuperAdmin({ role: "admin", isSuperAdmin: true }), true);
  assert.equal(service.isSuperAdmin({ role: "admin", isSuperAdmin: false }), false);
  assert.equal(service.isSuperAdmin({ role: "user", isSuperAdmin: true }), false);
  assert.equal(service.isSuperAdmin(null), false);
});

test("creating and editing a role validates the name, colour and areas", async () => {
  const prisma = makePrisma({ roles: [MEDIA_ROLE] });
  const service = loadService(prisma);

  const rejects = async (body, field, status = 400) => {
    await assert.rejects(service.createStaffRole({ body, actorUserId: "owner" }), (error) => {
      assert.equal(error.statusCode, status);
      if (field) assert.ok(error.details?.fieldErrors?.[field] ?? error.fieldErrors?.[field] ?? error.message, field);
      return true;
    });
  };
  await rejects({ name: "   " }, "name");
  await rejects({ name: "x".repeat(41) }, "name");
  await rejects({ name: "Casters", color: "blue" }, "color");
  await rejects({ name: "Casters", description: "x".repeat(201) }, "description");
  await rejects({ name: "Casters", permissions: ["everything"] });
  await rejects({ name: "Casters", permissions: "media" });
  await rejects({ name: "media team" }, "name", 409);

  const created = await service.createStaffRole({
    body: { name: "  Door   Staff ", color: "#5865F2", description: " Entrance ", permissions: ["tickets", "payments", "tickets"] },
    actorUserId: "owner",
  });
  assert.equal(created.name, "Door Staff");
  assert.equal(created.color, "#5865f2");
  assert.equal(created.description, "Entrance");
  assert.deepEqual(created.permissions, ["tickets", "payments"]);
  assert.equal(created.memberCount, 0);
  assert.equal(prisma.roleRows.at(-1).createdByUserId, "owner");

  // Renaming to its own name, in any case, is not a clash.
  const { before, after } = await service.updateStaffRole({ roleId: "role-media", body: { name: "MEDIA TEAM", permissions: ["media", "games"] } });
  assert.deepEqual(before.permissions, ["media"]);
  assert.deepEqual(after.permissions, ["games", "media"]);
  await assert.rejects(service.updateStaffRole({ roleId: "role-media", body: { name: "door staff" } }), { statusCode: 409 });
  await assert.rejects(service.updateStaffRole({ roleId: "missing", body: { name: "Anything" } }), { statusCode: 404 });
  await assert.rejects(service.deleteStaffRole("missing"), { statusCode: 404 });
});

test("setUserStaffRoles validates the input and assigns exactly the difference", async () => {
  const prisma = makePrisma({
    roles: [MEDIA_ROLE, SHOP_ROLE],
    holdings: [{ userId: "user-1", roleId: "role-media" }],
    users: { "user-1": { id: "user-1" } },
  });
  const service = loadService(prisma);

  await assert.rejects(service.setUserStaffRoles({ userId: "user-1", roleIds: "role-shop" }), { statusCode: 400 });
  await assert.rejects(service.setUserStaffRoles({ userId: "user-1", roleIds: [""] }), { statusCode: 400 });
  await assert.rejects(service.setUserStaffRoles({ userId: "user-1", roleIds: ["deleted-role"] }), { statusCode: 400 });
  await assert.rejects(service.setUserStaffRoles({ userId: "ghost", roleIds: [] }), { statusCode: 404 });

  const result = await service.setUserStaffRoles({ userId: "user-1", roleIds: ["role-shop", "role-shop"], actorUserId: "owner" });
  assert.deepEqual(result, { before: ["Media Team"], after: ["Shop"], added: ["Shop"], removed: ["Media Team"] });
  assert.deepEqual(prisma.holdingRows.map((row) => [row.userId, row.roleId, row.grantedByUserId]), [["user-1", "role-shop", "owner"]]);
});

const controllerResponse = () => {
  const out = {};
  const response = { status(code) { out.status = code; return response; }, json(body) { out.body = body; return response; } };
  return { response, out };
};

test("role changes and role assignments are audited, and a no-op assignment is not", async () => {
  const audits = [];
  const load = (overrides) => loadModuleWithMocks(staffPermissionControllerPath, {
    [servicePath]: {
      listStaffPermissionCatalog: () => [],
      listStaffRoles: async () => [],
      getStaffRole: async () => ({}),
      createStaffRole: async () => ({ id: "role-1", name: "Media", description: null, color: null, permissions: ["media"], memberCount: 0 }),
      updateStaffRole: async () => ({
        before: { id: "role-1", name: "Media", description: null, color: null, permissions: ["media"] },
        after: { id: "role-1", name: "Media", description: null, color: "#ffffff", permissions: ["media", "games"] },
      }),
      deleteStaffRole: async () => ({ id: "role-1", name: "Media", description: null, color: null, permissions: ["media"], memberCount: 3 }),
      listUserStaffRoles: async () => [{ id: "role-1", name: "Media" }],
      setUserStaffRoles: async () => ({ before: [], after: ["Media"], added: ["Media"], removed: [] }),
      ...overrides,
    },
    [auditPath]: {
      recordAudit: async (entry) => { audits.push(entry); },
      requestAuditContext: (req) => ({ actorUserId: req.user.id, requestId: null, ipAddress: null, source: "web" }),
    },
  }).module;
  const fail = (error) => { throw error; };
  const req = { params: { userId: "user-1", roleId: "role-1" }, body: { roleIds: ["role-1"] }, user: { id: "owner" } };

  const controller = load();
  const created = controllerResponse();
  await controller.postStaffRole(req, created.response, fail);
  assert.equal(created.out.status, 201);
  await controller.patchStaffRole(req, controllerResponse().response, fail);
  await controller.removeStaffRole(req, controllerResponse().response, fail);
  const assigned = controllerResponse();
  await controller.updateUserStaffRoles(req, assigned.response, fail);
  assert.deepEqual(assigned.out.body.data.roles, [{ id: "role-1", name: "Media" }]);

  assert.deepEqual(audits.map((entry) => entry.action), [
    "admin.staff_role.created",
    "admin.staff_role.updated",
    "admin.staff_role.deleted",
    "admin.user.staff_roles.updated",
  ]);
  assert.ok(audits.every((entry) => entry.source === "admin" && entry.actorUserId === "owner"));
  assert.deepEqual(audits[1].afterData.permissions, ["media", "games"]);
  assert.equal(audits[2].beforeData.memberCount, 3);
  assert.deepEqual(audits[3].afterData, { roles: ["Media"], added: ["Media"], removed: [] });

  const noop = load({ setUserStaffRoles: async () => ({ before: ["Media"], after: ["Media"], added: [], removed: [] }) });
  await noop.updateUserStaffRoles(req, controllerResponse().response, fail);
  assert.equal(audits.length, 4);
});

// --- Mounted router ---------------------------------------------------------
//
// The real v1 router with the real permission middleware and a role-checking
// requireAdmin, so these prove what each kind of account can and cannot reach,
// not just that a guard is attached.

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
  owner: { id: "owner-1", role: "admin", isSuperAdmin: true },
  admin: { id: "admin-1", role: "admin", isSuperAdmin: false },
  staff: { id: "staff-1", role: "user" },
  player: { id: "player-1", role: "user" },
};

const mount = () => {
  const prisma = makePrisma({
    roles: [{ id: "role-lb", name: "VALORANT Leaderboard", permissions: ["valorant_leaderboard"] }],
    holdings: [{ userId: "staff-1", roleId: "role-lb" }],
    users: { "player-1": USERS.player, "staff-1": USERS.staff },
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

const withMounted = async (callback) => {
  const mounted = mount();
  try {
    await new Promise((resolve) => mounted.server.once("listening", resolve));
    await callback(mounted);
  } finally {
    mounted.restore();
  }
};

const PLAYERS = "/api/v1/admin/valorant/leaderboard/players";

test("a leaderboard role holder reaches the leaderboard area and nothing else", () => withMounted(async ({ server }) => {
  assert.equal((await call(server, "GET", PLAYERS, "staff")).status, 200);
  assert.equal((await call(server, "DELETE", `${PLAYERS}/p-1`, "staff", { reason: "x" })).status, 200);

  for (const [method, other] of [
    ["GET", "/api/v1/admin/valorant/teams"],
    ["GET", "/api/v1/admin/valorant/series"],
    ["POST", "/api/v1/admin/valorant/series/s-1/finalize"],
    ["GET", "/api/v1/admin/game-accounts/change-requests"],
    ["GET", "/api/v1/admin/tournaments/tournament-a/challonge"],
    ["GET", "/api/v1/admin/audit-logs"],
  ]) {
    assert.equal((await call(server, method, other, "staff", method === "POST" ? {} : undefined)).status, 403, `${method} ${other}`);
  }

  // Staff cannot see or hand out roles, including to themselves.
  assert.equal((await call(server, "GET", "/api/v1/admin/staff-roles", "staff")).status, 403);
  assert.equal((await call(server, "PUT", "/api/v1/admin/users/staff-1/staff-roles", "staff", { roleIds: [] })).status, 403);
  assert.equal((await call(server, "GET", PLAYERS)).status, 401);
  assert.equal((await call(server, "GET", PLAYERS, "player")).status, 403);
}));

test("an admin who is not a super admin can see roles but cannot change them or who holds them", () => withMounted(async ({ server }) => {
  const list = await call(server, "GET", "/api/v1/admin/staff-roles", "admin");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.roles.map((role) => [role.name, role.memberCount]), [["VALORANT Leaderboard", 1]]);
  assert.ok(list.body.data.catalog.some((area) => area.key === "media"));
  assert.equal((await call(server, "GET", "/api/v1/admin/users/staff-1/staff-roles", "admin")).status, 200);

  assert.equal((await call(server, "POST", "/api/v1/admin/staff-roles", "admin", { name: "Media", permissions: ["media"] })).status, 403);
  assert.equal((await call(server, "PATCH", "/api/v1/admin/staff-roles/role-lb", "admin", { name: "LB", permissions: [] })).status, 403);
  assert.equal((await call(server, "DELETE", "/api/v1/admin/staff-roles/role-lb", "admin")).status, 403);
  assert.equal((await call(server, "PUT", "/api/v1/admin/users/player-1/staff-roles", "admin", { roleIds: ["role-lb"] })).status, 403);
  assert.equal((await call(server, "GET", PLAYERS, "player")).status, 403);
}));

test("a super admin builds a role, assigns it, and edits or deletes it with immediate effect", () => withMounted(async ({ server }) => {
  const changeRequests = "/api/v1/admin/game-accounts/change-requests";
  const challonge = "/api/v1/admin/tournaments/tournament-a/challonge";

  const created = await call(server, "POST", "/api/v1/admin/staff-roles", "owner", { name: "Ops", color: "#57f287", permissions: ["game_accounts"] });
  assert.equal(created.status, 201);
  const roleId = created.body.data.id;

  assert.equal((await call(server, "GET", changeRequests, "player")).status, 403);
  const assigned = await call(server, "PUT", "/api/v1/admin/users/player-1/staff-roles", "owner", { roleIds: [roleId] });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.data.roles.map((role) => role.name), ["Ops"]);
  assert.equal((await call(server, "GET", changeRequests, "player")).status, 200);
  assert.equal((await call(server, "GET", challonge, "player")).status, 403);

  // Changing the role's areas changes what every holder can open.
  assert.equal((await call(server, "PATCH", `/api/v1/admin/staff-roles/${roleId}`, "owner", { name: "Ops", permissions: ["tournaments"] })).status, 200);
  assert.equal((await call(server, "GET", changeRequests, "player")).status, 403);
  assert.equal((await call(server, "GET", challonge, "player")).status, 200);

  assert.equal((await call(server, "DELETE", `/api/v1/admin/staff-roles/${roleId}`, "owner")).status, 200);
  assert.equal((await call(server, "GET", challonge, "player")).status, 403);

  assert.equal((await call(server, "POST", "/api/v1/admin/staff-roles", "owner", { name: "Bad", permissions: ["everything"] })).status, 400);
  assert.equal((await call(server, "PUT", "/api/v1/admin/users/player-1/staff-roles", "owner", { roleIds: ["gone"] })).status, 400);
}));

test("the frontend area catalog mirrors the backend one exactly", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/lib/staff-permissions.ts"), "utf8");
  const block = source.slice(source.indexOf("export const STAFF_PERMISSIONS = {"), source.indexOf("} as const;"));
  const frontend = [...block.matchAll(/^ {2}(\w+): \{\n {4}group: "([^"]+)",\n {4}label: "([^"]+)",\n {4}description: "([^"]+)",\n {2}\},/gm)]
    .map(([, key, group, label, description]) => ({ key, group, label, description }));
  assert.deepEqual(frontend, loadService(makePrisma()).listStaffPermissionCatalog());
});
