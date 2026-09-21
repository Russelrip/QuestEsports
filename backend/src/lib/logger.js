const { env } = require("../config/env");
const { schedulePostJson } = require("./observability-transport");

const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_QUERY_PARAMETER_PATTERN =
  /([?&][^?&#=\s]*(?:token|code|state)[^?&#=\s]*=)[^&#\s]*/gi;
const SENSITIVE_CAPABILITY_PATH_PATTERNS = [
  /(\/api\/orders\/)[^/?#\s]+/gi,
  /(\/shop\/order\/)[^/?#\s]+/gi,
];

const redactString = (value) => {
  let redacted = String(value)
    .replace(SENSITIVE_QUERY_PARAMETER_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(/(bearer\s+)[^\s,;]+/gi, `$1${REDACTED_VALUE}`);
  for (const pattern of SENSITIVE_CAPABILITY_PATH_PATTERNS) {
    redacted = redacted.replace(pattern, `$1${REDACTED_VALUE}`);
  }
  return redacted;
};

const redact = (value) => {
  if (value instanceof Error) {
    const redactedCode =
      value.code === undefined || value.code === null
        ? undefined
        : typeof value.code === "string"
          ? redactString(value.code)
          : redact(value.code);

    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack),
      ...(redactedCode !== undefined ? { code: redactedCode } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (typeof value === "string") {
    return redactString(value);
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
      normalizedKey.includes("cookie") ||
      normalizedKey === "state" ||
      (normalizedKey.includes("code") && typeof nestedValue === "string")
    ) {
      result[key] = REDACTED_VALUE;
      return result;
    }

    result[key] = redact(nestedValue);
    return result;
  }, {});
};

const isRemoteDiagnosticField = (key) => {
  const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
  return [
    "stack",
    "response",
    "body",
    "rawresponse",
    "rawbody",
    "responsebody",
    "rawresponsebody",
  ].includes(normalizedKey);
};

const isErrorLike = (value) =>
  value instanceof Error ||
  (value &&
    typeof value === "object" &&
    typeof value.message === "string" &&
    ("name" in value || "stack" in value || "code" in value));

const redactRemote = (value) => {
  if (isErrorLike(value)) {
    const result = {};
    if (value.name !== undefined) result.name = redactString(value.name);
    if (value.message !== undefined) {
      result.message = redactString(value.message);
    }
    if (value.code !== undefined && value.code !== null) {
      result.code =
        typeof value.code === "string"
          ? redactString(value.code)
          : redactRemote(value.code);
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === "name" ||
        normalizedKey === "message" ||
        normalizedKey === "code" ||
        isRemoteDiagnosticField(key)
      ) {
        continue;
      }
      result[key] = redactRemote(nestedValue);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map(redactRemote);
  }

  if (typeof value === "string") {
    return redactString(value);
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
      normalizedKey.includes("cookie") ||
      normalizedKey === "state" ||
      (normalizedKey.includes("code") && typeof nestedValue === "string")
    ) {
      result[key] = REDACTED_VALUE;
      return result;
    }

    result[key] = redactRemote(nestedValue);
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

const localWarn = (message, metadata = {}) => {
  writeConsole(
    "warn",
    JSON.stringify({
      level: "warn",
      message,
      timestamp: new Date().toISOString(),
      ...redact(metadata),
    }),
  );
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
      ...redactRemote(payload),
    },
    onError: (error) => {
      localWarn("Failed to ship log entry to remote drain.", { error });
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
  redactRemote,
  sanitizeRemotePayload: redactRemote,
  localWarn,
  logger,
};
