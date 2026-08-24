-- Layered, versioned rulebooks.
--
-- `rulebooks` held one flat `content` string with no version and no effective
-- date. Two consequences: a tournament resolved to whatever the rulebook says
-- TODAY, so editing a rule mid-season silently rewrote what a completed event
-- ran under; and conduct rules, per-title rules and per-event rules all lived
-- in the same document, so changing one meant editing prose in several places
-- and hoping they agreed.
--
-- This adds the hierarchy (`layer`, `parent_id`) and immutable revisions
-- (`rulebook_versions`), and lets a tournament pin the exact version that
-- governs it.
--
-- EXPAND only. `rulebooks.content` is retained and still authoritative; it is
-- copied into a v1 version rather than moved. No column is dropped or made NOT
-- NULL, and no read path uses the new tables yet. Every statement is guarded so
-- the migration can be re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RulebookLayer') THEN
    CREATE TYPE "RulebookLayer" AS ENUM ('policy', 'game', 'tournament');
  END IF;
END
$$;

ALTER TABLE "rulebooks" ADD COLUMN IF NOT EXISTS "layer" "RulebookLayer" NOT NULL DEFAULT 'game';
ALTER TABLE "rulebooks" ADD COLUMN IF NOT EXISTS "parent_id" UUID;

-- `game` is the honest default for every existing row: `rulebooks` is keyed and
-- indexed on (game, variant), so the table's own shape says "rules for a title,
-- in a variant". Reclassifying a document as `policy` or `tournament` is an
-- editorial decision for staff, not something a migration should guess.

CREATE INDEX IF NOT EXISTS "rulebooks_layer_idx"     ON "rulebooks" ("layer");
CREATE INDEX IF NOT EXISTS "rulebooks_parent_id_idx" ON "rulebooks" ("parent_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rulebooks_parent_id_fkey') THEN
    ALTER TABLE "rulebooks"
      ADD CONSTRAINT "rulebooks_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "rulebooks"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- A document cannot be its own parent. Deeper cycles are prevented in the
-- service, but the one-step case is cheap to enforce here and is the mistake an
-- admin UI actually makes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rulebooks_parent_not_self_check') THEN
    ALTER TABLE "rulebooks"
      ADD CONSTRAINT "rulebooks_parent_not_self_check"
      CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
  END IF;
END
$$;

-- `id` and `updated_at` carry no database default: Prisma generates both
-- client-side, and a DB-side default is drift that fails `prisma migrate diff`.
CREATE TABLE IF NOT EXISTS "rulebook_versions" (
  "id"             UUID         NOT NULL,
  "rulebook_id"    UUID         NOT NULL,
  "version"        INTEGER      NOT NULL,
  "content"        TEXT         NOT NULL,
  "change_summary" TEXT,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "published_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rulebook_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rulebook_versions_rulebook_id_version_key"
  ON "rulebook_versions" ("rulebook_id", "version");
CREATE INDEX IF NOT EXISTS "rulebook_versions_rulebook_id_published_at_idx"
  ON "rulebook_versions" ("rulebook_id", "published_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rulebook_versions_rulebook_id_fkey') THEN
    ALTER TABLE "rulebook_versions"
      ADD CONSTRAINT "rulebook_versions_rulebook_id_fkey"
      FOREIGN KEY ("rulebook_id") REFERENCES "rulebooks"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rulebook_versions_version_positive_check') THEN
    ALTER TABLE "rulebook_versions"
      ADD CONSTRAINT "rulebook_versions_version_positive_check"
      CHECK ("version" >= 1);
  END IF;
END
$$;

-- The tournament's pinned text.
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "rulebook_version_id" UUID;

CREATE INDEX IF NOT EXISTS "tournaments_rulebook_version_id_idx"
  ON "tournaments" ("rulebook_version_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_rulebook_version_id_fkey') THEN
    ALTER TABLE "tournaments"
      ADD CONSTRAINT "tournaments_rulebook_version_id_fkey"
      FOREIGN KEY ("rulebook_version_id") REFERENCES "rulebook_versions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Backfill: every existing rulebook gains a v1 holding its current text.
--
-- This IS backfilled, unlike the roster snapshots, because it asserts nothing
-- new: the text already exists and already governs, so recording it as v1
-- states a fact rather than inventing one. `effective_from` and `published_at`
-- use the rulebook's own created_at, which is the closest honest answer to
-- "since when has this applied" — not now(), which would claim every existing
-- rulebook took effect at migration time.
INSERT INTO "rulebook_versions" ("id", "rulebook_id", "version", "content", "change_summary", "effective_from", "published_at")
SELECT gen_random_uuid(), r."id", 1, r."content", 'Initial version imported from the flat rulebook.', r."created_at", r."created_at"
FROM "rulebooks" r
WHERE NOT EXISTS (
  SELECT 1 FROM "rulebook_versions" v WHERE v."rulebook_id" = r."id" AND v."version" = 1
);

-- Tournaments already pointing at a rulebook pin its v1, so an event that runs
-- today resolves to the same text after the cutover as before it.
UPDATE "tournaments" t
SET "rulebook_version_id" = v."id"
FROM "rulebook_versions" v
WHERE v."rulebook_id" = t."rulebook_id"
  AND v."version" = 1
  AND t."rulebook_id" IS NOT NULL
  AND t."rulebook_version_id" IS NULL;

-- Supabase hardening, matching every other table Quest owns.
ALTER TABLE public."rulebook_versions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."rulebook_versions" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."rulebook_versions" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
