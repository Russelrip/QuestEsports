const test = require("node:test");
const assert = require("node:assert/strict");

const runDatabaseTests = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

test("real Prisma client executes public tournament and commerce queries", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const { listPublicTournaments } = require("../src/modules/tournaments/tournament.service");
  const { listPublicSeries } = require("../src/modules/series/series.service");
  const { listPublicProducts } = require("../src/modules/shop/shop.service");
  try {
    const [tournaments, series, products] = await Promise.all([
      listPublicTournaments(),
      listPublicSeries(),
      listPublicProducts(),
    ]);
    assert.ok(Array.isArray(tournaments));
    assert.ok(Array.isArray(series));
    assert.ok(Array.isArray(products));
  } finally {
    await prisma.$disconnect();
  }
});
