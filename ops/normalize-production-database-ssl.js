const fs = require("node:fs");
const path = require("node:path");

const DATABASE_KEYS = ["DATABASE_URL", "DIRECT_URL"];
const APPROVED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

const normalizeDatabaseSsl = (source) => {
  const seen = new Set();
  let changed = false;
  const normalized = source.replace(
    /^(\s*)(DATABASE_URL|DIRECT_URL)(\s*=\s*)(.*)$/gm,
    (line, indent, key, separator, rawValue) => {
      if (seen.has(key)) throw new Error(`${key} is defined more than once.`);
      seen.add(key);

      const trimmed = rawValue.trim();
      const quote = trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ["\"", "'"].includes(trimmed[0])
        ? trimmed[0]
        : "";
      const value = quote ? trimmed.slice(1, -1) : trimmed;
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`${key} is not a valid absolute PostgreSQL URL.`);
      }
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error(`${key} must use the postgres or postgresql protocol.`);
      }
      if (APPROVED_SSL_MODES.has(parsed.searchParams.get("sslmode"))) return line;

      parsed.searchParams.set("sslmode", "require");
      changed = true;
      return `${indent}${key}${separator}${quote}${parsed.toString()}${quote}`;
    },
  );

  const missing = DATABASE_KEYS.filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`Missing required database URL entries: ${missing.join(", ")}.`);
  return { changed, source: normalized };
};

const normalizeDatabaseSslFile = (filename) => {
  const resolved = path.resolve(filename);
  const stats = fs.statSync(resolved);
  const result = normalizeDatabaseSsl(fs.readFileSync(resolved, "utf8"));
  if (!result.changed) return false;

  const temporary = `${resolved}.ssl-repair-${process.pid}`;
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
  if (!filename) {
    console.error("Usage: node normalize-production-database-ssl.js <env-file>");
    process.exitCode = 2;
  } else {
    try {
      const changed = normalizeDatabaseSslFile(filename);
      console.log(changed ? "Database TLS mode repaired." : "Database TLS mode already compliant.");
    } catch (error) {
      console.error(`Database TLS repair failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { normalizeDatabaseSsl, normalizeDatabaseSslFile };
