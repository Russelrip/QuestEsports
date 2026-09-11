const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260910120000_add_support_message_attachments/migration.sql",
);

test("support attachment migration preserves quest_runtime RLS grants and policy posture", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(migration, /GRANT USAGE ON SCHEMA public TO quest_runtime/);
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\."support_message_attachments"\s+TO quest_runtime/,
  );
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\."support_message_attachments" FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\."support_message_attachments" FROM %I/);
  assert.match(migration, /ARRAY\['anon', 'authenticated', 'service_role'\]/);
  assert.match(migration, /DROP POLICY IF EXISTS support_message_attachments_runtime_all\s+ON public\."support_message_attachments"/);
  assert.match(
    migration,
    /CREATE POLICY support_message_attachments_runtime_all\s+ON public\."support_message_attachments"\s+FOR ALL TO quest_runtime\s+USING \(true\)\s+WITH CHECK \(true\)/,
  );
});
