const fs = require("node:fs");
const path = require("node:path");

const readSingleEnvValue = (source, key) => {
  const matches = [...source.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "gm"))];
  if (matches.length !== 1) {
    throw new Error(`${key} must be defined exactly once.`);
  }

  const trimmed = matches[0][1].trim();
  const quote = trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ["\"", "'"].includes(trimmed[0])
    ? trimmed[0]
    : "";
  return quote ? trimmed.slice(1, -1) : trimmed;
};

const normalizeMobileOauthRedirect = (source) => {
  const apiPublicUrl = readSingleEnvValue(source, "API_PUBLIC_URL");
  let parsed;
  try {
    parsed = new URL(apiPublicUrl);
  } catch {
    throw new Error("API_PUBLIC_URL is not a valid absolute URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("API_PUBLIC_URL must be an HTTPS origin.");
  }

  const expected = new URL("/mobile-admin-oauth", parsed).toString();
  let seen = 0;
  let changed = false;
  const normalized = source.replace(
    /^(\s*)(MOBILE_ADMIN_OAUTH_REDIRECT_URL)(\s*=\s*)(.*)$/gm,
    (line, indent, key, separator, rawValue) => {
      seen += 1;
      if (seen > 1) throw new Error(`${key} is defined more than once.`);
      const trimmed = rawValue.trim();
      const quote = trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ["\"", "'"].includes(trimmed[0])
        ? trimmed[0]
        : "";
      const current = quote ? trimmed.slice(1, -1) : trimmed;
      if (current === expected) return line;
      changed = true;
      return `${indent}${key}${separator}${quote}${expected}${quote}`;
    },
  );

  if (seen !== 1) {
    throw new Error("MOBILE_ADMIN_OAUTH_REDIRECT_URL must be defined exactly once.");
  }
  return { changed, source: normalized };
};

const normalizeMobileOauthRedirectFile = (filename) => {
  const resolved = path.resolve(filename);
  const stats = fs.statSync(resolved);
  const result = normalizeMobileOauthRedirect(fs.readFileSync(resolved, "utf8"));
  if (!result.changed) return false;

  const temporary = `${resolved}.mobile-oauth-repair-${process.pid}`;
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
    console.error("Usage: node normalize-production-mobile-oauth.js <env-file>");
    process.exitCode = 2;
  } else {
    try {
      const changed = normalizeMobileOauthRedirectFile(filename);
      console.log(changed ? "Mobile OAuth redirect repaired." : "Mobile OAuth redirect already compliant.");
    } catch (error) {
      console.error(`Mobile OAuth redirect repair failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { normalizeMobileOauthRedirect, normalizeMobileOauthRedirectFile };
