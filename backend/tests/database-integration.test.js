const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");
const { HttpError } = require("../src/lib/http-error");

const runDatabaseTests = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const waitlistIntegrationSkip = runDatabaseTests
  ? false
  : "set RUN_DATABASE_INTEGRATION_TESTS=true with an isolated migrated database";

test("real PostgreSQL serializes concurrent waitlist positions", {
  skip: waitlistIntegrationSkip,
}, async (t) => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const tournamentId = crypto.randomUUID();
  const registrationIds = [crypto.randomUUID(), crypto.randomUUID()];

  try {
    await prisma.$connect();
    const indexes = await prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'team_registrations_tournament_id_waitlist_position_key'
    `;
    if (indexes.length === 0) {
      t.skip("waitlist uniqueness migration is not applied to the isolated database");
      return;
    }

    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `integration-waitlist-${suffix}`,
        title: "Waitlist Integration Tournament",
        game: "integration",
        shortDescription: "Waitlist integration test",
        fullDescription: "Waitlist integration test",
        format: "5v5",
        teamSize: 5,
        maxTeams: 1,
        prizePool: "Testing",
        waitlistEnabled: true,
      },
    });

    const createRegistration = (id, number) => prisma.teamRegistration.create({
      data: {
        id,
        tournamentId,
        teamName: `Concurrent Waitlist Team ${number} ${suffix}`,
        captainName: `Concurrent Captain ${number}`,
        captainEmail: `concurrent-${number}-${suffix}@example.com`,
        captainPhone: "+94770000000",
        captainDiscord: `concurrent-${number}-${suffix}`,
        captainRiotId: `Concurrent${number}#TEST`,
        contactEmail: `concurrent-contact-${number}-${suffix}@example.com`,
        status: "waitlisted",
        waitlistPosition: 1,
      },
    });
    const results = await Promise.allSettled(
      registrationIds.map((id, index) => createRegistration(id, index + 1))
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(
      results.find((result) => result.status === "rejected").reason?.code,
      "P2002"
    );
  } finally {
    await prisma.teamRegistration.deleteMany({ where: { id: { in: registrationIds } } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.$disconnect();
  }
});

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

test("VALORANT public-schema tables exist and are RLS-protected", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.relname AS "tableName", c.relrowsecurity AS "rls"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'valorant_team_bindings',
          'quest_valorant_series',
          'quest_valorant_series_games',
          'quest_valorant_matches',
          'quest_valorant_operations'
        )
      ORDER BY c.relname
    `;
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.rls === true));
  } finally {
    await prisma.$disconnect();
  }
});

test("VALORANT binding uniqueness and bypassed-deletion detach are DB-enforced", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const savedTeamId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();

  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Valorant",
        lastName: "Integration",
        email: `val-${suffix}@example.com`,
        emailNormalized: `val-${suffix}@example.com`,
        username: `val-${suffix}`,
        usernameNormalized: `val-${suffix}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.savedTeam.create({
      data: { id: savedTeamId, captainUserId: userId, name: `VAL Team ${suffix}` },
    });

    await prisma.valorantTeamBinding.create({
      data: {
        id: bindingId,
        savedTeamId,
        valorantTeamUuid: "00000000-0000-4000-8000-000000000001",
        status: "active",
        boundByUserId: userId,
      },
    });

    // One active binding per SavedTeam: the partial unique index rejects a second.
    await assert.rejects(
      prisma.valorantTeamBinding.create({
        data: {
          savedTeamId,
          valorantTeamUuid: "00000000-0000-4000-8000-000000000002",
          status: "active",
          boundByUserId: userId,
        },
      }),
      (error) => error?.code === "P2002",
    );

    // Bypassed delete: FK SetNull nulls saved_team_id; the trigger detaches the binding.
    await prisma.savedTeam.delete({ where: { id: savedTeamId } });
    const after = await prisma.valorantTeamBinding.findUnique({ where: { id: bindingId } });
    assert.equal(after.savedTeamId, null);
    assert.equal(after.status, "detached");
    assert.ok(after.detachedAt instanceof Date);
  } finally {
    await prisma.valorantTeamBinding.deleteMany({ where: { boundByUserId: userId } });
    await prisma.savedTeam.deleteMany({ where: { id: savedTeamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

test("guarded deleteSavedTeam rejects 409 while an active binding exists", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const savedTeamId = crypto.randomUUID();

  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Valorant",
        lastName: "Guard",
        email: `val-guard-${suffix}@example.com`,
        emailNormalized: `val-guard-${suffix}@example.com`,
        username: `val-guard-${suffix}`,
        usernameNormalized: `val-guard-${suffix}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.savedTeam.create({
      data: { id: savedTeamId, captainUserId: userId, name: `VAL Guard ${suffix}` },
    });
    await prisma.valorantTeamBinding.create({
      data: {
        savedTeamId,
        valorantTeamUuid: "00000000-0000-4000-8000-000000000003",
        status: "active",
        boundByUserId: userId,
      },
    });

    const teamService = require("../src/modules/teams/team.service");
    await assert.rejects(
      teamService.deleteSavedTeam({ teamId: savedTeamId, user: { id: userId } }),
      (error) => error instanceof HttpError && error.statusCode === 409,
    );

    const stillThere = await prisma.savedTeam.findUnique({ where: { id: savedTeamId } });
    assert.ok(stillThere, "the guarded delete must not remove the team");
  } finally {
    await prisma.valorantTeamBinding.deleteMany({ where: { boundByUserId: userId } });
    await prisma.savedTeam.deleteMany({ where: { id: savedTeamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

test("operation ledger transitions and match projection upsert work against PostgreSQL", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
  const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
  const operationId = crypto.randomUUID();
  let opRowId;

  try {
    const { module: service } = loadModuleWithMocks(servicePath, {
      [prismaPath]: { prisma },
      [clientPath]: {
        valorantRequest: async () => { throw new Error("must not call FastAPI"); },
      },
      [mapperPath]: {},
      [envPath]: { env: { VALORANT_INTERNAL_BASE_URL: "http://localhost:8000" } },
      [httpErrorPath]: { HttpError },
    });

    const op = await service.createOperation({
      type: "team_bind",
      externalKey: `ext-${suffix}`,
      actorUserId: null,
      requestBody: { marker: suffix },
    });
    opRowId = op.id;
    assert.equal(op.status, "pending");
    assert.equal(op.operationId.length, 36);

    const succeeded = await service.markOperationSucceeded(op.id, {
      status: 200,
      requestId: "fastapi-req-x",
      data: { ok: true },
    });
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.fastapiRequestId, "fastapi-req-x");
    assert.equal(succeeded.responseCode, 200);

    // Projection upsert is idempotent by henrik_match_id.
    await prisma.questValorantMatch.upsert({
      where: { henrikMatchId: `henrik-${suffix}` },
      create: {
        matchId: crypto.randomUUID(),
        henrikMatchId: `henrik-${suffix}`,
        mapName: "Ascent",
        startedAt: new Date(),
        redScore: 13,
        blueScore: 8,
        winningSide: "red",
        rosterSummary: { players: [] },
      },
      update: { redScore: 13, blueScore: 8 },
    });
    const projection = await prisma.questValorantMatch.findUnique({
      where: { henrikMatchId: `henrik-${suffix}` },
    });
    assert.equal(projection.redScore, 13);
  } finally {
    if (opRowId) await prisma.questValorantOperation.deleteMany({ where: { id: opRowId } });
    await prisma.questValorantMatch.deleteMany({ where: { henrikMatchId: `henrik-${suffix}` } });
    await prisma.$disconnect();
  }
});
