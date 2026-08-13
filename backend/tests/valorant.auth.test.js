const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const authPath = path.join(__dirname, "../src/modules/valorant/valorant.auth.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const envMock = { env: {
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
} };

const decodePart = (token, index) =>
  JSON.parse(Buffer.from(token.split(".")[index], "base64url").toString("utf8"));

test("signServiceToken produces a signed JWT with the expected claims", () => {
  const { module: auth, restore } = loadModuleWithMocks(authPath, { [envPath]: envMock });
  try {
    const now = 1_700_000_000_000;
    const token = auth.signServiceToken({
      actorUserId: "user-1",
      operationId: "op-1",
      now,
      ttlSeconds: 300,
    });

    const [header, payload, signature] = token.split(".");
    assert.deepEqual(decodePart(token, 0), { alg: "HS256", typ: "JWT", kid: "kid-1" });
    assert.deepEqual(decodePart(token, 1), {
      iss: "quest-esports",
      aud: "valorant-platform",
      sub: "user-1",
      operation_id: "op-1",
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000) - 30,
      exp: Math.floor(now / 1000) + 300,
    });

    const expectedSignature = crypto
      .createHmac("sha256", "x".repeat(64))
      .update(`${header}.${payload}`)
      .digest("base64url");
    assert.equal(signature, expectedSignature);
  } finally {
    restore();
  }
});

test("buildServiceAuthHeaders attaches the bearer, operation id, and idempotency key", () => {
  const { module: auth, restore } = loadModuleWithMocks(authPath, { [envPath]: envMock });
  try {
    const headers = auth.buildServiceAuthHeaders({
      actorUserId: "user-1",
      operationId: "op-1",
      externalKey: "external-key-1",
    });
    assert.match(headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(headers["X-Quest-Operation-Id"], "op-1");
    assert.equal(headers["Idempotency-Key"], "external-key-1");

    const withoutKey = auth.buildServiceAuthHeaders({ actorUserId: "user-1", operationId: "op-2" });
    assert.equal("Idempotency-Key" in withoutKey, false);
    assert.equal(withoutKey["X-Quest-Operation-Id"], "op-2");
  } finally {
    restore();
  }
});
