const normalizePort = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const required = (name) => {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const normalizeNodeEnv = (value) => {
  const normalized = String(value || "development").trim().toLowerCase();
  const allowed = new Set(["development", "test", "production"]);

  if (!allowed.has(normalized)) {
    throw new Error(
      `Invalid NODE_ENV value "${value}". Expected development, test, or production.`
    );
  }

  return normalized;
};

const env = {
  PORT: normalizePort(process.env.PORT, 5001),
  CORS_ORIGINS: normalizeCsv(process.env.CORS_ORIGIN || "http://localhost:3000"),
  DATABASE_URL: required("DATABASE_URL"),
  ADMIN_EMAILS: normalizeCsv(process.env.ADMIN_EMAILS).map((email) =>
    email.toLowerCase()
  ),
  NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
  SESSION_COOKIE_NAME: required("SESSION_COOKIE_NAME"),
  SESSION_TTL_DAYS: normalizePort(process.env.SESSION_TTL_DAYS, 1),
  REMEMBER_ME_SESSION_TTL_DAYS: normalizePort(
    process.env.REMEMBER_ME_SESSION_TTL_DAYS,
    30
  ),
};

if (env.CORS_ORIGINS.length === 0) {
  throw new Error("CORS_ORIGIN must define at least one allowed origin.");
}

module.exports = { env };
