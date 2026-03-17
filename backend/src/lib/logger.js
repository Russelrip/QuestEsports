const redact = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
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

const writeLog = (level, message, metadata = {}) => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redact(metadata),
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
};

const logger = {
  info: (message, metadata) => writeLog("info", message, metadata),
  warn: (message, metadata) => writeLog("warn", message, metadata),
  error: (message, metadata) => writeLog("error", message, metadata),
};

module.exports = { logger };
