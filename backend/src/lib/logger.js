const { env } = require("../config/env");
const { schedulePostJson } = require("./observability-transport");

const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const redact = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.code ? { code: value.code } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((result, [key, nestedValue]) => {
    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey.includes("password") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("authorization") ||
      normalizedKey.includes("cookie")
    ) {
      result[key] = "[REDACTED]";
      return result;
    }

    result[key] = redact(nestedValue);
    return result;
  }, {});
};

const shouldLog = (level) =>
  LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[env.LOG_LEVEL];

const writeConsole = (level, serialized) => {
  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
};

const buildPayload = (level, message, metadata = {}) => ({
  level,
  message,
  timestamp: new Date().toISOString(),
  service: "quest-esports-backend",
  environment: env.NODE_ENV,
  ...redact(metadata),
});

const shipLog = (payload) => {
  schedulePostJson({
    url: env.LOG_DRAIN_URL,
    token: env.LOG_DRAIN_TOKEN,
    payload: {
      type: "log",
      ...payload,
    },
    onError: (error) => {
      const fallback = JSON.stringify({
        level: "warn",
        message: "Failed to ship log entry to remote drain.",
        timestamp: new Date().toISOString(),
        error: redact(error),
      });
      console.warn(fallback);
    },
  });
};

const writeLog = (level, message, metadata = {}) => {
  if (!shouldLog(level)) {
    return;
  }

  const payload = buildPayload(level, message, metadata);
  const serialized = JSON.stringify(payload);

  writeConsole(level, serialized);
  shipLog(payload);
};

const logger = {
  debug: (message, metadata) => writeLog("debug", message, metadata),
  info: (message, metadata) => writeLog("info", message, metadata),
  warn: (message, metadata) => writeLog("warn", message, metadata),
  error: (message, metadata) => writeLog("error", message, metadata),
};

module.exports = {
  LOG_LEVEL_ORDER,
  redact,
  logger,
};
