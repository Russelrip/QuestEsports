require("dotenv").config();

const normalizePositiveInteger = (value, fallback) => {
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

const optional = (name, fallback = "") => String(process.env[name] || fallback).trim();

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

const normalizeTrustProxy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (["true", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "0"].includes(normalized)) {
    return false;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  throw new Error(
    `Invalid TRUST_PROXY value "${value}". Expected true, false, or a non-negative integer.`
  );
};

const env = {
  PORT: normalizePositiveInteger(process.env.PORT, 5001),
  CORS_ORIGINS: normalizeCsv(process.env.CORS_ORIGIN || "http://localhost:3000"),
  DATABASE_URL: required("DATABASE_URL"),
  NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
  SESSION_COOKIE_NAME: required("SESSION_COOKIE_NAME"),
  SESSION_TTL_DAYS: normalizePositiveInteger(process.env.SESSION_TTL_DAYS, 1),
  REMEMBER_ME_SESSION_TTL_DAYS: normalizePositiveInteger(
    process.env.REMEMBER_ME_SESSION_TTL_DAYS,
    30
  ),
  MFA_ISSUER: optional("MFA_ISSUER", "Quest Esports"),
  AUTH_ENCRYPTION_KEY: optional("AUTH_ENCRYPTION_KEY"),
  TRUST_PROXY: normalizeTrustProxy(process.env.TRUST_PROXY),
  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: normalizePositiveInteger(process.env.SMTP_PORT, 587),
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  MAIL_FROM: optional("MAIL_FROM"),
  APP_URL: optional("APP_URL"),
  GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
  GOOGLE_CALLBACK_URL: optional("GOOGLE_CALLBACK_URL"),
  DISCORD_CLIENT_ID: optional("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: optional("DISCORD_CLIENT_SECRET"),
  DISCORD_CALLBACK_URL: optional("DISCORD_CALLBACK_URL"),
};

if (env.CORS_ORIGINS.length === 0) {
  throw new Error("CORS_ORIGIN must define at least one allowed origin.");
}

module.exports = { env };
