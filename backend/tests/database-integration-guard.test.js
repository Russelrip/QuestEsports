const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDatabaseIntegrationTarget,
} = require("./helpers/database-integration-guard");

const local = "postgresql://ci:ci@localhost:5432/quest_ci?schema=public";
const loopback = "postgresql://ci:ci@127.0.0.1:5432/quest_ci";
const remote = "postgresql://someone@db.example.invalid:6543/postgres";

// Every case passes explicit values. `undefined` would fall through to the
// parameter defaults and read the ambient environment, which differs between a
// developer machine and CI -- the exact flakiness this guard exists to prevent.
const resolve = (overrides) => resolveDatabaseIntegrationTarget({
  flag: null,
  databaseUrl: null,
  allowRemote: null,
  ...overrides,
});

const withEnvironment = (values, run) => {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("the suite stays skipped until it is explicitly enabled", () => {
  const target = resolve({ databaseUrl: local });
  assert.equal(target.run, false);
  assert.match(target.reason, /RUN_DATABASE_INTEGRATION_TESTS/);
});

test("an enabled loopback database runs", () => {
  for (const databaseUrl of [local, loopback]) {
    const target = resolve({ flag: "true", databaseUrl });
    assert.equal(target.run, true, `${databaseUrl} should run`);
    assert.equal(target.reason, null);
  }
});

test("an enabled remote database is refused and names the host without leaking credentials", () => {
  const target = resolve({ flag: "true", databaseUrl: remote });
  assert.equal(target.run, false, "a remote database must never be written to by accident");
  assert.equal(target.host, "db.example.invalid");
  assert.match(target.reason, /db\.example\.invalid/);
  assert.doesNotMatch(target.reason, /someone/, "the reason must not echo the URL credentials");
});

test("a remote database runs only when it is explicitly opted into", () => {
  const target = resolve({ flag: "true", databaseUrl: remote, allowRemote: "true" });
  assert.equal(target.run, true);
  assert.equal(target.reason, null);
});

test("a missing or unreadable database url is refused rather than guessed", () => {
  for (const databaseUrl of [null, "", "not-a-url"]) {
    const target = resolve({ flag: "true", databaseUrl });
    assert.equal(target.run, false, `${JSON.stringify(databaseUrl)} should not run`);
    assert.ok(target.reason);
  }
});

test("the defaults read the environment, and an absent database url is still refused", () => {
  withEnvironment({ RUN_DATABASE_INTEGRATION_TESTS: "true", DATABASE_URL: local }, () => {
    const target = resolveDatabaseIntegrationTarget();
    assert.equal(target.run, true, "an enabled loopback environment runs");
  });

  withEnvironment({ RUN_DATABASE_INTEGRATION_TESTS: "true", DATABASE_URL: remote }, () => {
    const target = resolveDatabaseIntegrationTarget();
    assert.equal(target.run, false, "an enabled remote environment is refused");
  });

  withEnvironment({ RUN_DATABASE_INTEGRATION_TESTS: "true", DATABASE_URL: null }, () => {
    const target = resolveDatabaseIntegrationTarget();
    assert.equal(target.run, false, "an absent DATABASE_URL is refused, never guessed");
  });

  withEnvironment({ RUN_DATABASE_INTEGRATION_TESTS: null, DATABASE_URL: local }, () => {
    const target = resolveDatabaseIntegrationTarget();
    assert.equal(target.run, false, "an unset flag keeps the suite skipped");
  });
});
