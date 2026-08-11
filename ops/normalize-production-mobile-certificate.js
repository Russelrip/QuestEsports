const fs = require("node:fs");
const path = require("node:path");

const FINGERPRINT_PATTERN = /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/;
const KEY = "MOBILE_ADMIN_ANDROID_CERT_SHA256";

const normalizeMobileCertificate = (source, expectedFingerprint) => {
  if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("Expected fingerprint must be a colon-separated SHA-256 digest.");
  }

  const expected = expectedFingerprint.toUpperCase();
  let seen = 0;
  let changed = false;
  let normalized = source.replace(
    /^(\s*)(MOBILE_ADMIN_ANDROID_CERT_SHA256)(\s*=\s*)(.*)$/gm,
    (line, indent, key, separator, rawValue) => {
      seen += 1;
      if (seen > 1) throw new Error(`${key} is defined more than once.`);
      const trimmed = rawValue.trim();
      const quote = trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ["\"", "'"].includes(trimmed[0])
        ? trimmed[0]
        : "";
      const current = quote ? trimmed.slice(1, -1) : trimmed;
      if (current.toUpperCase() === expected) return line;
      changed = true;
      return `${indent}${key}${separator}${quote}${expected}${quote}`;
    },
  );

  if (seen === 0) {
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const hadFinalNewline = source.endsWith("\n");
    normalized = `${normalized}${hadFinalNewline ? "" : newline}${KEY}=${expected}${hadFinalNewline ? newline : ""}`;
    changed = true;
  }
  return { changed, source: normalized };
};

const normalizeMobileCertificateFile = (filename, expectedFingerprint) => {
  const resolved = path.resolve(filename);
  const stats = fs.statSync(resolved);
  const result = normalizeMobileCertificate(
    fs.readFileSync(resolved, "utf8"),
    expectedFingerprint,
  );
  if (!result.changed) return false;

  const temporary = `${resolved}.mobile-certificate-repair-${process.pid}`;
  try {
    fs.writeFileSync(temporary, result.source, { encoding: "utf8", mode: stats.mode });
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, stats.mode);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return true;
};

if (require.main === module) {
  const filename = process.argv[2];
  const fingerprint = process.env.EXPECTED_MOBILE_ADMIN_ANDROID_CERT_SHA256;
  if (!filename || !fingerprint) {
    console.error(
      "Usage: EXPECTED_MOBILE_ADMIN_ANDROID_CERT_SHA256=<fingerprint> node normalize-production-mobile-certificate.js <env-file>",
    );
    process.exitCode = 2;
  } else {
    try {
      const changed = normalizeMobileCertificateFile(filename, fingerprint);
      console.log(changed ? "Mobile signing certificate repaired." : "Mobile signing certificate already compliant.");
    } catch (error) {
      console.error(`Mobile signing certificate repair failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { normalizeMobileCertificate, normalizeMobileCertificateFile };
