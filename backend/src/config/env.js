const normalizePort = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const env = {
  PORT: normalizePort(process.env.PORT, 5001),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",
  DATABASE_PATH: process.env.DATABASE_PATH || "./data/quest-esports.db",
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  NODE_ENV: process.env.NODE_ENV || "development",
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "quest_session",
  SESSION_TTL_DAYS: normalizePort(process.env.SESSION_TTL_DAYS, 1),
  REMEMBER_ME_SESSION_TTL_DAYS: normalizePort(
    process.env.REMEMBER_ME_SESSION_TTL_DAYS,
    30
  ),
};

module.exports = { env };
