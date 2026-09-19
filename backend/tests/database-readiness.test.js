const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const databasePath = path.join(__dirname, "../src/lib/database.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const generatedPath = path.join(__dirname, "../src/generated/prisma/index.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const models = [
  {
    name: "Tournament",
    dbName: "tournaments",
    fields: [
      { name: "id", kind: "scalar" },
      { name: "autoApproveRegistrations", dbName: "auto_approve_registrations", kind: "scalar" },
      { name: "status", kind: "enum" },
      { name: "matches", kind: "object" },
    ],
  },
  { name: "Odd\"Name", fields: [{ name: "id", kind: "scalar" }] },
];

const loadDatabase = (queries) => loadModuleWithMocks(databasePath, {
  [prismaPath]: {
    prisma: {
      $queryRaw: async () => { queries.push("SELECT 1"); return [{ "?column?": 1 }]; },
      $queryRawUnsafe: async (sql) => {
        queries.push(sql);
        if (queries.failNext) {
          queries.failNext = false;
          throw new Error('column "auto_approve_registrations" does not exist');
        }
        return [];
      },
    },
  },
  [generatedPath]: { Prisma: { dmmf: { datamodel: { models } } } },
  [loggerPath]: { logger: { info() {}, warn() {} } },
});

test("the schema probe names every column the client can query, and no relations", () => {
  const { module: database, restore } = loadDatabase([]);
  try {
    assert.equal(
      database.buildSchemaProbeSql(models, "public"),
      'SELECT 1 FROM (SELECT "id", "auto_approve_registrations", "status" FROM "public"."tournaments" LIMIT 0) AS probe'
        + " UNION ALL "
        + 'SELECT 1 FROM (SELECT "id" FROM "public"."Odd""Name" LIMIT 0) AS probe',
    );
  } finally {
    restore();
  }
});

test("readiness runs the schema probe, then reuses a pass until it is stale", async () => {
  const queries = [];
  const { module: database, restore } = loadDatabase(queries);
  try {
    await database.checkDatabaseReadiness({ now: 1_000 });
    await database.checkDatabaseReadiness({ now: 1_000 + 60_000 });
    await database.checkDatabaseReadiness({ now: 1_000 + 5 * 60_000 });

    assert.equal(queries.length, 3);
    assert.match(queries[0], /FROM "public"\."tournaments"/);
    assert.equal(queries[1], "SELECT 1");
    assert.match(queries[2], /FROM "public"\."tournaments"/);
  } finally {
    restore();
  }
});

test("a missing column fails readiness, and the failure is not cached", async () => {
  const queries = [];
  const { module: database, restore } = loadDatabase(queries);
  try {
    queries.failNext = true;
    await assert.rejects(database.checkDatabaseReadiness({ now: 1_000 }), /auto_approve_registrations/);
    await database.checkDatabaseReadiness({ now: 1_001 });

    assert.equal(queries.length, 2);
    assert.match(queries[1], /FROM "public"\."tournaments"/);
  } finally {
    restore();
  }
});
