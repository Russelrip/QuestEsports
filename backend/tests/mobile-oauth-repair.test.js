const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeMobileOauthRedirect,
  normalizeMobileOauthRedirectFile,
} = require("../../ops/normalize-production-mobile-oauth");

test("mobile OAuth repair derives the App Link from API_PUBLIC_URL", () => {
  const result = normalizeMobileOauthRedirect([
    "API_PUBLIC_URL=https://api.questesports.lk",
    "MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth",
    "OTHER_VALUE=preserved",
    "",
  ].join("\n"));

  assert.equal(result.changed, true);
  assert.match(
    result.source,
    /^MOBILE_ADMIN_OAUTH_REDIRECT_URL=https:\/\/api\.questesports\.lk\/mobile-admin-oauth$/m,
  );
  assert.match(result.source, /^OTHER_VALUE=preserved$/m);
});

test("mobile OAuth repair is idempotent and preserves quotes", () => {
  const source = [
    'API_PUBLIC_URL="https://api.questesports.lk"',
    'MOBILE_ADMIN_OAUTH_REDIRECT_URL="https://api.questesports.lk/mobile-admin-oauth"',
  ].join("\n");
  assert.deepEqual(normalizeMobileOauthRedirect(source), { changed: false, source });
});

test("mobile OAuth file repair is atomic and preserves permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quest-mobile-oauth-"));
  const filename = path.join(directory, ".env");
  try {
    fs.writeFileSync(filename, [
      "API_PUBLIC_URL=https://api.questesports.lk",
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth",
    ].join("\n"), { mode: 0o640 });
    const originalMode = fs.statSync(filename).mode & 0o777;
    assert.equal(normalizeMobileOauthRedirectFile(filename), true);
    assert.equal(fs.statSync(filename).mode & 0o777, originalMode);
    assert.equal(normalizeMobileOauthRedirectFile(filename), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mobile OAuth repair adds a missing value and refuses unsafe or ambiguous sources", () => {
  assert.throws(
    () => normalizeMobileOauthRedirect([
      "API_PUBLIC_URL=http://api.questesports.lk",
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth",
    ].join("\n")),
    /HTTPS origin/,
  );
  assert.equal(
    normalizeMobileOauthRedirect("API_PUBLIC_URL=https://api.questesports.lk").source,
    [
      "API_PUBLIC_URL=https://api.questesports.lk",
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL=https://api.questesports.lk/mobile-admin-oauth",
    ].join("\n"),
  );
  assert.throws(
    () => normalizeMobileOauthRedirect([
      "API_PUBLIC_URL=https://api.questesports.lk",
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth",
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://other",
    ].join("\n")),
    /defined more than once/,
  );
});
