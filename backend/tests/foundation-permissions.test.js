const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const middlewarePath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const run = async (handler, req) => {
  let result;
  await handler(req, {}, (error) => { result = error || null; });
  return result;
};

test("super admins retain global match and tournament authority", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma: {} } });
  try {
    assert.equal(await run(middleware.requireTournamentStaff(), { user: { id: "admin", role: "admin" }, params: { id: "tournament-a" } }), null);
    assert.equal(await run(middleware.requireMatchStaff(), { user: { id: "admin", role: "admin" }, params: { matchId: "match-a" } }), null);
  } finally { restore(); }
});

test("tournament staff checks are scoped to the requested tournament and role", async () => {
  const queries = [];
  const prisma = { tournamentStaffAssignment: { findFirst: async ({ where }) => { queries.push(where); return where.tournamentId === "tournament-a" && where.role.in.includes("referee") ? { id: "assignment-a" } : null; } } };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    const handler = middleware.requireTournamentStaff({ roles: ["referee"] });
    assert.equal(await run(handler, { user: { id: "ref-1", role: "user" }, params: { id: "tournament-a" } }), null);
    assert.equal((await run(handler, { user: { id: "ref-1", role: "user" }, params: { id: "tournament-b" } })).statusCode, 403);
    assert.deepEqual(queries[1], { tournamentId: "tournament-b", userId: "ref-1", role: { in: ["referee"] } });
  } finally { restore(); }
});

test("match staff cannot use an assignment from a different tournament", async () => {
  const prisma = {
    match: { findUnique: async () => ({ tournamentId: "tournament-b" }) },
    tournamentStaffAssignment: { findFirst: async ({ where }) => where.tournamentId === "tournament-a" ? { id: "assignment-a" } : null },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    const error = await run(middleware.requireMatchStaff(), { user: { id: "ref-1", role: "user" }, params: { matchId: "match-b" } });
    assert.equal(error.statusCode, 403);
  } finally { restore(); }
});

test("scoped permissions export stable scopes and let global admins bypass assignment checks", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, {
    [prismaPath]: { prisma: { tournament: { findUnique: async ({ where }) => ({ id: where.id }) } } },
  });
  try {
    const scopes = Object.values(middleware.PERMISSION_SCOPES);
    assert.ok(scopes.length >= 6);
    for (const scope of scopes) {
      assert.equal(
        await run(middleware.requirePermission(scope), {
          user: { id: "admin", role: "admin" },
          params: { tournamentId: "tournament-a" },
        }),
        null,
      );
    }
  } finally { restore(); }
});

test("scoped permission identifiers and role mappings are explicit and stable", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma: {} } });
  try {
    assert.deepEqual(middleware.PERMISSION_SCOPES, {
      TOURNAMENT_READ: "tournament.read",
      TOURNAMENT_ADMINISTRATION: "tournament.administration",
      STAFF_ROSTER_MANAGEMENT: "staff.roster.management",
      MATCH_OPERATIONS: "match.operations",
      VETO_OPERATIONS: "veto.operations",
      VETO_CATALOG_CONFIG: "veto.catalog.config",
    });
    assert.deepEqual(middleware.ROLE_SCOPES.tournament_admin, [
      "tournament.read",
      "tournament.administration",
      "staff.roster.management",
      "match.operations",
      "veto.operations",
      "veto.catalog.config",
    ]);
    assert.deepEqual(middleware.ROLE_SCOPES.referee, [
      "tournament.read",
      "match.operations",
      "veto.operations",
    ]);
    assert.deepEqual(middleware.ROLE_SCOPES.admin, Object.values(middleware.PERMISSION_SCOPES));
  } finally { restore(); }
});

test("future global-only scopes are not automatically granted to tournament staff", async () => {
  const prisma = {
    tournament: { findUnique: async ({ where }) => ({ id: where.id }) },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => where.role.in.length ? { id: "assignment-a" } : null,
    },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    const futureGlobalOnlyScope = "global.admin-only";
    assert.equal(middleware.ROLE_SCOPES.tournament_admin.includes(futureGlobalOnlyScope), false);
    assert.equal(middleware.ROLE_SCOPES.referee.includes(futureGlobalOnlyScope), false);
    assert.equal(
      (await run(middleware.requirePermission(futureGlobalOnlyScope), {
        user: { id: "staff-1", role: "user" },
        params: { tournamentId: "tournament-a" },
      })).statusCode,
      400,
    );
  } finally { restore(); }
});

test("tournament admins receive every intended scoped permission", async () => {
  const prisma = {
    tournament: { findUnique: async ({ where }) => ({ id: where.id }) },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => where.tournamentId === "tournament-a" && where.role.in.includes("tournament_admin")
        ? { id: "assignment-a" }
        : null,
    },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    for (const scope of middleware.ROLE_SCOPES.tournament_admin) {
      assert.equal(
        await run(middleware.requirePermission(scope), {
          user: { id: "staff-1", role: "user" },
          params: { tournamentId: "tournament-a" },
        }),
        null,
      );
    }
  } finally { restore(); }
});

test("referees receive operational scopes but not roster or catalog scopes", async () => {
  const prisma = {
    tournament: { findUnique: async ({ where }) => ({ id: where.id }) },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => where.tournamentId === "tournament-a" && where.role.in.includes("referee")
        ? { id: "assignment-a" }
        : null,
    },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    for (const scope of [middleware.PERMISSION_SCOPES.TOURNAMENT_READ, middleware.PERMISSION_SCOPES.MATCH_OPERATIONS, middleware.PERMISSION_SCOPES.VETO_OPERATIONS]) {
      assert.equal(await run(middleware.requirePermission(scope), { user: { id: "ref-1", role: "user" }, params: { tournamentId: "tournament-a" } }), null);
    }
    for (const scope of [middleware.PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT, middleware.PERMISSION_SCOPES.VETO_CATALOG_CONFIG, middleware.PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION]) {
      assert.equal((await run(middleware.requirePermission(scope), { user: { id: "ref-1", role: "user" }, params: { tournamentId: "tournament-a" } })).statusCode, 403);
    }
  } finally { restore(); }
});

test("scoped permissions isolate assignments and derive tournament from matches and veto rooms", async () => {
  const queries = [];
  const prisma = {
    match: { findUnique: async ({ where }) => where.id === "match-b" ? { tournamentId: "tournament-b" } : null },
    vetoRoom: { findUnique: async ({ where }) => where.id === "room-b" ? { tournamentId: "tournament-b" } : null },
    tournamentStaffAssignment: {
      findFirst: async ({ where }) => {
        queries.push(where);
        return where.tournamentId === "tournament-b" ? { id: "assignment-b" } : null;
      },
    },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    assert.equal(await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.MATCH_OPERATIONS), {
      user: { id: "ref-1", role: "user" }, params: { matchId: "match-b" },
    }), null);
    assert.equal(await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.VETO_OPERATIONS), {
      user: { id: "ref-1", role: "user" }, params: { roomId: "room-b" },
    }), null);
    assert.equal((await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.MATCH_OPERATIONS), {
      user: { id: "ref-1", role: "user" }, params: { tournamentId: "tournament-a", matchId: "match-b" },
    })).statusCode, 400);
    assert.equal(queries[0].tournamentId, "tournament-b");
  } finally { restore(); }
});

test("explicit tournament IDs are validated even for global admins", async () => {
  const tournamentQueries = [];
  const prisma = {
    tournament: {
      findUnique: async (query) => {
        tournamentQueries.push(query);
        return query.where.id === "tournament-a" ? { id: "tournament-a" } : null;
      },
    },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    assert.equal((await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.TOURNAMENT_READ), {
      user: { id: "admin", role: "admin" }, params: { tournamentId: "missing-tournament" },
    })).statusCode, 404);
    assert.equal(await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.TOURNAMENT_READ), {
      user: { id: "admin", role: "admin" }, params: { tournamentId: "tournament-a" },
    }), null);
    assert.equal((await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.TOURNAMENT_READ), {
      user: { id: "admin", role: "admin" }, params: {}, query: { tournamentId: "missing-tournament" },
    })).statusCode, 404);
    assert.deepEqual(tournamentQueries[0], {
      where: { id: "missing-tournament" },
      select: { id: true },
    });
  } finally { restore(); }
});

test("standalone veto rooms never resolve an explicit tournament scope", async () => {
  const prisma = {
    vetoRoom: { findUnique: async () => ({ id: "room-standalone", tournamentId: null }) },
    tournamentStaffAssignment: { findFirst: async () => ({ id: "assignment-a" }) },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    const roomPermission = middleware.requirePermission(middleware.PERMISSION_SCOPES.VETO_OPERATIONS);
    assert.equal(await run(roomPermission, {
      user: { id: "admin", role: "admin" }, params: { roomId: "room-standalone" }, body: {}, query: {},
    }), null);
    const mismatch = await run(roomPermission, {
      user: { id: "admin", role: "admin" },
      params: { roomId: "room-standalone" }, body: {}, query: { tournamentId: "tournament-a" },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.message, "The tournament does not match the selected resource.");
    assert.equal((await run(roomPermission, {
      user: { id: "staff-1", role: "user" }, params: { roomId: "room-standalone" }, body: {}, query: {},
    })).statusCode, 403);
  } finally { restore(); }
});

test("all configured tournament, match, and room identifiers must agree", async () => {
  const prisma = {
    match: { findUnique: async ({ where }) => ({ tournamentId: "tournament-a", id: where.id }) },
    vetoRoom: { findUnique: async ({ where }) => ({ tournamentId: "tournament-a", id: where.id }) },
    tournamentStaffAssignment: { findFirst: async () => ({ id: "assignment-a" }) },
  };
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma } });
  try {
    const tournamentScope = middleware.requirePermission(middleware.PERMISSION_SCOPES.TOURNAMENT_READ, {
      parameter: "tournamentId", bodyField: "tournamentId", queryField: "tournamentId",
      matchParameter: null, matchBodyField: null, matchQueryField: null,
      roomParameter: null, roomBodyField: null, roomQueryField: null,
    });
    assert.equal((await run(tournamentScope, {
      user: { id: "ref-1", role: "user" },
      params: { tournamentId: "tournament-a" },
      body: { tournamentId: "tournament-b" },
      query: { tournamentId: "tournament-a" },
    })).statusCode, 400);

    const matchScope = middleware.requirePermission(middleware.PERMISSION_SCOPES.MATCH_OPERATIONS, {
      matchParameter: "matchId", matchBodyField: "matchId", matchQueryField: "matchId",
    });
    assert.equal((await run(matchScope, {
      user: { id: "ref-1", role: "user" },
      params: { matchId: "match-a" }, body: { matchId: "match-b" }, query: { matchId: "match-a" },
    })).statusCode, 400);

    const roomScope = middleware.requirePermission(middleware.PERMISSION_SCOPES.VETO_OPERATIONS, {
      roomParameter: "roomId", roomBodyField: "roomId", roomQueryField: "roomId",
    });
    assert.equal((await run(roomScope, {
      user: { id: "ref-1", role: "user" },
      params: { roomId: "room-a" }, body: { roomId: "room-b" }, query: { roomId: "room-a" },
    })).statusCode, 400);

    const mismatch = middleware.requirePermission(middleware.PERMISSION_SCOPES.MATCH_OPERATIONS, {
      matchParameter: "matchId", matchBodyField: "matchId", roomParameter: "roomId", roomBodyField: "roomId",
    });
    prisma.match.findUnique = async () => ({ tournamentId: "tournament-a" });
    prisma.vetoRoom.findUnique = async () => ({ tournamentId: "tournament-b" });
    assert.equal((await run(mismatch, {
      user: { id: "ref-1", role: "user" }, params: { matchId: "match-a", roomId: "room-b" }, body: {},
    })).statusCode, 400);
  } finally { restore(); }
});

test("scoped permissions reject missing and unknown scopes", async () => {
  const { module: middleware, restore } = loadModuleWithMocks(middlewarePath, { [prismaPath]: { prisma: {} } });
  try {
    assert.equal((await run(middleware.requirePermission(middleware.PERMISSION_SCOPES.TOURNAMENT_READ), { user: null, params: {} })).statusCode, 401);
    assert.equal((await run(middleware.requirePermission(), { user: { id: "user-1", role: "user" }, params: { tournamentId: "tournament-a" } })).statusCode, 400);
    assert.equal((await run(middleware.requirePermission("tournament.unknown"), { user: { id: "user-1", role: "user" }, params: { tournamentId: "tournament-a" } })).statusCode, 400);
  } finally { restore(); }
});
