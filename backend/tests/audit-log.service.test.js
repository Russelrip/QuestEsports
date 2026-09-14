const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/audit/audit-log.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const ACTOR_ID = "8b1c6f0e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

const makePrisma = ({ rows = [], total = rows.length, groups = {} } = {}) => {
  const calls = { count: [], findMany: [], groupBy: [] };
  const client = {
    calls,
    auditLog: {
      count: (args) => { calls.count.push(args); return total; },
      findMany: (args) => { calls.findMany.push(args); return rows; },
      groupBy: async (args) => { calls.groupBy.push(args); return groups[args.by[0]] ?? []; },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  return client;
};

const loadService = (prisma) => loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } }).module;

test("an empty query lists everything newest first with a stable tiebreak", async () => {
  const prisma = makePrisma();
  const service = loadService(prisma);

  const result = await service.listAuditLogs({});

  const [findArgs] = prisma.calls.findMany;
  assert.deepEqual(findArgs.where, {});
  assert.deepEqual(findArgs.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(findArgs.skip, 0);
  assert.deepEqual(prisma.calls.count[0].where, {});
  assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 0, totalPages: 1 });
});

test("filters become one where clause shared by the count and the page", async () => {
  const prisma = makePrisma({ total: 250 });
  const service = loadService(prisma);

  const result = await service.listAuditLogs({
    action: " team_registration.status_changed ",
    targetType: "TeamRegistration",
    targetId: "reg-1",
    actorUserId: ACTOR_ID,
    actor: "russ",
    source: "admin",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    page: "3",
    pageSize: "500",
  });

  const [findArgs] = prisma.calls.findMany;
  assert.equal(findArgs.where.action, "team_registration.status_changed");
  assert.equal(findArgs.where.targetType, "TeamRegistration");
  assert.equal(findArgs.where.targetId, "reg-1");
  assert.equal(findArgs.where.actorUserId, ACTOR_ID);
  assert.equal(findArgs.where.source, "admin");
  assert.deepEqual(findArgs.where.createdAt, {
    gte: new Date("2026-09-01T00:00:00.000Z"),
    lt: new Date("2026-09-02T00:00:00.000Z"),
  });
  assert.deepEqual(
    findArgs.where.actor.is.OR.map((clause) => Object.keys(clause)[0]),
    ["username", "email", "firstName", "lastName"],
  );
  assert.deepEqual(findArgs.where.actor.is.OR[0], { username: { contains: "russ", mode: "insensitive" } });
  assert.deepEqual(prisma.calls.count[0].where, findArgs.where);

  // The page size is capped at the audit ceiling, not the shared 50.
  assert.equal(findArgs.take, service.AUDIT_LOG_MAX_PAGE_SIZE);
  assert.equal(findArgs.skip, 200);
  assert.equal(result.pagination.totalPages, 3);
});

test("values Postgres would reject are refused as 400s before any query", async () => {
  const prisma = makePrisma();
  const service = loadService(prisma);

  for (const [query, pattern] of [
    [{ actorUserId: "not-a-uuid" }, /actorUserId/],
    [{ source: "discord" }, /source must be one of/],
    [{ from: "yesterday-ish" }, /from must be a date/],
    [{ to: "soon" }, /to must be a date/],
    [{ from: "2026-09-02T00:00:00Z", to: "2026-09-01T00:00:00Z" }, /from must be before to/],
  ]) {
    await assert.rejects(service.listAuditLogs(query), (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, pattern);
      return true;
    });
  }
  assert.equal(prisma.calls.findMany.length, 0);
});

test("entries carry the actor's identity and the stored before and after", async () => {
  const createdAt = new Date("2026-09-14T08:30:00.000Z");
  const prisma = makePrisma({
    rows: [
      {
        id: "log-1",
        createdAt,
        action: "admin.user.staff_permissions.updated",
        targetType: "User",
        targetId: "user-9",
        actorUserId: ACTOR_ID,
        actor: { id: ACTOR_ID, username: "russ", firstName: "Russel", lastName: "Perera", email: "r@example.com" },
        source: "admin",
        reason: null,
        requestId: "req-1",
        ipAddress: "203.0.113.4",
        beforeData: { permissions: [] },
        afterData: { permissions: ["valorant_leaderboard"] },
      },
      {
        id: "log-2",
        createdAt,
        action: "payment.payhere.reconciled",
        targetType: "Payment",
        targetId: null,
        actorUserId: null,
        actor: null,
        source: null,
        reason: null,
        requestId: null,
        ipAddress: null,
        beforeData: null,
        afterData: undefined,
      },
    ],
  });
  const service = loadService(prisma);

  const { items } = await service.listAuditLogs({});

  assert.deepEqual(prisma.calls.findMany[0].include, {
    actor: { select: { id: true, username: true, firstName: true, lastName: true, email: true } },
  });
  assert.deepEqual(items[0].actor, { id: ACTOR_ID, username: "russ", name: "Russel Perera", email: "r@example.com" });
  assert.equal(items[0].createdAt, "2026-09-14T08:30:00.000Z");
  assert.deepEqual(items[0].afterData, { permissions: ["valorant_leaderboard"] });
  assert.equal(items[1].actor, null);
  assert.equal(items[1].afterData, null);
});

test("facets list the stored actions and target types with counts", async () => {
  const prisma = makePrisma({
    groups: {
      action: [{ action: "match.updated", _count: { _all: 4 } }],
      targetType: [{ targetType: "Match", _count: { _all: 4 } }],
    },
  });
  const service = loadService(prisma);

  const facets = await service.listAuditLogFacets();

  assert.deepEqual(facets, {
    actions: [{ value: "match.updated", count: 4 }],
    targetTypes: [{ value: "Match", count: 4 }],
    sources: ["web", "admin", "mobile", "bot", "system"],
  });
  assert.deepEqual(prisma.calls.groupBy.map((args) => args.by), [["action"], ["targetType"]]);
});

test("the service's source list matches the AuditSource enum", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
  const enumBody = schema.match(/enum AuditSource \{([^}]*)\}/)[1];
  const values = enumBody.split(/\s+/).filter(Boolean);
  assert.deepEqual(loadService(makePrisma()).AUDIT_SOURCES, values);
});

test("both audit log routes are admin-only", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/routes/v1.js"), "utf8");
  const routes = source.split("\n").filter((line) => line.includes('"/admin/audit-logs'));
  assert.equal(routes.length, 2);
  for (const line of routes) {
    assert.match(line, /router\.get\(.*requireAuth, requireAdmin, auditLogController\./);
  }
});
