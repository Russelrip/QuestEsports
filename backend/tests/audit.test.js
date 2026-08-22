const test = require("node:test");
const assert = require("node:assert/strict");

const { recordAuditInTransaction, sanitizeAuditData } = require("../src/lib/audit");

test("audit sanitization removes credentials, capability values, PUUIDs, and private upload contents", () => {
  const sanitized = sanitizeAuditData({
    sessionToken: "session-secret",
    oauthGrant: "grant-secret",
    payhereSignature: "signature-secret",
    encryptedIdCiphertext: "ciphertext",
    puuid: "private-puuid",
    privateUploadContents: Buffer.from("private file"),
    safe: { status: "approved", count: 2 },
  });

  assert.equal(sanitized.sessionToken, "[REDACTED]");
  assert.equal(sanitized.oauthGrant, "[REDACTED]");
  assert.equal(sanitized.payhereSignature, "[REDACTED]");
  assert.equal(sanitized.encryptedIdCiphertext, "[REDACTED]");
  assert.equal(sanitized.puuid, "[REDACTED]");
  assert.equal(sanitized.privateUploadContents, "[REDACTED]");
  assert.deepEqual(sanitized.safe, { status: "approved", count: 2 });
});

test("audit sanitization preserves safe metadata and normalizes dates", () => {
  const createdAt = new Date("2026-08-22T12:00:00.000Z");
  assert.deepEqual(sanitizeAuditData({ createdAt, action: "ticket.checked_in" }), {
    createdAt: createdAt.toISOString(),
    action: "ticket.checked_in",
  });
});

test("transaction audit persistence sanitizes data and normalizes malformed actors", async () => {
  let persisted;
  await recordAuditInTransaction({
    auditLog: {
      create: async ({ data }) => {
        persisted = data;
        return data;
      },
    },
  }, {
    actorUserId: "test-user",
    action: "security.test",
    targetType: "Test",
    targetId: "target-1",
    afterData: { session: "not-persisted", status: "ok" },
  });

  assert.equal(persisted.actorUserId, null);
  assert.deepEqual(persisted.afterData, { session: "[REDACTED]", status: "ok" });
});
