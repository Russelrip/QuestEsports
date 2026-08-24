-- Audit provenance: which surface produced a change, and why.
--
-- audit_logs already records actor, action, target, before, after, request id
-- and IP. That is enough while every write comes from a person in a browser.
-- It stops being enough the moment automation writes: a role granted by a bot
-- acting for an admin and the same role granted by that admin in the dashboard
-- are indistinguishable by actor alone, and they warrant different scrutiny.
--
-- Both columns are nullable with no default and are deliberately NOT
-- backfilled. NULL honestly means "predates provenance tracking", which is a
-- different fact from "came from the web". Defaulting historical rows would
-- assert something that was never established — the same reasoning the roster
-- identity snapshots were left unbackfilled.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditSource') THEN
    CREATE TYPE "AuditSource" AS ENUM ('web', 'admin', 'mobile', 'bot', 'system');
  END IF;
END
$$;

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "source" "AuditSource";
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "reason" TEXT;

CREATE INDEX IF NOT EXISTS "audit_logs_source_created_at_idx"
  ON "audit_logs" ("source", "created_at");
