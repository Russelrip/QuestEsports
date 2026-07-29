const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

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

test("real PostgreSQL protects sessions and claims a queued job only once", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const sessionService = require("../src/modules/auth/session.service");
  const { enqueueJob, runJobWorkerTick } = require("../src/lib/jobs");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let jobId;

  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Integration",
        lastName: "Player",
        email: `integration-${suffix}@example.com`,
        emailNormalized: `integration-${suffix}@example.com`,
        username: `integration-${suffix}`,
        usernameNormalized: `integration-${suffix}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    const session = await sessionService.createSession({
      userId,
      rememberMe: false,
      userAgent: "Quest integration test",
      ipAddress: "127.0.0.1",
    });
    const persistedSession = await prisma.session.findUnique({
      where: { id: session.sessionId },
    });
    assert.ok(persistedSession);
    assert.notEqual(persistedSession.tokenHash, session.token);
    assert.equal(persistedSession.tokenHash.length, 64);

    const resolved = await sessionService.getSessionFromRequest({
      headers: { cookie: `quest_session=${session.token}` },
    });
    assert.equal(resolved.user.id, userId);
    assert.equal(resolved.sessionId, session.sessionId);

    const queued = await enqueueJob(
      `integration-unsupported-${suffix}`,
      { marker: suffix, rawToken: "must-not-remain-after-failure" },
      { maxAttempts: 1 }
    );
    jobId = queued.jobId;
    const processedCounts = await Promise.all([
      runJobWorkerTick(),
      runJobWorkerTick(),
    ]);
    assert.equal(processedCounts.reduce((total, count) => total + count, 0), 1);

    const failedJob = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.attempts, 1);
    assert.equal(failedJob.payload.marker, suffix);
    assert.equal("rawToken" in failedJob.payload, false);
    assert.equal("tokenCiphertext" in failedJob.payload, false);
  } finally {
    if (jobId) await prisma.backgroundJob.deleteMany({ where: { id: jobId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
