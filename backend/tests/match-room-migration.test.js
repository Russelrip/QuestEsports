const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20260814183000_add_match_rooms_and_notifications/migration.sql"), "utf8");

test("match-room migration is additive and protects every private table", () => {
  for (const table of ["match_rooms", "match_room_members", "match_room_messages", "match_support_requests", "match_support_messages", "notifications", "notification_recipients", "web_push_subscriptions", "user_notification_preferences"]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
