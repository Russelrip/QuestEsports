const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { environmentValidation } = require("../src/config/env");

const backendRoot = path.join(__dirname, "..");
const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://quest:quest@db.example.com:5432/quest",
  SESSION_COOKIE_NAME: "quest_session",
  AUTH_ENCRYPTION_KEY: "a".repeat(64),
  UPLOAD_ROOT: "/srv/quest/uploads",
  PRIVATE_UPLOAD_ROOT: "/srv/quest/private",
  APP_URL: "https://quest.example.com",
  API_PUBLIC_URL: "https://api.quest.example.com",
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
};

const loadEnvironment = (overrides) =>
  spawnSync(process.execPath, ["-e", "require('./src/config/env')"], {
    cwd: backendRoot,
    env: { ...productionEnv, ...overrides },
    encoding: "utf8",
  });

test("production environment rejects CORS values that are not exact origins", () => {
  const result = loadEnvironment({ CORS_ORIGIN: "https://quest.example.com/" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an origin without a path, query, fragment, or trailing slash/);
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

test("production rejects process-local caching when multiple API processes are declared", () => {
  const result = loadEnvironment({ API_PROCESS_COUNT: "2", CACHE_DRIVER: "memory" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CACHE_DRIVER=upstash/);
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
