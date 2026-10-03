const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");
const { HttpError } = require("../src/lib/http-error");

const { resolveDatabaseIntegrationTarget } = require("./helpers/database-integration-guard");

// These cases write real rows, so the guard refuses any non-loopback database
// unless it is explicitly opted into.
const databaseTarget = resolveDatabaseIntegrationTarget();
const runDatabaseTests = databaseTarget.run;
const waitlistIntegrationSkip = runDatabaseTests ? false : databaseTarget.reason;

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

// A saved-team roster is assembled from two queries that mocks cannot judge:
// one `findMany` whose `where` is an OR of a verified-address match and a
// linked-account match. A mocked client accepts any `where` at all, so the
// shape is only really checked here.
//
// The behaviour matters as much as the shape. Resolving by address alone
// reported somebody who accepted and later changed their account email as
// having no Quest account, on a roster they were already on.
test("a roster resolves its members by linked account against real PostgreSQL", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const { listProfileTeams } = require("../src/modules/teams/team.service");
  const { listInvitationsForUser } = require("../src/modules/teams/invitation.service");
  const suffix = crypto.randomUUID();
  const captainId = crypto.randomUUID();
  const acceptedUserId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  const acceptedMemberId = crypto.randomUUID();
  const pendingMemberId = crypto.randomUUID();
  const invitedAddress = `invited-${suffix}@example.com`;
  const strangerAddress = `stranger-${suffix}@example.com`;

  const createUser = (id, handle, extra = {}) => prisma.user.create({
    data: {
      id,
      firstName: "Integration",
      lastName: "Player",
      email: `${handle}-${suffix}@example.com`,
      emailNormalized: `${handle}-${suffix}@example.com`,
      username: `${handle}-${suffix}`,
      usernameNormalized: `${handle}-${suffix}`,
      passwordHash: "integration-test-hash",
      emailVerified: true,
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });

  try {
    await createUser(captainId, "captain");
    // Accepted the invitation at `invitedAddress`, then changed the address on
    // their account. The link is what still identifies them.
    await createUser(acceptedUserId, "moved", { discordTag: `realhandle-${suffix}` });
    await prisma.oAuthAccount.create({
      data: {
        id: crypto.randomUUID(),
        userId: acceptedUserId,
        provider: "discord",
        providerUserId: `discord-${suffix}`,
      },
    });

    await prisma.savedTeam.create({
      data: {
        id: teamId,
        captainUserId: captainId,
        name: `Integration Roster ${suffix}`,
        country: "Sri Lanka",
        teamTag: "INT",
        members: {
          create: [
            {
              id: crypto.randomUUID(),
              userId: captainId,
              role: "CAPTAIN",
              memberOrder: 0,
              name: "Integration Captain",
              email: `captain-${suffix}@example.com`,
              emailNormalized: `captain-${suffix}@example.com`,
              inviteStatus: "accepted",
            },
            {
              id: acceptedMemberId,
              userId: acceptedUserId,
              role: "PLAYER",
              memberOrder: 1,
              name: "Moved Player",
              email: invitedAddress,
              emailNormalized: invitedAddress,
              // What a captain typed in an older version of the form. Still on
              // the row, and superseded by the connected account above.
              discord: "captain-typed-this",
              inviteStatus: "accepted",
            },
            {
              id: pendingMemberId,
              role: "SUBSTITUTE",
              memberOrder: 1,
              name: "No Account Yet",
              email: strangerAddress,
              emailNormalized: strangerAddress,
              discord: "also-typed",
              inviteStatus: "pending",
              inviteSentAt: new Date(),
              inviteExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            },
          ],
        },
      },
    });

    const teams = await listProfileTeams({ user: { id: captainId } });
    const roster = teams.find((team) => team.id === teamId);
    assert.ok(roster);

    const accepted = roster.members.find((member) => member.id === acceptedMemberId);
    // The address on this row belongs to nobody now. Only the link finds them.
    assert.equal(accepted.hasQuestAccount, true);
    assert.equal(accepted.hasDiscord, true);
    assert.equal(accepted.discord, `realhandle-${suffix}`);
    assert.equal(accepted.userId, undefined);

    const pending = roster.members.find((member) => member.id === pendingMemberId);
    assert.equal(pending.hasQuestAccount, false);
    assert.equal(pending.hasDiscord, false);
    // Nothing live to replace it with, so the stored value is left rather than
    // blanked: losing data to say nothing helps nobody.
    assert.equal(pending.discord, "also-typed");

    // Invitations are whatever the signed-in identity has, over real rows. This
    // account's own invitation is already accepted and somebody else's is still
    // pending, so nothing is waiting on them — and there is no reference for a
    // caller to supply that could change that answer.
    const moved = {
      id: acceptedUserId,
      emailVerified: true,
      emailNormalized: `moved-${suffix}@example.com`,
    };
    const listed = await listInvitationsForUser({ user: moved });
    assert.deepEqual(listed.invitations, []);
    assert.equal("reference" in listed, false);

    // The pending invitation belongs to an address nobody has proven, so no
    // account reaches it — which is the property that used to be reimplemented
    // as a reference check and is really just the identity filter.
    const stranger = {
      id: captainId,
      emailVerified: true,
      emailNormalized: `captain-${suffix}@example.com`,
    };
    const strangerList = await listInvitationsForUser({ user: stranger });
    assert.equal(
      strangerList.invitations.some((invitation) => invitation.id === pendingMemberId),
      false
    );
  } finally {
    await prisma.savedTeam.deleteMany({ where: { id: teamId } });
    await prisma.oAuthAccount.deleteMany({ where: { userId: acceptedUserId } });
    await prisma.user.deleteMany({ where: { id: { in: [captainId, acceptedUserId] } } });
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
          'quest_valorant_operations',
          'match_maps',
          'match_player_stats'
        )
      ORDER BY c.relname
    `;
    assert.equal(rows.length, 7);
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

test("structured scoreboard tables enforce their integrity in PostgreSQL", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const henrikMatchId = `henrik-structured-${suffix}`;
  const puuid = crypto.randomUUID();
  let questMatchId;

  try {
    const questMatch = await prisma.questValorantMatch.create({
      data: {
        matchId: crypto.randomUUID(),
        henrikMatchId,
        mapName: "Ascent",
        startedAt: new Date(),
        redScore: 13,
        blueScore: 8,
        winningSide: "red",
        rosterSummary: { players: [] },
      },
    });
    questMatchId = questMatch.id;

    const matchMap = await prisma.matchMap.create({
      data: {
        questValorantMatchId: questMatch.id,
        mapName: "Ascent",
        mapExternalId: "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319",
        startedAt: new Date(),
        durationMs: 2142000,
        gameVersion: "release-11.04",
        redScore: 13,
        blueScore: 8,
        winningSide: "red",
      },
    });

    await prisma.matchPlayerStat.create({
      data: {
        matchMapId: matchMap.id,
        puuid,
        side: "red",
        displayName: "Quester",
        tagline: "QST",
        scoreTotal: 5460,
        kills: 24,
        deaths: 13,
        assists: 4,
        damageDealt: 4368,
      },
    });

    // One scoreboard line per player per map: a retry must update, not append.
    await assert.rejects(
      prisma.matchPlayerStat.create({
        data: { matchMapId: matchMap.id, puuid, side: "blue" },
      }),
      (error) => error.code === "P2002",
    );

    // The PUUID is the join key to game_accounts, which stores it normalized.
    // If the two could disagree on case the join would silently miss, so the
    // database refuses the de-normalized form outright.
    await assert.rejects(
      prisma.matchPlayerStat.create({
        data: {
          matchMapId: matchMap.id,
          puuid: puuid.toUpperCase(),
          side: "blue",
        },
      }),
      /match_player_stats_puuid_normalized/,
    );

    // A negative score would invert ACS and ADR rather than merely look wrong.
    await assert.rejects(
      prisma.matchMap.update({
        where: { id: matchMap.id },
        data: { redScore: -1 },
      }),
      /match_maps_scores_non_negative/,
    );

    // One structured row per imported map.
    await assert.rejects(
      prisma.matchMap.create({
        data: {
          questValorantMatchId: questMatch.id,
          mapName: "Bind",
          startedAt: new Date(),
        },
      }),
      (error) => error.code === "P2002",
    );

    // The scoreboard is a projection of the import: deleting the cached match
    // takes both the map and its player rows with it.
    await prisma.questValorantMatch.delete({ where: { id: questMatch.id } });
    questMatchId = null;
    assert.equal(await prisma.matchMap.count({ where: { id: matchMap.id } }), 0);
    assert.equal(await prisma.matchPlayerStat.count({ where: { matchMapId: matchMap.id } }), 0);
  } finally {
    if (questMatchId) {
      await prisma.questValorantMatch.deleteMany({ where: { id: questMatchId } });
    }
    await prisma.$disconnect();
  }
});

test("the public VALORANT projection is a query real PostgreSQL accepts", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const service = require("../src/modules/valorant/valorant-public.service");

  // A mocked Prisma client accepts any `select` at all, so the unit tests
  // cannot tell a real column from an invented one — a `finalizedAt` that does
  // not exist on quest_valorant_series passed them and failed instantly here.
  // This case exists to run the projection against the real schema.
  try {
    const missing = await service.getPublicSeries(crypto.randomUUID());
    assert.equal(missing, null);

    const results = await service.getTournamentResults(`no-such-tournament-${crypto.randomUUID()}`);
    assert.equal(results, null);
  } finally {
    await prisma.$disconnect();
  }
});

test("match-room bulk sync and delete queries are ones real PostgreSQL accepts", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const service = require("../src/modules/match-rooms/match-room.service");
  const suffix = crypto.randomUUID();
  const tournamentId = crypto.randomUUID();

  // Mocked Prisma accepts any select/include, so the room queries are run once
  // against the real schema: an unregistered match and a finished one are
  // skipped with reasons, and a finished match's room can be deleted.
  try {
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `integration-rooms-${suffix}`,
        title: "Room Integration Tournament",
        game: "valorant",
        shortDescription: "Room integration test",
        fullDescription: "Room integration test",
        format: "5v5",
        teamSize: 5,
        maxTeams: 2,
        prizePool: "Testing",
      },
    });
    const open = await prisma.match.create({ data: { tournamentId, identifier: "R1", participants: { create: [{ slot: 1, displayName: "Alpha" }, { slot: 2, displayName: "Bravo" }] } } });
    const finished = await prisma.match.create({ data: { tournamentId, identifier: "R2", status: "completed", participants: { create: [{ slot: 1, displayName: "Charlie" }, { slot: 2, displayName: "Delta" }] } } });
    const room = await prisma.matchRoom.create({ data: { matchId: finished.id, code: `IT${suffix.slice(0, 8)}` } });

    const summary = await service.syncTournamentRooms({ tournamentId });
    assert.equal(summary.total, 2);
    assert.equal(summary.created, 0);
    assert.deepEqual(summary.skipped.map((entry) => [entry.matchId, entry.reason]).sort(), [
      [finished.id, "Match is finished"],
      [open.id, "Needs two registered teams"],
    ].sort());
    assert.equal(await prisma.matchRoom.count({ where: { matchId: open.id } }), 0);

    const deleted = await service.deleteMatchRoom({ matchId: finished.id });
    assert.equal(deleted.id, room.id);
    assert.equal(await prisma.matchRoom.count({ where: { id: room.id } }), 0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "match.room.deleted", targetId: finished.id } });
    assert.equal(audit?.beforeData?.code, room.code);
    await prisma.auditLog.deleteMany({ where: { id: audit.id } });
  } finally {
    await prisma.match.deleteMany({ where: { tournamentId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.$disconnect();
  }
});

test("real PostgreSQL readiness fails when a column the client queries is missing", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const { checkDatabaseReadiness } = require("../src/lib/database");

  try {
    await checkDatabaseReadiness({ schemaProbeMaxAgeMs: 0 });
    // The shape of the #128 outage: code that queries a column whose migration
    // never ran. Readiness must say so rather than answer SELECT 1.
    await prisma.$executeRawUnsafe('ALTER TABLE "tournaments" RENAME COLUMN "auto_approve_registrations" TO "readiness_probe_hidden"');
    try {
      await assert.rejects(
        checkDatabaseReadiness({ schemaProbeMaxAgeMs: 0 }),
        /auto_approve_registrations/,
      );
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "tournaments" RENAME COLUMN "readiness_probe_hidden" TO "auto_approve_registrations"');
    }
    await checkDatabaseReadiness({ schemaProbeMaxAgeMs: 0 });
  } finally {
    await prisma.$disconnect();
  }
});

test("real PostgreSQL lets the runtime role run the readiness schema probe", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const { Prisma } = require("../src/generated/prisma");
  const { buildSchemaProbeSql } = require("../src/lib/database");

  // Production connects as quest_runtime. A table it cannot SELECT would fail
  // readiness on every deploy, so the probe runs with the migrations' grants.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE quest_runtime");
      await tx.$queryRawUnsafe(buildSchemaProbeSql(Prisma.dmmf.datamodel.models, "public"));
    });
  } finally {
    await prisma.$disconnect();
  }
});

test("admin game account search and unlink are queries real PostgreSQL accepts", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const service = require("../src/modules/game-accounts/game-account-admin.service");
  const suffix = crypto.randomUUID();
  const short = suffix.slice(0, 8);
  const userId = crypto.randomUUID();
  const playerId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const tournamentId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const externalId = `integration-puuid-${suffix}`;
  // `discord_identities` enforces a real snowflake (^[0-9]{5,32}$), so a label
  // like `discord-<uuid>` is refused outright — exactly the kind of constraint a
  // mocked client cannot show you, and the reason this case exists. Twelve
  // digits: comfortably inside the constraint, and deliberately too short to
  // read as a real Discord id, which the secret scan flags.
  const discordUserId = `1111${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;

  // The search walks Player -> User and Player -> DiscordIdentity, and the
  // unlink leans on `registration_members.game_account_id` being ON DELETE SET
  // NULL. Mocked Prisma accepts any of that, so the relation names, the
  // insensitive filters and the delete behaviour are proven once here.
  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Integration",
        lastName: "Holder",
        email: `holder-${suffix}@example.com`,
        emailNormalized: `holder-${suffix}@example.com`,
        username: `holder-${short}`,
        usernameNormalized: `holder-${short}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
      },
    });
    await prisma.player.create({
      data: { id: playerId, userId, displayName: `Integration Holder ${short}` },
    });
    await prisma.discordIdentity.create({
      data: {
        id: crypto.randomUUID(),
        playerId,
        discordUserId,
        username: `holder-discord-${short}`,
      },
    });
    await prisma.gameAccount.create({
      data: {
        id: accountId,
        playerId,
        game: "valorant",
        externalId,
        username: `Holder${short}`,
        tagline: "LK1",
        region: "ap",
        verificationStatus: "discord_corroborated",
        status: "active",
      },
    });
    await prisma.playerRanking.create({
      // `syncedAt` is required and has no default: every value on this row is
      // as-of, and a cached rank that cannot say when it synced claims more
      // freshness than it has.
      data: {
        id: crypto.randomUUID(),
        playerId,
        game: "valorant",
        position: 4,
        elo: 1200,
        syncedAt: new Date(),
      },
    });
    await prisma.gameAccountChangeRequest.create({
      data: {
        id: requestId,
        playerId,
        currentAccountId: accountId,
        game: "valorant",
        requestedExternalId: `integration-other-${suffix}`,
        requestedUsername: "Other",
        requestedTagline: "LK2",
        reason: "integration fixture",
      },
    });
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `integration-unlink-${suffix}`,
        title: "Unlink Integration Tournament",
        game: "valorant",
        shortDescription: "Unlink integration test",
        fullDescription: "Unlink integration test",
        format: "5v5",
        teamSize: 5,
        maxTeams: 2,
        prizePool: "Testing",
      },
    });
    await prisma.teamRegistration.create({
      data: {
        id: registrationId,
        tournamentId,
        teamName: `Unlink Team ${short}`,
        captainName: "Integration Captain",
        captainEmail: `captain-${suffix}@example.com`,
        captainPhone: "+94770000000",
        captainDiscord: `captain-${short}`,
        captainRiotId: `Holder${short}#LK1`,
        contactEmail: `contact-${suffix}@example.com`,
        status: "approved",
        members: {
          create: [{
            id: memberId,
            role: "PLAYER",
            memberOrder: 0,
            name: "Integration Holder",
            playerId,
            // The committed competitive identity, alongside the link that is
            // about to be released.
            gameAccountId: accountId,
            externalIdSnapshot: externalId,
            usernameSnapshot: `Holder${short}`,
            tagSnapshot: "LK1",
            verificationStatusSnapshot: "discord_corroborated",
            snapshotAt: new Date(),
          }],
        },
      },
    });

    // All three search forms, against the real schema.
    const byRiotId = await service.searchLinkedAccounts({ query: `Holder${short}#LK1` });
    assert.equal(byRiotId.length, 1);
    assert.equal(byRiotId[0].id, accountId);
    assert.equal(byRiotId[0].player.discord.username, `holder-discord-${short}`);
    assert.equal(byRiotId[0].registrationSnapshots, 1);
    // Never the identifier itself, even for staff.
    assert.equal(byRiotId[0].externalId, undefined);

    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { publicId: true },
    });
    const byPublicId = await service.searchLinkedAccounts({ query: player.publicId });
    assert.deepEqual(byPublicId.map((entry) => entry.id), [accountId]);

    // Case-insensitive, and reaching through Player -> User and
    // Player -> DiscordIdentity.
    for (const query of [`holder${short}`, `INTEGRATION HOLDER ${short}`, `holder-discord-${short}`]) {
      const found = await service.searchLinkedAccounts({ query });
      assert.ok(found.some((entry) => entry.id === accountId), `no match for ${query}`);
    }

    const result = await service.unlinkGameAccount({
      accountId,
      reason: "Integration test releases the account.",
      expectedRiotId: `Holder${short}#LK1`,
      adminUserId: userId,
    });

    assert.equal(result.released.riotId, `Holder${short}#LK1`);
    assert.equal(result.changeRequestsClosed, 1);
    assert.equal(result.rankingsCleared, 1);
    assert.equal(result.leaderboard, null);

    // The identifier is genuinely free: the unique index no longer holds it.
    assert.equal(await prisma.gameAccount.count({ where: { id: accountId } }), 0);
    const reclaimedId = crypto.randomUUID();
    await prisma.gameAccount.create({
      data: {
        id: reclaimedId,
        playerId,
        game: "valorant",
        externalId,
        username: `Reclaimed${short}`,
        tagline: "LK9",
        status: "active",
      },
    });
    assert.equal(await prisma.gameAccount.count({ where: { id: reclaimedId } }), 1);

    // The roster keeps what it registered; only the link is gone. This is the
    // whole reason deleting the row is safe, and it is a database behaviour no
    // mock can demonstrate.
    const member = await prisma.registrationMember.findUnique({ where: { id: memberId } });
    assert.equal(member.gameAccountId, null);
    assert.equal(member.externalIdSnapshot, externalId);
    assert.equal(member.usernameSnapshot, `Holder${short}`);
    assert.equal(member.tagSnapshot, "LK1");
    assert.equal(member.verificationStatusSnapshot, "discord_corroborated");

    const closed = await prisma.gameAccountChangeRequest.findUnique({ where: { id: requestId } });
    assert.equal(closed.status, "rejected");
    assert.match(closed.adminNote, /staff unlinked the account/);
    assert.equal(await prisma.playerRanking.count({ where: { playerId, game: "valorant" } }), 0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "game_account.unlinked", targetId: accountId },
    });
    assert.ok(audit, "the unlink was not audited");
    assert.equal(audit.beforeData.displayIdentity, `Holder${short}#LK1`);
    assert.equal(audit.reason, "Integration test releases the account.");
    // Audit policy redacts PUUIDs; the fingerprint is what ties the row back.
    assert.ok(audit.beforeData.externalIdFingerprint);
    assert.equal(JSON.stringify(audit.beforeData).includes(externalId), false);
    await prisma.auditLog.deleteMany({ where: { id: audit.id } });
  } finally {
    await prisma.registrationMember.deleteMany({ where: { registrationId } });
    await prisma.teamRegistration.deleteMany({ where: { id: registrationId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.gameAccountChangeRequest.deleteMany({ where: { playerId } });
    await prisma.playerRanking.deleteMany({ where: { playerId } });
    await prisma.gameAccount.deleteMany({ where: { playerId } });
    await prisma.discordIdentity.deleteMany({ where: { playerId } });
    await prisma.player.deleteMany({ where: { id: playerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

// The promote action's whole job is a cross-table move: read every child
// tournament's sponsors, write one event row per brand, delete the child rows.
// A mocked client accepts any of those clauses, so only the real schema can show
// that the cascade, the dedupe and the surviving logo reference all hold.
test("real PostgreSQL moves child tournament sponsors onto the event", {
  skip: waitlistIntegrationSkip,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const { promoteTournamentSponsorsToEvent } = require("../src/modules/tournaments/sponsor.service");
  const { getPublicTournamentBySlug } = require("../src/modules/tournaments/tournament-public.service");

  const suffix = crypto.randomUUID();
  const short = suffix.slice(0, 8);
  const seriesId = crypto.randomUUID();
  const tournamentIds = [crypto.randomUUID(), crypto.randomUUID()];

  const tournamentData = (id, index) => ({
    id,
    seriesId,
    seriesOrder: index,
    slug: `integration-sponsor-${index}-${suffix}`,
    title: `Sponsor Integration ${index}`,
    game: "integration",
    shortDescription: "Sponsor integration test",
    fullDescription: "Sponsor integration test",
    format: "5v5",
    teamSize: 5,
    maxTeams: 8,
    prizePool: "Testing",
    isPublished: true,
  });

  try {
    await prisma.$connect();
    await prisma.eventSeries.create({
      data: {
        id: seriesId,
        slug: `integration-sponsor-event-${suffix}`,
        title: `Sponsor Integration Event ${short}`,
        description: "Sponsor integration test",
        isPublished: true,
      },
    });
    await prisma.tournament.create({ data: tournamentData(tournamentIds[0], 0) });
    await prisma.tournament.create({ data: tournamentData(tournamentIds[1], 1) });

    await prisma.eventSponsor.create({
      data: { id: crypto.randomUUID(), seriesId, name: `Kobra ${short}`, partnershipLabel: "Energy Partner" },
    });
    await prisma.tournamentSponsor.createMany({
      data: [
        // Backs the event already: the child row goes, nothing is added.
        { id: crypto.randomUUID(), tournamentId: tournamentIds[0], name: `kobra ${short} `, logoImageName: `dropped-${short}.webp` },
        { id: crypto.randomUUID(), tournamentId: tournamentIds[0], name: `G-Flock ${short}`, partnershipLabel: "Silver Sponsor", logoImageName: `kept-${short}.webp`, displayOrder: 20 },
        // The same brand on a second game collapses into the one promoted row.
        { id: crypto.randomUUID(), tournamentId: tournamentIds[1], name: `g-flock ${short}`, logoImageName: `dropped-two-${short}.webp` },
        { id: crypto.randomUUID(), tournamentId: tournamentIds[1], name: `Pearl Bay ${short}`, websiteUrl: "https://pearlbay.example" },
      ],
    });

    const result = await promoteTournamentSponsorsToEvent(seriesId, {
      audit: { actorUserId: null, source: "admin", requestId: null, ipAddress: null },
    });
    assert.equal(result.moved, 2);
    assert.equal(result.removed, 4);

    assert.equal(await prisma.tournamentSponsor.count({ where: { tournamentId: { in: tournamentIds } } }), 0);
    const promoted = await prisma.eventSponsor.findMany({
      where: { seriesId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    assert.deepEqual(promoted.map((sponsor) => sponsor.name), [
      `G-Flock ${short}`,
      `Kobra ${short}`,
      `Pearl Bay ${short}`,
    ]);
    // The promoted row took over the child's logo file, so that file is still
    // referenced and must not have been swept as an orphan.
    const gFlock = promoted.find((sponsor) => sponsor.name === `G-Flock ${short}`);
    assert.equal(gFlock.logoImageName, `kept-${short}.webp`);
    assert.equal(gFlock.partnershipLabel, "Silver Sponsor");

    // A child tournament now shows the event's sponsors although it owns none.
    const child = await getPublicTournamentBySlug(`integration-sponsor-0-${suffix}`);
    assert.deepEqual(child.sponsors.map((sponsor) => sponsor.name), [
      `G-Flock ${short}`,
      `Kobra ${short}`,
      `Pearl Bay ${short}`,
    ]);
    assert.equal(child.sponsors[0].logoUrl, `/api/uploads/sponsor-logos/kept-${short}.webp`);

    // Running it again is a no-op rather than a second round of duplicates.
    const repeat = await promoteTournamentSponsorsToEvent(seriesId, {
      audit: { actorUserId: null, source: "admin", requestId: null, ipAddress: null },
    });
    assert.equal(repeat.moved, 0);
    assert.equal(repeat.removed, 0);
    assert.equal(await prisma.eventSponsor.count({ where: { seriesId } }), 3);

    // The child rows are gone, so this entry is the only remaining description
    // of what was moved -- and it has to have committed with the move itself.
    const audits = await prisma.auditLog.findMany({
      where: { action: "sponsor.promoted", targetId: seriesId },
      orderBy: { createdAt: "asc" },
    });
    // One entry, not two: the second run found nothing to move and returned
    // before opening a transaction. A no-op has nothing to describe, and an
    // entry for it would only dilute the log it is meant to make searchable.
    assert.equal(audits.length, 1, "the move is audited and the no-op is not");
    const [moveAudit] = audits;
    assert.equal(moveAudit.targetType, "EventSeries");
    assert.equal(moveAudit.source, "admin");
    assert.equal(moveAudit.beforeData.tournamentSponsors.length, 4);
    assert.equal(moveAudit.afterData.tournamentSponsorsRemoved, 4);
    assert.deepEqual(
      moveAudit.afterData.eventSponsorsCreated.map((sponsor) => sponsor.name).sort(),
      [`G-Flock ${short}`, `Pearl Bay ${short}`],
    );
    // The dropped duplicate is named in beforeData even though nothing replaced
    // it, which is the only place that row is now recorded at all.
    assert.ok(
      moveAudit.beforeData.tournamentSponsors.some((sponsor) => sponsor.name === `kobra ${short} `),
      "the deduped child row should still be described",
    );

  } finally {
    await prisma.auditLog.deleteMany({ where: { action: "sponsor.promoted", targetId: seriesId } });
    await prisma.tournamentSponsor.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
    await prisma.eventSponsor.deleteMany({ where: { seriesId } });
    await prisma.eventSeries.deleteMany({ where: { id: seriesId } });
    await prisma.$disconnect();
  }
});
