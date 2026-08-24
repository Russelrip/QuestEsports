const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const auditPath = path.join(__dirname, "../src/lib/audit.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260824230000_add_audit_source_and_reason/migration.sql",
);

const loadAudit = () => {
  const created = [];
  const prisma = { auditLog: { create: async ({ data }) => { created.push(data); return data; } } };
  const { module: audit, restore } = loadModuleWithMocks(auditPath, {
    [prismaModulePath]: { prisma },
  });
  return { audit, created, restore };
};

test("audit source is derived only from what the request proves", () => {
  const { audit, restore } = loadAudit();
  try {
    assert.equal(audit.requestAuditSource({ originalUrl: "/api/admin/users" }), "admin");
    assert.equal(audit.requestAuditSource({ originalUrl: "/api/tournaments" }), "web");
    assert.equal(audit.requestAuditSource({ originalUrl: "/api/admin" }), "admin");
    assert.equal(audit.requestAuditSource({}), "web");
    // A service token is automation regardless of the route it called.
    assert.equal(
      audit.requestAuditSource({ originalUrl: "/api/admin/x", serviceToken: {} }),
      "bot",
    );
  } finally {
    restore();
  }
});

// `mobile` must never be guessed: the Android client calls the same admin
// routes as the web dashboard and announces nothing that separates them.
test("mobile is never inferred from a user agent", () => {
  const { audit, restore } = loadAudit();
  try {
    assert.equal(
      audit.requestAuditSource({
        originalUrl: "/api/admin/tournaments",
        headers: { "user-agent": "okhttp/4.12 Android Expo" },
      }),
      "admin",
    );
  } finally {
    restore();
  }
});

test("recordAudit persists source and reason", async () => {
  const { audit, created, restore } = loadAudit();
  try {
    await audit.recordAudit({
      action: "discord.role.granted",
      targetType: "Player",
      targetId: "player-1",
      source: "bot",
      reason: "Tournament roster approved",
    });
    assert.equal(created[0].source, "bot");
    assert.equal(created[0].reason, "Tournament roster approved");
  } finally {
    restore();
  }
});

test("an unrecognised source is stored as NULL rather than guessed", async () => {
  const { audit, created, restore } = loadAudit();
  try {
    await audit.recordAudit({ action: "a", targetType: "T", source: "telepathy" });
    await audit.recordAudit({ action: "a", targetType: "T" });
    assert.equal(created[0].source, null);
    assert.equal(created[1].source, null);
  } finally {
    restore();
  }
});

test("reason is trimmed, emptied to NULL, and capped", async () => {
  const { audit, created, restore } = loadAudit();
  try {
    await audit.recordAudit({ action: "a", targetType: "T", reason: "   spaced   " });
    await audit.recordAudit({ action: "a", targetType: "T", reason: "   " });
    await audit.recordAudit({ action: "a", targetType: "T", reason: null });
    await audit.recordAudit({ action: "a", targetType: "T", reason: "x".repeat(900) });
    assert.equal(created[0].reason, "spaced");
    assert.equal(created[1].reason, null);
    assert.equal(created[2].reason, null);
    assert.equal(created[3].reason.length, 500);
  } finally {
    restore();
  }
});

test("existing audit callers keep working without the new fields", async () => {
  const { audit, created, restore } = loadAudit();
  try {
    await audit.recordAudit({
      actorUserId: "not-a-uuid",
      action: "admin.user.updated",
      targetType: "User",
      targetId: "user-1",
    });
    assert.equal(created[0].action, "admin.user.updated");
    assert.equal(created[0].actorUserId, null);
    assert.equal(created[0].source, null);
    assert.equal(created[0].reason, null);
  } finally {
    restore();
  }
});

test("migration is additive and leaves history honestly NULL", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "source"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "reason"/);
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
  assert.doesNotMatch(sql, /SET\s+NOT\s+NULL/i);
  // No default and no backfill: NULL must keep meaning "predates tracking".
  assert.doesNotMatch(sql, /UPDATE "audit_logs"/i);
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS "source" "AuditSource" (NOT NULL|DEFAULT)/i);
});
