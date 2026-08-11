const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeMobileCertificate,
  normalizeMobileCertificateFile,
} = require("../../ops/normalize-production-mobile-certificate");

const FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, "0"),
).join(":");

test("mobile certificate repair updates or adds the verified fingerprint", () => {
  const updated = normalizeMobileCertificate([
    "MOBILE_ADMIN_ANDROID_CERT_SHA256=invalid",
    "OTHER_VALUE=preserved",
  ].join("\n"), FINGERPRINT);
  assert.equal(updated.changed, true);
  assert.match(updated.source, new RegExp(`^MOBILE_ADMIN_ANDROID_CERT_SHA256=${FINGERPRINT.toUpperCase()}$`, "m"));
  assert.match(updated.source, /^OTHER_VALUE=preserved$/m);

  const added = normalizeMobileCertificate("OTHER_VALUE=preserved", FINGERPRINT);
  assert.match(added.source, new RegExp(`^MOBILE_ADMIN_ANDROID_CERT_SHA256=${FINGERPRINT.toUpperCase()}$`, "m"));
});

test("mobile certificate repair is case-insensitively idempotent", () => {
  const source = `MOBILE_ADMIN_ANDROID_CERT_SHA256=${FINGERPRINT}`;
  assert.deepEqual(normalizeMobileCertificate(source, FINGERPRINT.toUpperCase()), {
    changed: false,
    source,
  });
});

test("mobile certificate file repair is atomic and preserves permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quest-mobile-cert-"));
  const filename = path.join(directory, ".env");
  try {
    fs.writeFileSync(filename, "OTHER_VALUE=preserved\n", { mode: 0o640 });
    const originalMode = fs.statSync(filename).mode & 0o777;
    assert.equal(normalizeMobileCertificateFile(filename, FINGERPRINT), true);
    assert.equal(fs.statSync(filename).mode & 0o777, originalMode);
    assert.equal(normalizeMobileCertificateFile(filename, FINGERPRINT), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mobile certificate repair refuses invalid fingerprints and duplicates", () => {
  assert.throws(
    () => normalizeMobileCertificate("OTHER_VALUE=preserved", "not-a-fingerprint"),
    /colon-separated SHA-256 digest/,
  );
  assert.throws(
    () => normalizeMobileCertificate([
      `MOBILE_ADMIN_ANDROID_CERT_SHA256=${FINGERPRINT}`,
      `MOBILE_ADMIN_ANDROID_CERT_SHA256=${FINGERPRINT}`,
    ].join("\n"), FINGERPRINT),
    /defined more than once/,
  );
});
