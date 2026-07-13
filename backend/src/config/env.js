require("dotenv").config();

const normalizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeNonNegativeInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

const assertHttpsUrl = (name, value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
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

const normalizeBoolean = (value, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}".`);
};

const env = {
  PORT: normalizePositiveInteger(process.env.PORT, 5001),
  CORS_ORIGINS: normalizeCsv(process.env.CORS_ORIGIN || "http://localhost:3000"),
  DATABASE_URL: required("DATABASE_URL"),
  NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
  LOG_LEVEL: optional("LOG_LEVEL", "info").toLowerCase(),
  SESSION_COOKIE_NAME: required("SESSION_COOKIE_NAME"),
  SESSION_TTL_DAYS: normalizePositiveInteger(process.env.SESSION_TTL_DAYS, 1),
  REMEMBER_ME_SESSION_TTL_DAYS: normalizePositiveInteger(
    process.env.REMEMBER_ME_SESSION_TTL_DAYS,
    30
  ),
  MFA_ISSUER: optional("MFA_ISSUER", "Quest E-sports"),
  AUTH_ENCRYPTION_KEY: optional("AUTH_ENCRYPTION_KEY"),
  TRUST_PROXY: normalizeTrustProxy(process.env.TRUST_PROXY),
  REQUIRE_API_ORIGIN: normalizeBoolean(
    process.env.REQUIRE_API_ORIGIN,
    normalizeNodeEnv(process.env.NODE_ENV) === "production"
  ),
  JOB_WORKER_ENABLED: normalizeBoolean(process.env.JOB_WORKER_ENABLED, true),
  COMMERCE_MAINTENANCE_ENABLED: normalizeBoolean(
    process.env.COMMERCE_MAINTENANCE_ENABLED,
    true
  ),
  JOB_WORKER_POLL_MS: normalizePositiveInteger(process.env.JOB_WORKER_POLL_MS, 5000),
  JOB_WORKER_MAX_ATTEMPTS: normalizePositiveInteger(
    process.env.JOB_WORKER_MAX_ATTEMPTS,
    5
  ),
  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: normalizePositiveInteger(process.env.SMTP_PORT, 587),
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  MAIL_FROM: optional("MAIL_FROM"),
  MAIL_DELIVERY_REQUIRED: normalizeBoolean(
    process.env.MAIL_DELIVERY_REQUIRED,
    normalizeNodeEnv(process.env.NODE_ENV) === "production"
  ),
  APP_URL: optional("APP_URL"),
  API_PUBLIC_URL: optional("API_PUBLIC_URL"),
  UPLOAD_ROOT: optional("UPLOAD_ROOT"),
  PRIVATE_UPLOAD_ROOT: optional("PRIVATE_UPLOAD_ROOT"),
  PAYMENT_PROOF_PDF_ENABLED: normalizeBoolean(
    process.env.PAYMENT_PROOF_PDF_ENABLED,
    false
  ),
  BANK_TRANSFER_PROOF_RETENTION_DAYS: normalizePositiveInteger(
    process.env.BANK_TRANSFER_PROOF_RETENTION_DAYS,
    365
  ),
  LOG_DRAIN_URL: optional("LOG_DRAIN_URL"),
  LOG_DRAIN_TOKEN: optional("LOG_DRAIN_TOKEN"),
  MONITORING_WEBHOOK_URL: optional("MONITORING_WEBHOOK_URL"),
  MONITORING_WEBHOOK_TOKEN: optional("MONITORING_WEBHOOK_TOKEN"),
  GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
  GOOGLE_CALLBACK_URL: optional("GOOGLE_CALLBACK_URL"),
  DISCORD_CLIENT_ID: optional("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: optional("DISCORD_CLIENT_SECRET"),
  DISCORD_CALLBACK_URL: optional("DISCORD_CALLBACK_URL"),
  PAYHERE_MODE: optional("PAYHERE_MODE", "sandbox").toLowerCase(),
  PAYHERE_MERCHANT_ID: optional("PAYHERE_MERCHANT_ID"),
  PAYHERE_MERCHANT_SECRET: optional("PAYHERE_MERCHANT_SECRET"),
  PAYHERE_NOTIFY_URL: optional("PAYHERE_NOTIFY_URL"),
  SHOP_DELIVERY_FEE_LKR: normalizeNonNegativeInteger(
    process.env.SHOP_DELIVERY_FEE_LKR,
    500
  ),
  SHOP_ORDER_RESERVATION_MINUTES: normalizePositiveInteger(
    process.env.SHOP_ORDER_RESERVATION_MINUTES,
    30
  ),
};

if (env.CORS_ORIGINS.length === 0) {
  throw new Error("CORS_ORIGIN must define at least one allowed origin.");
}

if (!["debug", "info", "warn", "error"].includes(env.LOG_LEVEL)) {
  throw new Error('LOG_LEVEL must be one of: debug, info, warn, error.');
}

if (!["sandbox", "live"].includes(env.PAYHERE_MODE)) {
  throw new Error('PAYHERE_MODE must be either "sandbox" or "live".');
}

if (env.NODE_ENV === "production" && !env.AUTH_ENCRYPTION_KEY) {
  throw new Error(
    "AUTH_ENCRYPTION_KEY is required in production for MFA secret encryption and OAuth state signing."
  );
}

if (
  env.NODE_ENV === "production" &&
  !/^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY)
) {
  throw new Error("AUTH_ENCRYPTION_KEY must be a 64-character hexadecimal secret in production.");
}

if (env.NODE_ENV === "production" && !env.UPLOAD_ROOT) {
  throw new Error(
    "UPLOAD_ROOT is required in production and must point to durable, backed-up storage shared by the API process."
  );
}


if (env.NODE_ENV === "production") {
  if (!env.PRIVATE_UPLOAD_ROOT) {
    throw new Error("PRIVATE_UPLOAD_ROOT is required in production for private payment evidence.");
  }
  if (!env.APP_URL || !env.API_PUBLIC_URL) {
    throw new Error("APP_URL and API_PUBLIC_URL are required in production.");
  }
  assertHttpsUrl("APP_URL", env.APP_URL);
  assertHttpsUrl("API_PUBLIC_URL", env.API_PUBLIC_URL);
  env.CORS_ORIGINS.forEach((origin) => assertHttpsUrl("CORS_ORIGIN", origin));
  if (env.TRUST_PROXY === false) {
    throw new Error("TRUST_PROXY must be configured in production when the API is behind Nginx.");
  }
  if (!env.REQUIRE_API_ORIGIN) {
    throw new Error("REQUIRE_API_ORIGIN must be enabled in production.");
  }
  if (!env.MAIL_DELIVERY_REQUIRED) {
    throw new Error("MAIL_DELIVERY_REQUIRED must be enabled in production while password authentication is available.");
  }
}

const smtpValues = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS, env.MAIL_FROM];
const hasAnySmtpValue = smtpValues.some(Boolean);
const hasCompleteSmtpConfiguration = smtpValues.every(Boolean);
if (hasAnySmtpValue && !hasCompleteSmtpConfiguration) {
  throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM must be configured together.");
}
if (env.MAIL_DELIVERY_REQUIRED && !hasCompleteSmtpConfiguration) {
  throw new Error("SMTP configuration is required when MAIL_DELIVERY_REQUIRED is enabled.");
}

const payHereValues = [
  env.PAYHERE_MERCHANT_ID,
  env.PAYHERE_MERCHANT_SECRET,
  env.PAYHERE_NOTIFY_URL,
];
if (payHereValues.some(Boolean) && !payHereValues.every(Boolean)) {
  throw new Error("PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET, and PAYHERE_NOTIFY_URL must be configured together.");
}
if (env.NODE_ENV === "production" && env.PAYHERE_NOTIFY_URL) {
  assertHttpsUrl("PAYHERE_NOTIFY_URL", env.PAYHERE_NOTIFY_URL);
}

module.exports = { env };
