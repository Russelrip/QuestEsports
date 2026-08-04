const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSafeRedirectPath } = require("../src/lib/validation");

test("safe redirect normalization keeps local application paths", () => {
  assert.equal(
    normalizeSafeRedirectPath("/admin/payments?status=pending#latest"),
    "/admin/payments?status=pending#latest"
  );
});

test("safe redirect normalization rejects external and ambiguous paths", () => {
  for (const redirect of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/%5cevil.example/phish",
    "/%2fevil.example/phish",
    "/admin\n/redirect",
    "javascript:alert(1)",
  ]) {
    assert.equal(normalizeSafeRedirectPath(redirect), null, redirect);
  }
});
