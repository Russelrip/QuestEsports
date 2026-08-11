const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeDatabaseSsl,
  normalizeDatabaseSslFile,
} = require("../../ops/normalize-production-database-ssl");

test("database TLS repair adds sslmode without exposing or dropping URL parameters", () => {
  const result = normalizeDatabaseSsl([
    "DATABASE_URL=postgresql://user:secret@db.example.com:5432/quest?pgbouncer=true",
    'DIRECT_URL="postgresql://user:secret@db.example.com:5432/quest"',
    "OTHER_VALUE=preserved",
    "",
  ].join("\n"));

  assert.equal(result.changed, true);
  assert.match(result.source, /^DATABASE_URL=.*pgbouncer=true&sslmode=require$/m);
  assert.match(result.source, /^DIRECT_URL=".*\?sslmode=require"$/m);
  assert.match(result.source, /^OTHER_VALUE=preserved$/m);
});

test("database TLS repair keeps approved modes unchanged", () => {
  const source = [
    "DATABASE_URL=postgresql://user:secret@db.example.com/quest?sslmode=verify-full",
    "DIRECT_URL=postgresql://user:secret@db.example.com/quest?sslmode=require",
  ].join("\n");
  assert.deepEqual(normalizeDatabaseSsl(source), { changed: false, source });
});

test("database TLS file repair is atomic and preserves permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quest-db-ssl-"));
  const filename = path.join(directory, ".env");
  try {
    fs.writeFileSync(filename, [
      "DATABASE_URL=postgresql://user:secret@db.example.com/quest",
      "DIRECT_URL=postgresql://user:secret@db.example.com/quest",
    ].join("\n"), { mode: 0o640 });
    const originalMode = fs.statSync(filename).mode & 0o777;
    assert.equal(normalizeDatabaseSslFile(filename), true);
    assert.equal(fs.statSync(filename).mode & 0o777, originalMode);
    assert.equal(normalizeDatabaseSslFile(filename), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("database TLS repair refuses missing or duplicate database entries", () => {
  assert.throws(
    () => normalizeDatabaseSsl("DATABASE_URL=postgresql://db.example.com/quest"),
    /Missing required database URL entries/,
  );
  assert.throws(
    () => normalizeDatabaseSsl([
      "DATABASE_URL=postgresql://db.example.com/quest",
      "DATABASE_URL=postgresql://db.example.com/other",
      "DIRECT_URL=postgresql://db.example.com/quest",
    ].join("\n")),
    /defined more than once/,
  );
});
