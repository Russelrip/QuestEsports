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

test("malformed collection payloads degrade to an empty normalized snapshot", () => {
  const snapshot = normalizeSnapshot({ tournamentPayload: null, participantPayload: { bad: true }, matchPayload: "bad" });
  assert.equal(snapshot.tournament.name, "Challonge Tournament");
  assert.deepEqual(snapshot.participants, []);
  assert.deepEqual(snapshot.matches, []);
});

test("foundation migration is additive and backfills links as disabled", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260731100000_add_foundation_live_matches_and_challonge/migration.sql"), "utf8");
  for (const table of ["tournament_staff_assignments", "matches", "match_participants", "challonge_integrations", "challonge_participant_links", "challonge_sync_logs", "audit_logs"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(migration, /INSERT INTO "challonge_integrations"/);
  assert.match(migration, /\n  false,\n/);
  assert.doesNotMatch(migration, /DROP TABLE/);
});

test("Challonge requests keep credentials out of URLs and honor rate-limit retry guidance", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, username: env.CHALLONGE_USERNAME, key: env.CHALLONGE_API_KEY, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_USERNAME = original.username; env.CHALLONGE_API_KEY = original.key; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_USERNAME = "server-user"; env.CHALLONGE_API_KEY = "server-secret";
  let requestUrl = ""; let authorization = "";
  global.fetch = async (url, options) => { requestUrl = String(url); authorization = options.headers.Authorization; return new Response("{}", { status: 429, headers: { "Retry-After": "75" } }); };
  await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === "challonge_rate_limited" && error.retryAfterSeconds === 75);
  assert.equal(requestUrl, "https://api.challonge.com/v1/tournaments/test.json");
  assert.doesNotMatch(requestUrl, /server-user|server-secret/);
  assert.equal(authorization, `Basic ${Buffer.from("server-user:server-secret").toString("base64")}`);
});

test("Challonge upstream failures map to safe error codes", async (context) => {
  const original = { enabled: env.CHALLONGE_ENABLED, username: env.CHALLONGE_USERNAME, key: env.CHALLONGE_API_KEY, fetch: global.fetch };
  context.after(() => { env.CHALLONGE_ENABLED = original.enabled; env.CHALLONGE_USERNAME = original.username; env.CHALLONGE_API_KEY = original.key; global.fetch = original.fetch; });
  env.CHALLONGE_ENABLED = true; env.CHALLONGE_USERNAME = "user"; env.CHALLONGE_API_KEY = "key";
  for (const [status, code] of [[401, "challonge_auth_failed"], [404, "challonge_not_found"], [500, "challonge_upstream_error"]]) {
    global.fetch = async () => new Response("{}", { status });
    await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === code && error.status === status);
  }
  global.fetch = async () => new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
  await assert.rejects(requestChallongeJson("/tournaments/test.json"), (error) => error.code === "challonge_network_error" && !error.message.includes("not-json"));
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
    assert.equal(result.data, snapshot);
    assert.deepEqual(result.error, { code: "challonge_timeout", message: "Timed out" });
  } finally { restore(); }
});
