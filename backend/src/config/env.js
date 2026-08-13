require("dotenv").config({
  quiet:
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true",
});

const { validatePostgresDatabaseUrl } = require("../lib/database-url");

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

const optional = (name, fallback = "") =>
  String(process.env[name] || fallback).trim();

const assertHttpsUrl = (name, value, { originOnly = false } = {}) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain URL credentials.`);
  }
  if (originOnly && value !== parsed.origin) {
    throw new Error(
      `${name} must be an origin without a path, query, fragment, or trailing slash.`,
    );
  }
};

const normalizeNodeEnv = (value) => {
  const normalized = String(value || "development")
    .trim()
    .toLowerCase();
  const allowed = new Set(["development", "test", "production"]);

  if (!allowed.has(normalized)) {
    throw new Error(
      `Invalid NODE_ENV value "${value}". Expected development, test, or production.`,
    );
  }

  return normalized;
};

const normalizeTrustProxy = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

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
    `Invalid TRUST_PROXY value "${value}". Expected true, false, or a non-negative integer.`,
  );
};

const normalizeBoolean = (value, fallback = false) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

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

const normalizeIntegerInRange = (name, value, fallback, minimum, maximum) => {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return parsed;
};

const normalizeMaintenanceMessage = (value) => {
  const fallback =
    "We’re carrying out scheduled maintenance. Please try again shortly.";
  const normalized =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ") || fallback;
  if (normalized.length > 240) {
    throw new Error(
      "SITE_MAINTENANCE_MESSAGE must be 240 characters or fewer.",
    );
  }
  return normalized;
};

const env = {
  PORT: normalizePositiveInteger(process.env.PORT, 5001),
  CORS_ORIGINS: normalizeCsv(
    process.env.CORS_ORIGIN || "http://localhost:3000",
  ),
  DATABASE_URL: required("DATABASE_URL"),
  DIRECT_URL: required("DIRECT_URL"),
  CACHE_DRIVER: optional("CACHE_DRIVER", "memory").toLowerCase(),
  CACHE_TTL_SECONDS: normalizePositiveInteger(
    process.env.CACHE_TTL_SECONDS,
    300,
  ),
  CACHE_MAX_ENTRIES: normalizePositiveInteger(
    process.env.CACHE_MAX_ENTRIES,
    1000,
  ),
  CACHE_CONNECTION_TIMEOUT_MS: normalizePositiveInteger(
    process.env.CACHE_CONNECTION_TIMEOUT_MS,
    2000,
  ),
  CACHE_KEY_PREFIX: optional("CACHE_KEY_PREFIX", "quest-esports"),
  API_PROCESS_COUNT: normalizePositiveInteger(process.env.API_PROCESS_COUNT, 1),
  UPSTASH_REDIS_REST_URL: optional("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: optional("UPSTASH_REDIS_REST_TOKEN"),
  VALORANT_INTERNAL_BASE_URL: optional("VALORANT_INTERNAL_BASE_URL").replace(/\/+$/, ""),
  VALORANT_SERVICE_SECRET: optional("VALORANT_SERVICE_SECRET"),
  VALORANT_SERVICE_KEY_ID: optional("VALORANT_SERVICE_KEY_ID"),
  VALORANT_SERVICE_ISSUER: optional("VALORANT_SERVICE_ISSUER", "quest-esports"),
  VALORANT_SERVICE_AUDIENCE: optional("VALORANT_SERVICE_AUDIENCE", "valorant-platform"),
  VALORANT_TIMEOUT_MS: normalizeIntegerInRange(
    "VALORANT_TIMEOUT_MS",
    process.env.VALORANT_TIMEOUT_MS,
    15000,
    1000,
    60000,
  ),
  VALORANT_READ_RETRIES: normalizeIntegerInRange(
    "VALORANT_READ_RETRIES",
    process.env.VALORANT_READ_RETRIES,
    2,
    0,
    5,
  ),
  NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
  LOG_LEVEL: optional("LOG_LEVEL", "info").toLowerCase(),
  SESSION_COOKIE_NAME: required("SESSION_COOKIE_NAME"),
  SESSION_TTL_DAYS: normalizePositiveInteger(process.env.SESSION_TTL_DAYS, 1),
  REMEMBER_ME_SESSION_TTL_DAYS: normalizePositiveInteger(
    process.env.REMEMBER_ME_SESSION_TTL_DAYS,
    30,
  ),
  AUTH_ENCRYPTION_KEY: optional("AUTH_ENCRYPTION_KEY"),
  TRUST_PROXY: normalizeTrustProxy(process.env.TRUST_PROXY),
  REQUIRE_API_ORIGIN: normalizeBoolean(
    process.env.REQUIRE_API_ORIGIN,
    normalizeNodeEnv(process.env.NODE_ENV) === "production",
  ),
  JOB_WORKER_ENABLED: normalizeBoolean(process.env.JOB_WORKER_ENABLED, true),
  COMMERCE_MAINTENANCE_ENABLED: normalizeBoolean(
    process.env.COMMERCE_MAINTENANCE_ENABLED,
    true,
  ),
  SITE_MAINTENANCE_MODE: normalizeBoolean(
    process.env.SITE_MAINTENANCE_MODE,
    false,
  ),
  SITE_MAINTENANCE_MESSAGE: normalizeMaintenanceMessage(
    process.env.SITE_MAINTENANCE_MESSAGE,
  ),
  SITE_MAINTENANCE_RETRY_AFTER_SECONDS: normalizeIntegerInRange(
    "SITE_MAINTENANCE_RETRY_AFTER_SECONDS",
    process.env.SITE_MAINTENANCE_RETRY_AFTER_SECONDS,
    900,
    1,
    86400,
  ),
  JOB_WORKER_POLL_MS: normalizePositiveInteger(
    process.env.JOB_WORKER_POLL_MS,
    5000,
  ),
  JOB_WORKER_MAX_ATTEMPTS: normalizePositiveInteger(
    process.env.JOB_WORKER_MAX_ATTEMPTS,
    5,
  ),
  CHALLONGE_ENABLED: normalizeBoolean(process.env.CHALLONGE_ENABLED, false),
  CHALLONGE_AUTOMATIC_SYNC_ENABLED: normalizeBoolean(
    process.env.CHALLONGE_AUTOMATIC_SYNC_ENABLED,
    false,
  ),
  CHALLONGE_CLIENT_ID: optional("CHALLONGE_CLIENT_ID"),
  CHALLONGE_CLIENT_SECRET: optional("CHALLONGE_CLIENT_SECRET"),
  CHALLONGE_OAUTH_SCOPE: optional(
    "CHALLONGE_OAUTH_SCOPE",
    "application:manage",
  ),
  CHALLONGE_TOKEN_URL: optional(
    "CHALLONGE_TOKEN_URL",
    "https://api.challonge.com/oauth/token",
  ),
  CHALLONGE_BASE_URL: optional(
    "CHALLONGE_BASE_URL",
    "https://api.challonge.com/v2.1",
  ).replace(/\/+$/, ""),
  CHALLONGE_BRACKET_CACHE_SECONDS: normalizeIntegerInRange(
    "CHALLONGE_BRACKET_CACHE_SECONDS",
    process.env.CHALLONGE_BRACKET_CACHE_SECONDS,
    30,
    1,
    300,
  ),
  CHALLONGE_REQUEST_TIMEOUT_MS: normalizeIntegerInRange(
    "CHALLONGE_REQUEST_TIMEOUT_MS",
    process.env.CHALLONGE_REQUEST_TIMEOUT_MS,
    8000,
    1000,
    30000,
  ),
  CHALLONGE_DEFAULT_SYNC_MINUTES: normalizeIntegerInRange(
    "CHALLONGE_DEFAULT_SYNC_MINUTES",
    process.env.CHALLONGE_DEFAULT_SYNC_MINUTES,
    5,
    1,
    60,
  ),
  CHALLONGE_SYNC_LEASE_SECONDS: normalizeIntegerInRange(
    "CHALLONGE_SYNC_LEASE_SECONDS",
    process.env.CHALLONGE_SYNC_LEASE_SECONDS,
    90,
    30,
    600,
  ),
  REALTIME_SSE_ENABLED: normalizeBoolean(
    process.env.REALTIME_SSE_ENABLED,
    false,
  ),
  REALTIME_SSE_MAX_CONNECTIONS: normalizeIntegerInRange(
    "REALTIME_SSE_MAX_CONNECTIONS",
    process.env.REALTIME_SSE_MAX_CONNECTIONS,
    100,
    1,
    10000,
  ),
  REALTIME_SSE_MAX_CONNECTIONS_PER_IP: normalizeIntegerInRange(
    "REALTIME_SSE_MAX_CONNECTIONS_PER_IP",
    process.env.REALTIME_SSE_MAX_CONNECTIONS_PER_IP,
    5,
    1,
    100,
  ),
  MAIL_PROVIDER: optional("MAIL_PROVIDER", "smtp").toLowerCase(),
  RESEND_API_KEY: optional("RESEND_API_KEY"),
  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: normalizePositiveInteger(process.env.SMTP_PORT, 587),
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  MAIL_FROM: optional("MAIL_FROM"),
  MAIL_DELIVERY_REQUIRED: normalizeBoolean(
    process.env.MAIL_DELIVERY_REQUIRED,
    normalizeNodeEnv(process.env.NODE_ENV) === "production",
  ),
  APP_URL: optional("APP_URL"),
  API_PUBLIC_URL: optional("API_PUBLIC_URL"),
  MOBILE_ADMIN_OAUTH_REDIRECT_URL: optional(
    "MOBILE_ADMIN_OAUTH_REDIRECT_URL",
    "questadmin://oauth",
  ),
  MOBILE_ADMIN_ANDROID_CERT_SHA256: optional(
    "MOBILE_ADMIN_ANDROID_CERT_SHA256",
  ),
  UPLOAD_ROOT: optional("UPLOAD_ROOT"),
  PRIVATE_UPLOAD_ROOT: optional("PRIVATE_UPLOAD_ROOT"),
  BANK_TRANSFER_PROOF_RETENTION_DAYS: normalizePositiveInteger(
    process.env.BANK_TRANSFER_PROOF_RETENTION_DAYS,
    365,
  ),
  LOG_DRAIN_URL: optional("LOG_DRAIN_URL"),
  LOG_DRAIN_TOKEN: optional("LOG_DRAIN_TOKEN"),
  MONITORING_WEBHOOK_URL: optional("MONITORING_WEBHOOK_URL"),
  MONITORING_WEBHOOK_TOKEN: optional("MONITORING_WEBHOOK_TOKEN"),
  DISCORD_ALERT_WEBHOOK_URL: optional("DISCORD_ALERT_WEBHOOK_URL"),
  GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
  GOOGLE_CALLBACK_URL: optional("GOOGLE_CALLBACK_URL"),
  DISCORD_CLIENT_ID: optional("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: optional("DISCORD_CLIENT_SECRET"),
  DISCORD_CALLBACK_URL: optional("DISCORD_CALLBACK_URL"),
  PAYHERE_MODE: optional("PAYHERE_MODE", "sandbox").toLowerCase(),
  PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION: normalizeBoolean(
    process.env.PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION,
    false,
  ),
  PAYHERE_MERCHANT_ID: optional("PAYHERE_MERCHANT_ID"),
  PAYHERE_MERCHANT_SECRET: optional("PAYHERE_MERCHANT_SECRET"),
  PAYHERE_NOTIFY_URL: optional("PAYHERE_NOTIFY_URL"),
  SHOP_DELIVERY_FEE_LKR: normalizeNonNegativeInteger(
    process.env.SHOP_DELIVERY_FEE_LKR,
    500,
  ),
  SHOP_ORDER_RESERVATION_MINUTES: normalizePositiveInteger(
    process.env.SHOP_ORDER_RESERVATION_MINUTES,
    30,
  ),
  TICKET_ORDER_RESERVATION_MINUTES: normalizePositiveInteger(
    process.env.TICKET_ORDER_RESERVATION_MINUTES,
    30,
  ),
};

if (env.CORS_ORIGINS.length === 0) {
  throw new Error("CORS_ORIGIN must define at least one allowed origin.");
}

if (!["debug", "info", "warn", "error"].includes(env.LOG_LEVEL)) {
  throw new Error("LOG_LEVEL must be one of: debug, info, warn, error.");
}

if (!["memory", "upstash"].includes(env.CACHE_DRIVER)) {
  throw new Error('CACHE_DRIVER must be either "memory" or "upstash".');
}
if (
  env.CACHE_DRIVER === "upstash" &&
  (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
) {
  throw new Error(
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for the Upstash cache.",
  );
}
if (
  env.NODE_ENV === "production" &&
  env.API_PROCESS_COUNT > 1 &&
  env.CACHE_DRIVER !== "upstash"
) {
  throw new Error(
    "CACHE_DRIVER=upstash is required when API_PROCESS_COUNT is greater than 1.",
  );
}

if (!["sandbox", "live"].includes(env.PAYHERE_MODE)) {
  throw new Error('PAYHERE_MODE must be either "sandbox" or "live".');
}

if (!["resend", "smtp"].includes(env.MAIL_PROVIDER)) {
  throw new Error('MAIL_PROVIDER must be either "resend" or "smtp".');
}

if (env.DISCORD_ALERT_WEBHOOK_URL) {
  let discordWebhookUrl;
  try {
    discordWebhookUrl = new URL(env.DISCORD_ALERT_WEBHOOK_URL);
  } catch {
    throw new Error("DISCORD_ALERT_WEBHOOK_URL must be a valid absolute URL.");
  }
  const allowedDiscordHosts = new Set(["discord.com", "discordapp.com"]);
  if (
    discordWebhookUrl.protocol !== "https:" ||
    !allowedDiscordHosts.has(discordWebhookUrl.hostname) ||
    !/^\/api\/webhooks\/[^/]+\/[^/]+\/?$/.test(discordWebhookUrl.pathname)
  ) {
    throw new Error(
      "DISCORD_ALERT_WEBHOOK_URL must be an HTTPS Discord webhook URL.",
    );
  }
}

if (env.NODE_ENV !== "test" && !env.AUTH_ENCRYPTION_KEY) {
  throw new Error(
    "AUTH_ENCRYPTION_KEY is required outside tests for sensitive-data encryption and OAuth state signing.",
  );
}

if (env.NODE_ENV !== "test" && !env.VALORANT_SERVICE_SECRET) {
  throw new Error(
    "VALORANT_SERVICE_SECRET is required outside tests for VALORANT service-auth signing.",
  );
}

if (env.NODE_ENV !== "test" && !env.VALORANT_SERVICE_KEY_ID) {
  throw new Error(
    "VALORANT_SERVICE_KEY_ID is required outside tests for HMAC key rotation.",
  );
}

if (env.VALORANT_INTERNAL_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(env.VALORANT_INTERNAL_BASE_URL);
  } catch {
    throw new Error("VALORANT_INTERNAL_BASE_URL must be a valid absolute URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("VALORANT_INTERNAL_BASE_URL must not contain URL credentials.");
  }
  if (env.NODE_ENV === "production") {
    assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", env.VALORANT_INTERNAL_BASE_URL);
  }
}

if (
  env.CHALLONGE_ENABLED &&
  (!env.CHALLONGE_CLIENT_ID || !env.CHALLONGE_CLIENT_SECRET)
) {
  throw new Error(
    "CHALLONGE_CLIENT_ID and CHALLONGE_CLIENT_SECRET are required when CHALLONGE_ENABLED is true.",
  );
}

assertHttpsUrl("CHALLONGE_BASE_URL", env.CHALLONGE_BASE_URL);
const challongeBaseUrl = new URL(env.CHALLONGE_BASE_URL);
if (challongeBaseUrl.search || challongeBaseUrl.hash) {
  throw new Error("CHALLONGE_BASE_URL must not contain a query or fragment.");
}
assertHttpsUrl("CHALLONGE_TOKEN_URL", env.CHALLONGE_TOKEN_URL);
const challongeTokenUrl = new URL(env.CHALLONGE_TOKEN_URL);
if (challongeTokenUrl.search || challongeTokenUrl.hash) {
  throw new Error("CHALLONGE_TOKEN_URL must not contain a query or fragment.");
}

if (
  env.AUTH_ENCRYPTION_KEY &&
  !/^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY)
) {
  throw new Error(
    "AUTH_ENCRYPTION_KEY must be a 64-character hexadecimal secret.",
  );
}

if (env.NODE_ENV === "production" && !env.UPLOAD_ROOT) {
  throw new Error(
    "UPLOAD_ROOT is required in production and must point to durable, backed-up storage shared by the API process.",
  );
}

if (env.NODE_ENV === "production") {
  validatePostgresDatabaseUrl("DATABASE_URL", env.DATABASE_URL, {
    requireTls: true,
  });
  validatePostgresDatabaseUrl("DIRECT_URL", env.DIRECT_URL, {
    requireTls: true,
  });
  if (!env.PRIVATE_UPLOAD_ROOT) {
    throw new Error(
      "PRIVATE_UPLOAD_ROOT is required in production for private payment evidence.",
    );
  }
  if (!env.APP_URL || !env.API_PUBLIC_URL) {
    throw new Error("APP_URL and API_PUBLIC_URL are required in production.");
  }
  assertHttpsUrl("APP_URL", env.APP_URL, { originOnly: true });
  assertHttpsUrl("API_PUBLIC_URL", env.API_PUBLIC_URL, { originOnly: true });
  assertHttpsUrl(
    "MOBILE_ADMIN_OAUTH_REDIRECT_URL",
    env.MOBILE_ADMIN_OAUTH_REDIRECT_URL,
  );
  const mobileRedirectUrl = new URL(env.MOBILE_ADMIN_OAUTH_REDIRECT_URL);
  if (
    mobileRedirectUrl.origin !== new URL(env.API_PUBLIC_URL).origin ||
    mobileRedirectUrl.pathname !== "/mobile-admin-oauth" ||
    mobileRedirectUrl.search ||
    mobileRedirectUrl.hash
  ) {
    throw new Error(
      "MOBILE_ADMIN_OAUTH_REDIRECT_URL must be /mobile-admin-oauth on the API_PUBLIC_URL origin.",
    );
  }
  if (!/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(env.MOBILE_ADMIN_ANDROID_CERT_SHA256)) {
    throw new Error(
      "MOBILE_ADMIN_ANDROID_CERT_SHA256 must be the colon-separated SHA-256 signing certificate fingerprint.",
    );
  }
  env.CORS_ORIGINS.forEach((origin) =>
    assertHttpsUrl("CORS_ORIGIN", origin, { originOnly: true }),
  );
  for (const [name, callbackUrl] of [
    ["GOOGLE_CALLBACK_URL", env.GOOGLE_CALLBACK_URL],
    ["DISCORD_CALLBACK_URL", env.DISCORD_CALLBACK_URL],
  ]) {
    if (!callbackUrl) continue;
    assertHttpsUrl(name, callbackUrl);
    if (new URL(callbackUrl).origin !== new URL(env.API_PUBLIC_URL).origin) {
      throw new Error(`${name} must use the API_PUBLIC_URL origin.`);
    }
  }
  if (env.TRUST_PROXY === false) {
    throw new Error(
      "TRUST_PROXY must be configured in production when the API is behind Nginx.",
    );
  }
  if (!env.REQUIRE_API_ORIGIN) {
    throw new Error("REQUIRE_API_ORIGIN must be enabled in production.");
  }
  if (!env.MAIL_DELIVERY_REQUIRED) {
    throw new Error(
      "MAIL_DELIVERY_REQUIRED must be enabled in production while password authentication is available.",
    );
  }
  if (!env.JOB_WORKER_ENABLED) {
    throw new Error(
      "JOB_WORKER_ENABLED must be enabled in production while asynchronous mail delivery is required.",
    );
  }
  for (const [name, endpoint] of [
    ["UPSTASH_REDIS_REST_URL", env.UPSTASH_REDIS_REST_URL],
    ["LOG_DRAIN_URL", env.LOG_DRAIN_URL],
    ["MONITORING_WEBHOOK_URL", env.MONITORING_WEBHOOK_URL],
  ]) {
    if (endpoint) assertHttpsUrl(name, endpoint);
  }
}

const mailProviderCredentialValues =
  env.MAIL_PROVIDER === "resend"
    ? [env.RESEND_API_KEY, env.MAIL_FROM]
    : [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS, env.MAIL_FROM];
const hasAnyMailProviderValue = mailProviderCredentialValues.some(Boolean);
const hasCompleteMailProviderConfiguration =
  mailProviderCredentialValues.every(Boolean) && Boolean(env.APP_URL);
if (hasAnyMailProviderValue && !hasCompleteMailProviderConfiguration) {
  const requiredValues =
    env.MAIL_PROVIDER === "resend"
      ? "RESEND_API_KEY, MAIL_FROM, and APP_URL"
      : "SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, and APP_URL";
  throw new Error(
    `${requiredValues} must be configured together for ${env.MAIL_PROVIDER}.`,
  );
}
if (env.MAIL_DELIVERY_REQUIRED && !hasCompleteMailProviderConfiguration) {
  throw new Error(
    `Complete ${env.MAIL_PROVIDER} mail configuration is required when MAIL_DELIVERY_REQUIRED is enabled.`,
  );
}

const payHereValues = [
  env.PAYHERE_MERCHANT_ID,
  env.PAYHERE_MERCHANT_SECRET,
  env.PAYHERE_NOTIFY_URL,
];
if (payHereValues.some(Boolean) && !payHereValues.every(Boolean)) {
  throw new Error(
    "PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET, and PAYHERE_NOTIFY_URL must be configured together.",
  );
}
if (
  env.NODE_ENV === "production" &&
  payHereValues.every(Boolean) &&
  env.PAYHERE_MODE !== "live" &&
  !env.PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION
) {
  throw new Error(
    "PAYHERE_MODE=live is required for configured production payments. Set PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION=true only for an intentional production-like sandbox.",
  );
}
if (env.NODE_ENV === "production" && env.PAYHERE_NOTIFY_URL) {
  assertHttpsUrl("PAYHERE_NOTIFY_URL", env.PAYHERE_NOTIFY_URL);
}

module.exports = {
  env,
  environmentValidation: {
    assertHttpsUrl,
    normalizeBoolean,
    normalizeCsv,
    normalizeIntegerInRange,
    normalizeMaintenanceMessage,
    normalizeNodeEnv,
    normalizeNonNegativeInteger,
    normalizePositiveInteger,
    normalizeTrustProxy,
    validatePostgresDatabaseUrl,
  },
};
