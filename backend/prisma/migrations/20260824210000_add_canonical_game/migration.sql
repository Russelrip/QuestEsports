-- Canonical game identity.
--
-- Before this migration "which game" was stated seven different ways: free-text
-- columns on tournaments, rulebooks, recruitment_applications, saved_teams and
-- three veto catalog tables, plus the game_categories row driving public pages.
-- Nothing tied them together, so a tournament could reference a rulebook for a
-- different title and no constraint objected.
--
-- game_categories already holds the established public slugs (codm, mlbb,
-- pubg-mobile, valorant) with proper display names, so those are adopted as
-- canonical rather than invented afresh.
--
-- The free-text columns do NOT agree with those slugs. "COD Mobile" naively
-- slugifies to `cod-mobile`, which is not `codm` — normalising alone would
-- create a second row for a title that already exists. game_aliases exists to
-- absorb exactly that: every spelling a human has typed resolves to one title.
--
-- This migration is EXPAND only. Every new column is nullable, no existing
-- column is dropped or made NOT NULL, and no read path depends on the new
-- columns yet. Dropping the legacy text columns is the CONTRACT step and
-- belongs in a later release, once reads have moved.
--
-- Every statement is guarded so the migration is safe to re-run.

-- 1. Canonical tables --------------------------------------------------------

CREATE TABLE IF NOT EXISTS "games" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "slug"         TEXT         NOT NULL,
  "display_name" TEXT         NOT NULL,
  "short_name"   TEXT,
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "games_slug_key" ON "games" ("slug");
CREATE INDEX IF NOT EXISTS "games_is_active_idx" ON "games" ("is_active");

-- Every alternative spelling that must resolve to a title. `alias` is stored
-- already-normalised, so lookup is a plain equality match.
CREATE TABLE IF NOT EXISTS "game_aliases" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "alias"      TEXT         NOT NULL,
  "game_id"    UUID         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_aliases_alias_key" ON "game_aliases" ("alias");
CREATE INDEX IF NOT EXISTS "game_aliases_game_id_idx" ON "game_aliases" ("game_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_aliases_game_id_fkey') THEN
    ALTER TABLE "game_aliases"
      ADD CONSTRAINT "game_aliases_game_id_fkey"
      FOREIGN KEY ("game_id") REFERENCES "games"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 2. Adopt the established public slugs as canonical -------------------------

INSERT INTO "games" ("slug", "display_name")
SELECT "slug", "display_name" FROM "game_categories"
WHERE "slug" IS NOT NULL AND btrim("slug") <> ''
ON CONFLICT ("slug") DO NOTHING;

-- `valorant` must exist even on an install with no categories seeded: the
-- GameAccountGame enum already names it, and slug parity with that enum is the
-- guarantee this table is built on.
INSERT INTO "games" ("slug", "display_name", "short_name")
VALUES ('valorant', 'VALORANT', 'VAL')
ON CONFLICT ("slug") DO NOTHING;

UPDATE "games" SET "short_name" = 'VAL' WHERE "slug" = 'valorant' AND "short_name" IS NULL;

-- Free Fire has no game_categories row — it reaches Quest only through
-- recruitment applications — but it is a real title, so it is seeded here
-- rather than left to step 4. Seeding it before the alias block is what lets
-- its alternative spellings resolve; a title created in step 4 comes too late
-- for step 3 to attach aliases to it.
INSERT INTO "games" ("slug", "display_name", "short_name")
VALUES ('free-fire', 'Free Fire', 'FF')
ON CONFLICT ("slug") DO NOTHING;

-- 3. Known spellings ---------------------------------------------------------
-- Seeded rather than inferred: a machine cannot know that "COD Mobile" and
-- "codm" are the same product. Anything not listed here still resolves — it
-- becomes its own title in step 4 and can be merged later by adding an alias.

INSERT INTO "game_aliases" ("alias", "game_id")
SELECT v.alias, g."id"
FROM (VALUES
  ('cod-mobile',            'codm'),
  ('call-of-duty-mobile',   'codm'),
  ('cod',                   'codm'),
  ('codmobile',             'codm'),
  ('mobile-legends',        'mlbb'),
  ('mobile-legends-bang-bang', 'mlbb'),
  ('ml',                    'mlbb'),
  ('pubgm',                 'pubg-mobile'),
  ('pubg',                  'pubg-mobile'),
  ('pubg-mobile-lite',      'pubg-mobile'),
  ('val',                   'valorant'),
  ('riot-valorant',         'valorant'),
  ('garena-free-fire',      'free-fire'),
  ('freefire',              'free-fire'),
  ('ff',                    'free-fire'),
  ('free-fire-max',         'free-fire')
) AS v(alias, target_slug)
JOIN "games" g ON g."slug" = v.target_slug
ON CONFLICT ("alias") DO NOTHING;

-- 4. Any spelling still unaccounted for becomes its own title ----------------
-- Normalisation: lowercase, non-alphanumerics collapsed to one hyphen, hyphens
-- trimmed from both ends. The original text becomes the display name so the
-- admin UI reads no worse after cutover.

WITH observed AS (
  SELECT
    btrim(regexp_replace(lower(btrim(source_value)), '[^a-z0-9]+', '-', 'g'), '-') AS norm,
    max(btrim(source_value))                                                       AS display_name
  FROM (
    SELECT "game" AS source_value FROM "tournaments"              WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "rulebooks"                      WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "recruitment_applications"       WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "saved_teams"                    WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "veto_maps"                      WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "veto_map_pools"                 WHERE "game" IS NOT NULL AND btrim("game") <> ''
    UNION ALL SELECT "game" FROM "veto_rule_presets"              WHERE "game" IS NOT NULL AND btrim("game") <> ''
  ) AS all_values
  GROUP BY 1
)
INSERT INTO "games" ("slug", "display_name")
SELECT o.norm, o.display_name
FROM observed o
WHERE o.norm <> ''
  AND NOT EXISTS (SELECT 1 FROM "games"        g WHERE g."slug"  = o.norm)
  AND NOT EXISTS (SELECT 1 FROM "game_aliases" a WHERE a."alias" = o.norm)
ON CONFLICT ("slug") DO NOTHING;

-- 5. Nullable foreign keys ---------------------------------------------------

ALTER TABLE "tournaments"              ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "rulebooks"                ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "recruitment_applications" ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "saved_teams"              ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "veto_maps"                ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "veto_map_pools"           ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "veto_rule_presets"        ADD COLUMN IF NOT EXISTS "game_id" UUID;
ALTER TABLE "game_categories"          ADD COLUMN IF NOT EXISTS "game_id" UUID;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'tournaments', 'rulebooks', 'recruitment_applications', 'saved_teams',
    'veto_maps', 'veto_map_pools', 'veto_rule_presets', 'game_categories'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = target || '_game_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("game_id") '
        || 'REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE',
        target, target || '_game_id_fkey'
      );
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("game_id")',
                   target || '_game_id_idx', target);
  END LOOP;
END
$$;

-- 6. Resolve every row to its title ------------------------------------------
-- Resolution order is slug first, then alias. Re-runnable: matching rows are
-- rewritten with the same value.

CREATE OR REPLACE FUNCTION pg_temp.resolve_game(raw TEXT)
RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT g."id" FROM "games" g
      WHERE g."slug" = btrim(regexp_replace(lower(btrim(raw)), '[^a-z0-9]+', '-', 'g'), '-')),
    (SELECT a."game_id" FROM "game_aliases" a
      WHERE a."alias" = btrim(regexp_replace(lower(btrim(raw)), '[^a-z0-9]+', '-', 'g'), '-'))
  );
$$;

UPDATE "tournaments"              SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "rulebooks"                SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "recruitment_applications" SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "saved_teams"              SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "veto_maps"                SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "veto_map_pools"           SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';
UPDATE "veto_rule_presets"        SET "game_id" = pg_temp.resolve_game("game") WHERE "game" IS NOT NULL AND btrim("game") <> '';

-- game_categories carries the canonical slug itself, so it joins directly.
UPDATE "game_categories" c SET "game_id" = g."id"
FROM "games" g WHERE g."slug" = c."slug";

-- 7. Supabase hardening -------------------------------------------------------
-- Matching 20260823120000_add_players_and_game_accounts: every new public table
-- has row level security enabled and the Data API roles revoked. Quest reaches
-- these tables only through the Prisma runtime role. These two hold no personal
-- data, but the rule is the rule — scripts/verify-database-security.js fails CI
-- on any public table without RLS, and a catalog table is exactly the kind that
-- gets quietly exempted and then joined to something that does.
ALTER TABLE public."games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."game_aliases" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."games" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."game_aliases" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."games" FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."game_aliases" FROM %I', role_name);
    END IF;
  END LOOP;
END
$migration$;
