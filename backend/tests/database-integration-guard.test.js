const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDatabaseIntegrationTarget,
} = require("./helpers/database-integration-guard");

const local = "postgresql://ci:ci@localhost:5432/quest_ci?schema=public";
const loopback = "postgresql://ci:ci@127.0.0.1:5432/quest_ci";
const remote = "postgresql://someone@db.example.invalid:6543/postgres";

test("the suite stays skipped until it is explicitly enabled", () => {
  const target = resolveDatabaseIntegrationTarget({ flag: undefined, databaseUrl: local });
  assert.equal(target.run, false);
  assert.match(target.reason, /RUN_DATABASE_INTEGRATION_TESTS/);
});

test("an enabled loopback database runs", () => {
  for (const databaseUrl of [local, loopback]) {
    const target = resolveDatabaseIntegrationTarget({ flag: "true", databaseUrl });
    assert.equal(target.run, true, `${databaseUrl} should run`);
    assert.equal(target.reason, null);
  }
});

test("an enabled remote database is refused and names the host without leaking credentials", () => {
  const target = resolveDatabaseIntegrationTarget({ flag: "true", databaseUrl: remote });
  assert.equal(target.run, false, "a remote database must never be written to by accident");
  assert.equal(target.host, "db.example.invalid");
  assert.match(target.reason, /db\.example\.invalid/);
  assert.doesNotMatch(target.reason, /someone/, "the reason must not echo the URL credentials");
});

test("a remote database runs only when it is explicitly opted into", () => {
  const target = resolveDatabaseIntegrationTarget({
    flag: "true",
    databaseUrl: remote,
    allowRemote: "true",
  });
  assert.equal(target.run, true);
  assert.equal(target.reason, null);
});

test("a missing or unreadable database url is refused rather than guessed", () => {
  for (const databaseUrl of [undefined, "", "not-a-url"]) {
    const target = resolveDatabaseIntegrationTarget({ flag: "true", databaseUrl });
    assert.equal(target.run, false, `${JSON.stringify(databaseUrl)} should not run`);
    assert.ok(target.reason);
  }
});
