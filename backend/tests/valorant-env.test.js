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
  // The local backend/.env defines VALORANT_* values for dev. The child
  // processes inherit this test runner's dotenv-loaded process.env, so pin
  // these to empty to test the fail-fast rules deterministically.
  VALORANT_INTERNAL_BASE_URL: "",
  VALORANT_SERVICE_SECRET: "",
  VALORANT_SERVICE_KEY_ID: "",
};

const loadEnvironment = (overrides) =>
  spawnSync(process.execPath, ["-e", "require('./src/config/env')"], {
    cwd: backendRoot,
    env: { ...productionEnv, ...overrides },
    encoding: "utf8",
  });

test("VALORANT internal base URL requires the service secret and key id", () => {
  const result = loadEnvironment({ VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000" });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID are required/,
  );
});

test("VALORANT internal base URL must be an HTTPS origin in production", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "http://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use HTTPS in production/);
});

test("complete VALORANT configuration is accepted", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
  });
  assert.equal(result.status, 0);
});

test("VALORANT_READ_RETRIES is bounded to 0..5", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
    VALORANT_READ_RETRIES: "99",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an integer from 0 to 5/);
});

test("VALORANT_INTERNAL_BASE_URL is validated by the exported helper", () => {
  assert.throws(() =>
    environmentValidation.assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", "http://localhost:8000", {
      originOnly: true,
    }),
  );
  assert.doesNotThrow(() =>
    environmentValidation.assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", "https://val.internal:8000", {
      originOnly: true,
    }),
  );
});
