const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRuntimeDatabaseUrl } = require("../src/lib/database-url");

test("runtime database URLs receive bounded Prisma pool defaults", () => {
  const result = new URL(buildRuntimeDatabaseUrl("postgresql://user:pass@db.example.com/quest"));

  assert.equal(result.searchParams.get("connection_limit"), "5");
  assert.equal(result.searchParams.get("pool_timeout"), "10");
  assert.equal(result.searchParams.get("connect_timeout"), "10");
});

test("explicit Prisma pool parameters remain authoritative", () => {
  const result = new URL(buildRuntimeDatabaseUrl(
    "postgresql://user:pass@db.example.com/quest?connection_limit=8&pool_timeout=20&connect_timeout=3"
  ));

  assert.equal(result.searchParams.get("connection_limit"), "8");
  assert.equal(result.searchParams.get("pool_timeout"), "20");
  assert.equal(result.searchParams.get("connect_timeout"), "3");
});
