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
