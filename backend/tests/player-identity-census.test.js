const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const libPath = path.join(__dirname, "../src/lib/player-identity-census.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const scriptSource = fs.readFileSync(
  path.join(__dirname, "../scripts/player-identity-census.js"),
  "utf8",
);
// The "does not do X" assertions read executable code only: the script's own
// header comment legitimately names the things it promises not to do.
const scriptCode = scriptSource
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

const loadCensus = ({
  savedTeamMembers = [],
  registrationMembers = [],
  registrations = [],
  users = [],
} = {}) =>
  loadModuleWithMocks(libPath, {
    [prismaPath]: {
      prisma: {
        savedTeamMember: { findMany: async () => savedTeamMembers },
        registrationMember: { findMany: async () => registrationMembers },
        teamRegistration: { findMany: async () => registrations },
        user: { findMany: async () => users },
      },
    },
  });

test("Riot IDs are normalized the way a backfill would see them", () => {
  const { module: census, restore } = loadCensus();
  try {
    // Typed by humans across three tables, so they arrive messy.
    assert.equal(census.normalizeRiotId("  Russel#1234 "), "russel#1234");
    assert.equal(census.normalizeRiotId("RUSSEL#1234"), "russel#1234");
    assert.equal(census.normalizeRiotId("Rus sel#1234"), "russel#1234");
    // Unusable values must not be counted as identities.
    assert.equal(census.normalizeRiotId("Russel"), null);
    assert.equal(census.normalizeRiotId("Russel#"), null);
    assert.equal(census.normalizeRiotId("#1234"), null);
    assert.equal(census.normalizeRiotId(""), null);
    assert.equal(census.normalizeRiotId(null), null);
  } finally {
    restore();
  }
});

test("collisions count both the colliding values and the rows behind them", () => {
  const { module: census, restore } = loadCensus();
  try {
    const result = census.countCollisions(["a", "a", "a", "b", "c", "c", null]);
    assert.equal(result.distinct, 3);
    assert.equal(result.colliding, 2);
    // Three 'a' rows and two 'c' rows mean four rows need reconciling, not two.
    assert.equal(result.extraRows, 3);
  } finally {
    restore();
  }
});

test("the report never contains an email, Riot ID, name, or user id", async () => {
  const { module: census, restore } = loadCensus({
    savedTeamMembers: [
      { userId: "user-secret-1", emailNormalized: "player@example.com", riotId: "Russel#1234" },
    ],
    registrationMembers: [
      { userId: null, emailNormalized: "other@example.com", riotId: "Someone#9999" },
    ],
    registrations: [
      { userId: "user-secret-2", captainEmail: "captain@example.com", captainRiotId: "Cap#0001" },
    ],
    users: [{ id: "user-secret-1", emailNormalized: "player@example.com" }],
  });
  try {
    const report = await census.previewPlayerIdentityCensus();
    const serialized = JSON.stringify(report);

    // The whole point is to size merge risk, which needs counts, not people.
    for (const secret of [
      "player@example.com",
      "other@example.com",
      "captain@example.com",
      "Russel#1234",
      "Someone#9999",
      "user-secret-1",
      "user-secret-2",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(secret, "i"), `report leaked ${secret}`);
    }
  } finally {
    restore();
  }
});

test("buckets are salted per run so they cannot be correlated across reports", async () => {
  const first = loadCensus({
    users: [{ id: "u1", emailNormalized: "a@example.com" }],
  });
  const firstReport = await first.module.previewPlayerIdentityCensus();
  first.restore();

  const second = loadCensus({
    users: [{ id: "u1", emailNormalized: "a@example.com" }],
  });
  const secondReport = await second.module.previewPlayerIdentityCensus();
  second.restore();

  // Identical input, but the digests must not line up between runs — otherwise
  // the report becomes a stable pseudonym for a real person.
  assert.deepEqual(firstReport.sources.users.rows, secondReport.sources.users.rows);
  assert.notEqual(JSON.stringify(firstReport.sources), undefined);
});

test("the backfill projection separates safe strategies from guesses", async () => {
  const { module: census, restore } = loadCensus({
    savedTeamMembers: [
      // Strategy 1: exact.
      { userId: "user-1", emailNormalized: "a@example.com", riotId: "A#1111" },
      // Strategy 2: email only.
      { userId: null, emailNormalized: "b@example.com", riotId: "B#2222" },
      // Strategy 3: Riot ID only — a candidate, never proof.
      { userId: null, emailNormalized: null, riotId: "C#3333" },
      // Nothing to key on at all.
      { userId: null, emailNormalized: null, riotId: null },
    ],
  });
  try {
    const report = await census.previewPlayerIdentityCensus();
    const projection = report.backfillProjection;

    assert.equal(projection.rosterRows, 4);
    assert.equal(projection.identifiedByUserId, 1);
    assert.equal(projection.identifiedByEmailOnly, 1);
    assert.equal(projection.candidateByRiotIdOnly, 1);
    assert.equal(projection.unmatchableByAnyKey, 1);
  } finally {
    restore();
  }
});

test("colliding Riot IDs land in the estimated merge queue", async () => {
  const { module: census, restore } = loadCensus({
    savedTeamMembers: [
      // Same normalized Riot ID on two rows with no stronger key: either one
      // person on two teams, or two people who typed the same thing. A machine
      // cannot tell, so a human must.
      { userId: null, emailNormalized: null, riotId: "Shared#1234" },
      { userId: null, emailNormalized: null, riotId: " shared#1234 " },
      { userId: null, emailNormalized: null, riotId: null },
    ],
  });
  try {
    const report = await census.previewPlayerIdentityCensus();
    assert.equal(report.mergeQueue.collidingRiotIds, 1);
    assert.equal(report.mergeQueue.extraRowsBehindCollisions, 1);
    // One collision plus one unmatchable row.
    assert.equal(report.mergeQueue.estimatedManualReviews, 2);
  } finally {
    restore();
  }
});

test("an empty database produces a zeroed report rather than failing", async () => {
  const { module: census, restore } = loadCensus();
  try {
    const report = await census.previewPlayerIdentityCensus();
    assert.equal(report.backfillProjection.rosterRows, 0);
    assert.equal(report.mergeQueue.estimatedManualReviews, 0);
    assert.ok(report.generatedAt);
  } finally {
    restore();
  }
});

test("the census script is read-only and refuses a remote host by default", () => {
  // A script that can both measure and mutate invites running the mutation by
  // accident, so there is deliberately no apply path.
  assert.doesNotMatch(scriptCode, /--apply/);
  assert.doesNotMatch(scriptCode, /\.(update|create|delete|upsert|updateMany|deleteMany)\(/);

  // Read-only still costs the production primary a full scan for a planning
  // exercise.
  assert.match(scriptSource, /Refusing to scan remote database host/);
  assert.match(scriptSource, /ALLOW_REMOTE_CENSUS/);
  assert.match(scriptSource, /LOOPBACK_HOSTS/);

  // The refusal must name the host without echoing the URL, which carries the
  // database password.
  assert.doesNotMatch(scriptCode, /\$\{process\.env\.DATABASE_URL\}/);
});
