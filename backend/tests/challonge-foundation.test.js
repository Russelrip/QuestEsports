const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");
const {
  extractChallongeIdentifier,
  normalizeSnapshot,
  mapChallongeStatus,
  requestChallongeJson,
  fetchChallongeSnapshot,
  buildSyncedTournamentUpdate,
} = require("../src/modules/challonge/challonge.service");
const { env } = require("../src/config/env");

test("Challonge identifiers are parsed only from allowlisted HTTPS hosts", () => {
  assert.equal(extractChallongeIdentifier("quest-open"), "quest-open");
  assert.equal(extractChallongeIdentifier("https://challonge.com/quest_open"), "quest_open");
  assert.equal(extractChallongeIdentifier("https://quest.challonge.com/open/module"), "quest-open");
  assert.equal(extractChallongeIdentifier("https://evil.example/quest-open"), null);
  assert.equal(extractChallongeIdentifier("http://challonge.com/quest-open"), null);
  assert.equal(extractChallongeIdentifier("https://challonge.com@evil.example/quest-open"), null);
});

test("Challonge payloads normalize into stable participants and matches", () => {
  const snapshot = normalizeSnapshot({
    tournamentPayload: { tournament: { id: 10, name: "Quest Open", state: "underway", tournament_type: "double elimination" } },
    participantPayload: [{ participant: { id: 2, name: "Alpha", seed: 1 } }, { participant: { id: 3, name: "Beta", seed: 2 } }],
    matchPayload: [{ match: { id: 22, identifier: "A", round: 1, state: "complete", player1_id: 2, player2_id: 3, winner_id: 2, scores_csv: "13-8", updated_at: "2026-07-31T10:00:00Z" } }],
  });
  assert.equal(snapshot.tournament.id, "10");
  assert.deepEqual(snapshot.participants.map((participant) => participant.id), ["2", "3"]);
  assert.deepEqual(snapshot.matches[0], {
    id: "22", identifier: "A", round: 1, state: "complete", player1Id: "2", player2Id: "3", winnerId: "2", loserId: null,
    scoresCsv: "13-8", scheduledAt: null, startedAt: null, underwayAt: null, location: null, updatedAt: "2026-07-31T10:00:00Z",
  });
  assert.equal(mapChallongeStatus(snapshot.matches[0]), "completed");
});

test("Challonge v2.1 JSON:API payloads normalize into the public snapshot contract", () => {
  const snapshot = normalizeSnapshot({
    tournamentPayload: { data: { id: "10", type: "tournament", attributes: {
      name: "Quest Open", state: "underway", tournament_type: "double elimination",
      url: "quest-open", progress_meter: 50,
      timestamps: { updated_at: "2026-08-02T08:00:00Z" },
    } } },
    participantPayload: { data: [
      { id: "2", type: "participant", attributes: { name: "Alpha", seed: 1, final_rank: 1, states: { active: true } } },
      { id: "3", type: "participant", attributes: { name: "Beta", seed: 2, states: { active: false } } },
    ] },
    matchPayload: { data: [{ id: "22", type: "match", attributes: {
      identifier: "A", round: 1, state: "complete", winner_id: 2,
      points_by_participant: [{ participant_id: 2, scores: [13, 13] }, { participant_id: 3, scores: [8, 10] }],
      score_in_sets: [[13, 8], [13, 10]],
      timestamps: { started_at: "2026-08-02T07:00:00Z", updated_at: "2026-08-02T07:45:00Z" },
    } }] },
  });
  assert.equal(snapshot.tournament.fullChallongeUrl, "https://challonge.com/quest-open");
  assert.equal(snapshot.tournament.updatedAt, "2026-08-02T08:00:00Z");
  assert.equal(snapshot.participants[1].active, false);
  assert.equal(snapshot.matches[0].player1Id, "2");
  assert.equal(snapshot.matches[0].player2Id, "3");
  assert.equal(snapshot.matches[0].scoresCsv, "13-8,13-10");
});

test("malformed collection payloads degrade to an empty normalized snapshot", () => {
  const snapshot = normalizeSnapshot({ tournamentPayload: null, participantPayload: { bad: true }, matchPayload: "bad" });
  assert.equal(snapshot.tournament.name, "Challonge Tournament");
  assert.deepEqual(snapshot.participants, []);
  assert.deepEqual(snapshot.matches, []);
});

test("completed Challonge snapshots repair the Quest tournament status", () => {
  assert.deepEqual(buildSyncedTournamentUpdate({
    tournament: {
      state: "complete",
      fullChallongeUrl: "https://challonge.com/quest-open",
    },
  }), {
    bracketLink: "https://challonge.com/quest-open",
    status: "completed",
    isActive: false,
  });
});

test("foundation migration is additive and backfills links as disabled", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260731100000_add_foundation_live_matches_and_challonge/migration.sql"), "utf8");
  for (const table of ["tournament_staff_assignments", "matches", "match_participants", "challonge_integrations", "challonge_participant_links", "challonge_sync_logs", "audit_logs"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(migration, /INSERT INTO "challonge_integrations"/);
  const normalizedMigration = migration.replace(/\r\n/g, "\n");
  assert.match(normalizedMigration, /\n  false,\n/);
  assert.doesNotMatch(migration, /DROP TABLE/);
});

test("foundation tables enable RLS and deny Data API table privileges", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260731110000_secure_foundation_tables/migration.sql"), "utf8");
  for (const table of ["tournament_staff_assignments", "matches", "match_participants", "challonge_integrations", "challonge_participant_links", "challonge_sync_logs", "audit_logs"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`public\\."${table}"`));
  }
  for (const role of ["anon", "authenticated", "service_role"]) assert.match(migration, new RegExp(`'${role}'`));
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE/);
  assert.doesNotMatch(migration, /DROP TABLE/);
});

test("completion migration expands safely while backfilling immutable log identifiers", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260801120000_complete_challonge_integration/migration.sql"), "utf8");
  assert.match(migration, /automatic_sync_enabled/);
  assert.match(migration, /dedupe_key/);
  assert.match(migration, /SET "identifier" = integrations\."identifier"/);
  assert.doesNotMatch(migration, /ALTER COLUMN "identifier" SET NOT NULL/);
  assert.doesNotMatch(migration, /DROP TABLE/);
});

test("Challonge requests keep credentials out of URLs and honor rate-limit retry guidance", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, clientId: env.CHALLONGE_CLIENT_ID, secret: env.CHALLONGE_CLIENT_SECRET, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_CLIENT_ID = original.clientId; env.CHALLONGE_CLIENT_SECRET = original.secret; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_CLIENT_ID = "server-client"; env.CHALLONGE_CLIENT_SECRET = "server-secret";
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === env.CHALLONGE_TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "short-lived-token", expires_in: 3600 }), { status: 200 });
    }
    return new Response("{}", { status: 429, headers: { "Retry-After": "75" } });
  };
  await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === "challonge_rate_limited" && error.retryAfterSeconds === 75);
  assert.equal(requests[0].url, "https://api.challonge.com/oauth/token");
  assert.equal(requests[1].url, "https://api.challonge.com/v2.1/tournaments/test.json");
  assert.doesNotMatch(requests.map((request) => request.url).join(" "), /server-client|server-secret/);
  assert.match(requests[0].options.body, /grant_type=client_credentials/);
  assert.match(requests[0].options.body, /client_secret=server-secret/);
  assert.equal(requests[1].options.headers.Authorization, "Bearer short-lived-token");
  assert.equal(requests[1].options.headers["Authorization-Type"], "v2");
});

test("Challonge upstream failures map to safe error codes", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, clientId: env.CHALLONGE_CLIENT_ID, secret: env.CHALLONGE_CLIENT_SECRET, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_CLIENT_ID = original.clientId; env.CHALLONGE_CLIENT_SECRET = original.secret; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_CLIENT_SECRET = "secret";
  for (const [status, code] of [[401, "challonge_auth_failed"], [404, "challonge_not_found"], [500, "challonge_upstream_error"]]) {
    env.CHALLONGE_CLIENT_ID = `failure-${status}`;
    global.fetch = async (url) => String(url) === env.CHALLONGE_TOKEN_URL
      ? new Response(JSON.stringify({ access_token: `token-${status}`, expires_in: 3600 }), { status: 200 })
      : new Response("{}", { status });
    await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === code && error.status === status);
  }
  env.CHALLONGE_CLIENT_ID = "invalid-json";
  global.fetch = async (url) => String(url) === env.CHALLONGE_TOKEN_URL
    ? new Response(JSON.stringify({ access_token: "invalid-json-token", expires_in: 3600 }), { status: 200 })
    : new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
  await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === "challonge_invalid_response" && !error.message.includes("not-json"));
});

test("Challonge v2.1 snapshot retrieval uses documented application-scoped resources", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, clientId: env.CHALLONGE_CLIENT_ID, secret: env.CHALLONGE_CLIENT_SECRET, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_CLIENT_ID = original.clientId; env.CHALLONGE_CLIENT_SECRET = original.secret; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_CLIENT_ID = "snapshot-client"; env.CHALLONGE_CLIENT_SECRET = "secret";
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url) === env.CHALLONGE_TOKEN_URL) return new Response(JSON.stringify({ access_token: "snapshot-token", expires_in: 3600 }), { status: 200 });
    if (String(url).endsWith("/application/tournaments/10.json")) return new Response(JSON.stringify({ data: { id: "10", attributes: { name: "Quest Open", state: "underway" } } }), { status: 200 });
    if (String(url).includes("/participants.json")) return new Response(JSON.stringify({ data: [{ id: "2", attributes: { name: "Alpha", seed: 1 } }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ id: "22", attributes: { round: 1, state: "open" }, relationships: { player1: { data: { id: "2" } } } }] }), { status: 200 });
  };
  const snapshot = await fetchChallongeSnapshot("10");
  assert.equal(urls.length, 4);
  assert.ok(urls.some((url) => url.includes("/application/tournaments/10/participants.json?page=1&per_page=100")));
  assert.ok(urls.some((url) => url.includes("/application/tournaments/10/matches.json?page=1&per_page=100")));
  assert.equal(snapshot.participants.length, 1);
  assert.equal(snapshot.matches.length, 1);
});

test("Challonge rate limits accept an HTTP-date Retry-After value", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, clientId: env.CHALLONGE_CLIENT_ID, secret: env.CHALLONGE_CLIENT_SECRET, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_CLIENT_ID = original.clientId; env.CHALLONGE_CLIENT_SECRET = original.secret; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_CLIENT_ID = "date-rate-limit-client"; env.CHALLONGE_CLIENT_SECRET = "secret";
  global.fetch = async (url) => String(url) === env.CHALLONGE_TOKEN_URL
    ? new Response(JSON.stringify({ access_token: "date-token", expires_in: 3600 }), { status: 200 })
    : new Response("{}", { status: 429, headers: { "Retry-After": new Date(Date.now() + 5000).toUTCString() } });
  await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === "challonge_rate_limited" && error.retryAfterSeconds >= 1);
});

test("Challonge match results are written once through the application-scoped v2.1 endpoint", async (context) => {
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const cachePath = path.join(__dirname, "../src/lib/cache.js");
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const stored = [];
  const snapshotData = {
    tournament: { id: "10", name: "Quest Cup", state: "underway" },
    participants: [{ id: "2", name: "Alpha" }, { id: "3", name: "Beta" }],
    matches: [{ id: "22", identifier: "A", round: 1, state: "open", player1Id: "2", player2Id: "3", winnerId: null, scoresCsv: null }],
  };
  const prisma = {
    challongeIntegration: {
      findUnique: async () => ({ id: "integration-1", tournamentId: "tournament-1", identifier: "10", enabled: true, snapshotData }),
      update: async (query) => { stored.push(query.data.snapshotData); return query.data; },
    },
  };
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "write-token", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ data: { id: "22", type: "match", attributes: {
      identifier: "A", round: 1, state: "complete", winner_id: 2, score_in_sets: [[13, 8]],
      relationships: { player1: { data: { id: "2" } }, player2: { data: { id: "3" } } },
      timestamps: { updated_at: "2026-08-02T12:00:00Z" },
    } } }), { status: 200 });
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: {
      ...env,
      CHALLONGE_ENABLED: true,
      CHALLONGE_CLIENT_ID: "write-client",
      CHALLONGE_CLIENT_SECRET: "write-secret",
      CHALLONGE_BASE_URL: "https://api.challonge.com/v2.1",
      CHALLONGE_TOKEN_URL: "https://api.challonge.com/oauth/token",
      CHALLONGE_OAUTH_SCOPE: "application:manage",
    } },
    [cachePath]: { get: async () => null, set: async () => undefined, del: async () => undefined },
  });
  try {
    const result = await service.updateChallongeMatchResult({
      tournamentId: "tournament-1",
      matchId: "22",
      body: { player1Score: "13", player2Score: "8", winnerId: "2", tie: false },
    });
    const writeRequest = requests.find((request) => request.options.method === "PUT");
    assert.equal(writeRequest.url, "https://api.challonge.com/v2.1/application/tournaments/10/matches/22.json");
    assert.equal(requests.filter((request) => request.options.method === "PUT").length, 1);
    assert.equal(writeRequest.options.headers.Authorization, "Bearer write-token");
    assert.doesNotMatch(writeRequest.url, /write-client|write-secret|write-token/);
    const body = JSON.parse(writeRequest.options.body);
    assert.equal(body.data.attributes.match[0].participant_id, "2");
    assert.equal(body.data.attributes.match[0].advancing, true);
    assert.equal(result.winnerId, "2");
    assert.equal(stored[0].matches[0].state, "complete");
  } finally { restore(); }
});

test("finalizing Challonge also completes the Quest tournament", async (context) => {
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const cachePath = path.join(__dirname, "../src/lib/cache.js");
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const tournamentUpdates = [];
  const invalidatedTags = [];
  const prisma = {
    challongeIntegration: {
      findUnique: async () => ({
        id: "integration-1",
        tournamentId: "tournament-1",
        identifier: "10",
        enabled: true,
        snapshotData: { tournament: { id: "10", state: "underway" }, participants: [], matches: [] },
      }),
      update: async ({ data }) => data,
    },
    tournament: {
      update: async (query) => { tournamentUpdates.push(query); return query.data; },
    },
  };
  global.fetch = async (url) => String(url).endsWith("/oauth/token")
    ? new Response(JSON.stringify({ access_token: "state-token", expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify({ data: { type: "TournamentState" } }), { status: 200 });
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: {
      ...env,
      CHALLONGE_ENABLED: true,
      CHALLONGE_CLIENT_ID: "state-client",
      CHALLONGE_CLIENT_SECRET: "state-secret",
      CHALLONGE_BASE_URL: "https://api.challonge.com/v2.1",
      CHALLONGE_TOKEN_URL: "https://api.challonge.com/oauth/token",
      CHALLONGE_OAUTH_SCOPE: "application:manage",
    } },
    [cachePath]: {
      get: async () => null,
      set: async () => undefined,
      del: async () => undefined,
      invalidateTags: async (tags) => { invalidatedTags.push(...tags); },
    },
  });
  try {
    const result = await service.changeChallongeTournamentState({
      tournamentId: "tournament-1",
      body: { state: "finalize" },
    });
    assert.equal(result.state, "complete");
    assert.deepEqual(tournamentUpdates, [{
      where: { id: "tournament-1" },
      data: { status: "completed", isActive: false },
    }]);
    assert.deepEqual(invalidatedTags, ["foundation", "tournaments"]);
  } finally { restore(); }
});

test("public linked brackets serve the last successful snapshot as stale data", async () => {
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const snapshot = { tournament: { name: "Quest Open" }, participants: [], matches: [] };
  const prisma = { tournament: { findFirst: async () => ({ bracketLink: "https://challonge.com/quest-open", bracket: { status: "published", bracketData: { native: true } }, challongeIntegration: { enabled: true, snapshotData: snapshot, lastSuccessAt: new Date("2026-01-01T00:00:00Z"), syncFrequency: "five_minutes", lastErrorCode: "challonge_timeout", lastErrorMessage: "Timed out" } }) } };
  const { module: mockedService, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    const result = await mockedService.getPublicBracket("quest-open");
    assert.equal(result.source, "challonge");
    assert.equal(result.status, "stale");
    assert.equal(result.data.tournament.name, snapshot.tournament.name);
    assert.equal(result.data.progression.completedMatches, 0);
    assert.deepEqual(result.error, { code: "challonge_timeout", message: "Timed out" });
  } finally { restore(); }
});

test("changing a Challonge identifier clears only data derived from the old source", async () => {
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const deletedMatches = [];
  const deletedLinks = [];
  let tournamentUpdate = null;
  let integrationUpdate = null;
  const tx = {
    match: { deleteMany: async (query) => { deletedMatches.push(query); } },
    challongeParticipantLink: { deleteMany: async (query) => { deletedLinks.push(query); } },
    tournament: { update: async (query) => { tournamentUpdate = query; } },
    challongeIntegration: {
      upsert: async (query) => {
        integrationUpdate = query;
        return {
          id: "integration-1",
          tournamentId: "tournament-1",
          identifier: query.update.identifier,
          enabled: query.update.enabled,
          automaticSyncEnabled: query.update.automaticSyncEnabled,
          syncFrequency: query.update.syncFrequency,
          participantLinks: [],
        };
      },
    },
  };
  const prisma = {
    tournament: { findUnique: async () => ({ id: "tournament-1", status: "ongoing" }) },
    challongeIntegration: {
      findUnique: async () => ({ id: "integration-1", identifier: "old-cup", enabled: true }),
    },
    $transaction: async (callback) => callback(tx),
  };
  const { module: mockedService, restore } = loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });
  try {
    await mockedService.saveAdminIntegration({
      tournamentId: "tournament-1",
      body: {
        identifier: "https://challonge.com/new-cup",
        enabled: true,
        automaticSyncEnabled: true,
        syncFrequency: "one_minute",
      },
    });
    assert.deepEqual(deletedMatches, [{ where: { tournamentId: "tournament-1", source: "challonge" } }]);
    assert.deepEqual(deletedLinks, [{ where: { integrationId: "integration-1" } }]);
    assert.equal(tournamentUpdate.data.bracketLink, "https://challonge.com/new-cup");
    assert.equal(integrationUpdate.update.snapshotData, null);
    assert.equal(integrationUpdate.update.automaticSyncEnabled, false);
    assert.equal(integrationUpdate.update.nextSyncAt, null);
  } finally { restore(); }
});

test("automatic scheduler claims only enabled one-minute and five-minute integrations", async () => {
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  let schedulerWhere = null;
  const prisma = {
    challongeIntegration: {
      findMany: async (query) => {
        schedulerWhere = query.where;
        return [{ id: "integration-1", nextSyncAt: new Date("2026-08-01T00:00:00Z") }];
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const { module: mockedService, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma },
    [envPath]: { env: { ...env, CHALLONGE_ENABLED: true, CHALLONGE_AUTOMATIC_SYNC_ENABLED: true } },
  });
  try {
    assert.deepEqual(await mockedService.claimDueIntegrationsForQueue(), ["integration-1"]);
    assert.equal(schedulerWhere.enabled, true);
    assert.equal(schedulerWhere.automaticSyncEnabled, true);
    assert.deepEqual(schedulerWhere.syncFrequency, { in: ["one_minute", "five_minutes"] });
    assert.deepEqual(schedulerWhere.tournament, { status: { not: "completed" } });
  } finally {
    restore();
  }
});

test("scheduler records a duplicate-skipped attempt when an integration job is coalesced", async () => {
  const jobsPath = path.join(__dirname, "../src/modules/challonge/challonge.jobs.js");
  const servicePath = path.join(__dirname, "../src/modules/challonge/challonge.service.js");
  const jobQueuePath = path.join(__dirname, "../src/lib/jobs.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const skipped = [];
  const { module: challongeJobs, restore } = loadModuleWithMocks(jobsPath, {
    [envPath]: { env: { ...env, CHALLONGE_ENABLED: true, CHALLONGE_AUTOMATIC_SYNC_ENABLED: true } },
    [jobQueuePath]: {
      CHALLONGE_SYNC_JOB_NAME: "challonge.sync",
      enqueueJob: async () => ({ accepted: false, duplicate: true, jobId: "job-1" }),
    },
    [servicePath]: {
      syncChallongeIntegration: async () => null,
      claimDueIntegrationsForQueue: async () => ["integration-1"],
      recordChallongeSkippedAttempt: async (attempt) => { skipped.push(attempt); },
    },
  });
  try {
    await challongeJobs.runChallongeSchedulerTick();
    assert.deepEqual(skipped, [{
      integrationId: "integration-1",
      trigger: "scheduled",
      reason: "duplicate_job",
    }]);
  } finally { restore(); }
});
