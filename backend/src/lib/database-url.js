const DEFAULT_RUNTIME_DATABASE_PARAMETERS = {
  connection_limit: "5",
  pool_timeout: "10",
  connect_timeout: "10",
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
};
