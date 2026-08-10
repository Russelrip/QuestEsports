const DEFAULT_RUNTIME_DATABASE_PARAMETERS = {
  connection_limit: "5",
  pool_timeout: "10",
  connect_timeout: "10",
};

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_POSTGRES_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

const validatePostgresDatabaseUrl = (name, value, { requireTls = false } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }

  if (requireTls && !LOCAL_DATABASE_HOSTS.has(url.hostname)) {
    const sslMode = String(url.searchParams.get("sslmode") || "").toLowerCase();
    if (!SAFE_POSTGRES_SSL_MODES.has(sslMode)) {
      throw new Error(
        `${name} must explicitly use sslmode=require, verify-ca, or verify-full in production.`,
      );
    }
  }

  return url;
};

const buildRuntimeDatabaseUrl = (value) => {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return value;

    for (const [name, defaultValue] of Object.entries(DEFAULT_RUNTIME_DATABASE_PARAMETERS)) {
      if (!url.searchParams.has(name)) url.searchParams.set(name, defaultValue);
    }

    return url.toString();
  } catch {
    return value;
  }
};

module.exports = {
  DEFAULT_RUNTIME_DATABASE_PARAMETERS,
  buildRuntimeDatabaseUrl,
  validatePostgresDatabaseUrl,
};
