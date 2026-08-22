const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { environmentValidation } = require("../src/config/env");

const backendRoot = path.join(__dirname, "..");
const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://quest:quest@db.example.com:5432/quest?sslmode=require",
  DIRECT_URL: "postgresql://quest:quest@db.example.com:5432/quest?sslmode=require",
  SESSION_COOKIE_NAME: "quest_session",
  AUTH_ENCRYPTION_KEY: "a".repeat(64),
  UPLOAD_ROOT: "/srv/quest/uploads",
  PRIVATE_UPLOAD_ROOT: "/srv/quest/private",
  APP_URL: "https://quest.example.com",
  API_PUBLIC_URL: "https://api.quest.example.com",
  MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://api.quest.example.com/mobile-admin-oauth",
  MOBILE_ADMIN_ANDROID_CERT_SHA256: Array(32).fill("AA").join(":"),
  CORS_ORIGIN: "https://quest.example.com",
  TRUST_PROXY: "1",
  REQUIRE_API_ORIGIN: "true",
  MAIL_DELIVERY_REQUIRED: "true",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: "resend-test-key",
  MAIL_FROM: "Quest <noreply@quest.example.com>",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_CALLBACK_URL: "",
  DISCORD_CLIENT_ID: "",
  DISCORD_CLIENT_SECRET: "",
  DISCORD_CALLBACK_URL: "",
  PAYHERE_MERCHANT_ID: "",
  PAYHERE_MERCHANT_SECRET: "",
  PAYHERE_NOTIFY_URL: "",
  PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION: "false",
  API_PROCESS_COUNT: "1",
  SITE_MAINTENANCE_MODE: "false",
  SITE_MAINTENANCE_RETRY_AFTER_SECONDS: "900",
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_INTERNAL_BASE_URL: "https://valorant.internal:8443",
};

const loadEnvironment = (overrides) =>
  spawnSync(process.execPath, ["-e", "require('./src/config/env')"], {
    cwd: backendRoot,
    env: { ...productionEnv, ...overrides },
    encoding: "utf8",
  });

const readRealtimeChannel = (overrides) =>
  spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require('./src/config/env').env.REALTIME_PUBSUB_CHANNEL)"],
    {
      cwd: backendRoot,
      env: { ...productionEnv, REALTIME_PUBSUB_CHANNEL: "", ...overrides },
      encoding: "utf8",
    },
  );

test("production environment rejects CORS values that are not exact origins", () => {
  const result = loadEnvironment({ CORS_ORIGIN: "https://quest.example.com/" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an origin without a path, query, fragment, or trailing slash/);
});

test("environment requires the direct migration database URL", () => {
  const result = loadEnvironment({ DIRECT_URL: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required environment variable: DIRECT_URL/);
});

test("production requires explicit TLS for remote database URLs", () => {
  for (const [name, value] of [
    ["DATABASE_URL", "postgresql://quest:quest@db.example.com:5432/quest"],
    ["DIRECT_URL", "postgresql://quest:quest@db.example.com:5432/quest?sslmode=disable"],
  ]) {
    const result = loadEnvironment({ [name]: value });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(`${name} must explicitly use sslmode`));
  }
});

test("production environment rejects insecure OAuth callbacks", () => {
  const result = loadEnvironment({
    GOOGLE_CALLBACK_URL: "http://api.quest.example.com/api/auth/google/callback",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GOOGLE_CALLBACK_URL must use HTTPS/);
});

test("production environment accepts an HTTPS OAuth callback on the API origin", () => {
  const result = loadEnvironment({
    GOOGLE_CALLBACK_URL: "https://api.quest.example.com/api/auth/google/callback",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("production binds the mobile OAuth App Link to the API origin", () => {
  const wrongOrigin = loadEnvironment({
    MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://quest.example.com/mobile-admin-oauth",
  });
  assert.notEqual(wrongOrigin.status, 0);
  assert.match(wrongOrigin.stderr, /must be \/mobile-admin-oauth on the API_PUBLIC_URL origin/);

  const wrongPath = loadEnvironment({
    MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://api.quest.example.com/oauth",
  });
  assert.notEqual(wrongPath.status, 0);
  assert.match(wrongPath.stderr, /must be \/mobile-admin-oauth on the API_PUBLIC_URL origin/);
});

test("production requires a valid Android signing certificate fingerprint", () => {
  const result = loadEnvironment({ MOBILE_ADMIN_ANDROID_CERT_SHA256: "not-a-fingerprint" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /colon-separated SHA-256 signing certificate fingerprint/);
});

test("production rejects process-local caching when multiple API processes are declared", () => {
  const result = loadEnvironment({ API_PROCESS_COUNT: "2", CACHE_DRIVER: "memory" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CACHE_DRIVER=upstash/);
});

test("clustered API processes require shared Upstash realtime configuration", () => {
  const result = loadEnvironment({
    API_PROCESS_COUNT: "2",
    CACHE_DRIVER: "memory",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CACHE_DRIVER=upstash/);
});

test("realtime channel defaults are isolated by deployment environment", () => {
  const staging = readRealtimeChannel({ NODE_ENV: "development" });
  const production = readRealtimeChannel({ NODE_ENV: "production" });

  assert.equal(staging.status, 0, staging.stderr);
  assert.equal(production.status, 0, production.stderr);
  assert.equal(staging.stdout, "quest-realtime-development");
  assert.equal(production.stdout, "quest-realtime-production");
  assert.notEqual(staging.stdout, production.stdout);
});

test("realtime settings reject non-positive limits and reconnect delays", () => {
  for (const name of [
    "REALTIME_PUBSUB_MAX_MESSAGE_BYTES",
    "REALTIME_PUBSUB_RECONNECT_BASE_MS",
    "REALTIME_PUBSUB_RECONNECT_MAX_MS",
  ]) {
    const result = loadEnvironment({ [name]: "0" });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(`${name} must be an integer from 1 to`));
  }
});

test("configured production PayHere requires live mode unless sandbox is explicit", () => {
  const configured = {
    PAYHERE_MERCHANT_ID: "merchant",
    PAYHERE_MERCHANT_SECRET: "secret",
    PAYHERE_NOTIFY_URL: "https://api.quest.example.com/api/payments/payhere/notify",
    PAYHERE_MODE: "sandbox",
  };
  const rejected = loadEnvironment(configured);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PAYHERE_MODE=live/);

  const intentionalSandbox = loadEnvironment({
    ...configured,
    PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION: "true",
  });
  assert.equal(intentionalSandbox.status, 0, intentionalSandbox.stderr);
});

test("environment normalizers cover valid, default, and invalid values", () => {
  assert.equal(environmentValidation.normalizePositiveInteger("5", 1), 5);
  assert.equal(environmentValidation.normalizePositiveInteger("0", 1), 1);
  assert.equal(environmentValidation.normalizeNonNegativeInteger("0", 2), 0);
  assert.equal(environmentValidation.normalizeNonNegativeInteger("-1", 2), 2);
  assert.deepEqual(environmentValidation.normalizeCsv(" one, ,two "), ["one", "two"]);
  assert.equal(environmentValidation.normalizeNodeEnv("PRODUCTION"), "production");
  assert.throws(() => environmentValidation.normalizeNodeEnv("preview"), /Invalid NODE_ENV/);
  assert.equal(environmentValidation.normalizeTrustProxy(""), false);
  assert.equal(environmentValidation.normalizeTrustProxy("true"), true);
  assert.equal(environmentValidation.normalizeTrustProxy("0"), false);
  assert.equal(environmentValidation.normalizeTrustProxy("2"), 2);
  assert.throws(() => environmentValidation.normalizeTrustProxy("proxy"), /Invalid TRUST_PROXY/);
  assert.equal(environmentValidation.normalizeBoolean("", true), true);
  assert.equal(environmentValidation.normalizeBoolean("yes"), true);
  assert.equal(environmentValidation.normalizeBoolean("off", true), false);
  assert.throws(() => environmentValidation.normalizeBoolean("sometimes"), /Invalid boolean/);
  assert.equal(
    environmentValidation.normalizeIntegerInRange("RETRY", "60", 900, 1, 86400),
    60
  );
  assert.equal(
    environmentValidation.normalizeIntegerInRange("RETRY", "", 900, 1, 86400),
    900
  );
  assert.throws(
    () => environmentValidation.normalizeIntegerInRange("RETRY", "0", 900, 1, 86400),
    /integer from 1 to 86400/
  );
  assert.equal(environmentValidation.normalizeMaintenanceMessage("  Back   soon  "), "Back soon");
  assert.throws(
    () => environmentValidation.normalizeMaintenanceMessage("x".repeat(241)),
    /240 characters/
  );
});

test("production requires the asynchronous job worker for required email delivery", () => {
  const result = loadEnvironment({ JOB_WORKER_ENABLED: "false" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JOB_WORKER_ENABLED must be enabled in production/);
});

test("production rejects insecure secret-bearing integration endpoints", () => {
  for (const [name, value] of [
    ["UPSTASH_REDIS_REST_URL", "http://redis.example.com"],
    ["LOG_DRAIN_URL", "http://logs.example.com/ingest"],
    ["MONITORING_WEBHOOK_URL", "http://monitoring.example.com/events"],
  ]) {
    const result = loadEnvironment({ [name]: value });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(`${name} must use HTTPS`));
  }
});

test("Challonge configuration rejects unsafe base URLs and invalid cache durations", () => {
  const insecureBase = loadEnvironment({ CHALLONGE_BASE_URL: "http://api.challonge.com/v2.1" });
  assert.notEqual(insecureBase.status, 0);
  assert.match(insecureBase.stderr, /CHALLONGE_BASE_URL must use HTTPS/);

  const credentialedBase = loadEnvironment({
    CHALLONGE_BASE_URL: "https://user:secret@api.challonge.com/v2.1",
  });
  assert.notEqual(credentialedBase.status, 0);
  assert.match(credentialedBase.stderr, /must not contain URL credentials/);

  const queryBase = loadEnvironment({
    CHALLONGE_BASE_URL: "https://api.challonge.com/v2.1?client_secret=secret",
  });
  assert.notEqual(queryBase.status, 0);
  assert.match(queryBase.stderr, /must not contain a query or fragment/);

  const invalidCache = loadEnvironment({ CHALLONGE_BRACKET_CACHE_SECONDS: "0" });
  assert.notEqual(invalidCache.status, 0);
  assert.match(invalidCache.stderr, /integer from 1 to 300/);
});

test("Challonge v2.1 requires server application credentials and a safe token URL", () => {
  const missingSecret = loadEnvironment({
    CHALLONGE_ENABLED: "true",
    CHALLONGE_CLIENT_ID: "quest-app",
    CHALLONGE_CLIENT_SECRET: "",
  });
  assert.notEqual(missingSecret.status, 0);
  assert.match(missingSecret.stderr, /CHALLONGE_CLIENT_ID and CHALLONGE_CLIENT_SECRET/);

  const insecureTokenUrl = loadEnvironment({
    CHALLONGE_TOKEN_URL: "http://api.challonge.com/oauth/token",
  });
  assert.notEqual(insecureTokenUrl.status, 0);
  assert.match(insecureTokenUrl.stderr, /CHALLONGE_TOKEN_URL must use HTTPS/);

  const queryTokenUrl = loadEnvironment({
    CHALLONGE_TOKEN_URL: "https://api.challonge.com/oauth/token?client_secret=secret",
  });
  assert.notEqual(queryTokenUrl.status, 0);
  assert.match(queryTokenUrl.stderr, /CHALLONGE_TOKEN_URL must not contain a query or fragment/);
});

test("maintenance environment rejects ambiguous switches and invalid retry windows", () => {
  const invalidSwitch = loadEnvironment({ SITE_MAINTENANCE_MODE: "maybe" });
  assert.notEqual(invalidSwitch.status, 0);
  assert.match(invalidSwitch.stderr, /Invalid boolean/);

  const invalidRetry = loadEnvironment({ SITE_MAINTENANCE_RETRY_AFTER_SECONDS: "90 seconds" });
  assert.notEqual(invalidRetry.status, 0);
  assert.match(invalidRetry.stderr, /integer from 1 to 86400/);
});

test("HTTPS URL validation rejects malformed, insecure, credentialed, and non-origin values", () => {
  environmentValidation.assertHttpsUrl("APP_URL", "https://quest.example.com", {
    originOnly: true,
  });
  assert.throws(
    () => environmentValidation.assertHttpsUrl("APP_URL", "not a URL"),
    /valid absolute URL/
  );
  assert.throws(
    () => environmentValidation.assertHttpsUrl("APP_URL", "http://quest.example.com"),
    /must use HTTPS/
  );
  assert.throws(
    () => environmentValidation.assertHttpsUrl("APP_URL", "https://user:pass@quest.example.com"),
    /must not contain URL credentials/
  );
  assert.throws(
    () => environmentValidation.assertHttpsUrl("APP_URL", "https://quest.example.com/path", { originOnly: true }),
    /must be an origin/
  );
});

test("production requires the VALORANT service secret and key id when an internal base URL is set", () => {
  const missingSecret = loadEnvironment({ VALORANT_SERVICE_SECRET: "" });
  assert.notEqual(missingSecret.status, 0);
  assert.match(
    missingSecret.stderr,
    /VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID are required when VALORANT_INTERNAL_BASE_URL is set/,
  );

  const missingKid = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "",
  });
  assert.notEqual(missingKid.status, 0);
  assert.match(
    missingKid.stderr,
    /VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID are required when VALORANT_INTERNAL_BASE_URL is set/,
  );
});

test("production rejects an insecure VALORANT internal base URL", () => {
  const insecure = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "kid-1",
    VALORANT_INTERNAL_BASE_URL: "http://valorant.internal:8000",
  });
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /VALORANT_INTERNAL_BASE_URL must use HTTPS/);
});

test("production accepts a valid HTTPS VALORANT internal base URL", () => {
  const valid = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "kid-1",
    VALORANT_INTERNAL_BASE_URL: "https://valorant.internal:8443",
  });
  assert.equal(valid.status, 0, valid.stderr);
});
