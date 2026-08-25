-- Structured per-map and per-player scoreboard rows.
--
-- `quest_valorant_matches.roster_summary` is opaque JSON. That is fine for an
-- admin panel rendering one match at a time and wrong for a public page that
-- has to sort by ADR, filter by agent, or aggregate a whole tournament: none of
-- those are expressible against a JSON blob without scanning every row.
--
-- This is the EXPAND half of expand-migrate-contract. `roster_summary` is NOT
-- dropped and stays authoritative until the public read path moves onto these
-- tables; dropping it is a later, separate release.
--
-- These tables also give `duration_ms`, `map_id` and `game_version` a home. The
-- mapper carries all three, but `quest_valorant_matches` has no column for any
-- of them, so today they are read and discarded.
--
-- Nothing is derived and nothing is backfilled. ACS, ADR and HS% are ratios
-- over `red_score + blue_score` and are computed at read time -- storing them
-- would freeze a formula the upstream owns. Existing imports keep only their
-- `roster_summary` until they are re-imported, which is honest: a missing
-- scoreboard means "imported before structured stats", not "played with no
-- stats".

-- `id` and `updated_at` carry no database default: Prisma generates both
-- client-side, and a DB-side default is drift that fails `prisma migrate diff`.
CREATE TABLE IF NOT EXISTS "match_maps" (
  "id"                      UUID         NOT NULL,
  "quest_valorant_match_id" UUID         NOT NULL,
  "series_game_id"          UUID,
  "match_id"                UUID,
  "map_name"                TEXT         NOT NULL,
  "map_external_id"         TEXT,
  "started_at"              TIMESTAMP(3) NOT NULL,
  "duration_ms"             INTEGER,
  "game_version"            TEXT,
  "red_score"               INTEGER,
  "blue_score"              INTEGER,
  "winning_side"            "ValorantGameSide",
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "match_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "match_player_stats" (
  "id"              UUID               NOT NULL,
  "match_map_id"    UUID               NOT NULL,
  "puuid"           TEXT               NOT NULL,
  "player_id"       UUID,
  "display_name"    TEXT,
  "tagline"         TEXT,
  "side"            "ValorantGameSide" NOT NULL,
  "agent_id"        TEXT,
  "agent_name"      TEXT,
  "score_total"     INTEGER,
  "kills"           INTEGER,
  "deaths"          INTEGER,
  "assists"         INTEGER,
  "damage_dealt"    INTEGER,
  "damage_received" INTEGER,
  "headshots"       INTEGER,
  "bodyshots"       INTEGER,
  "legshots"        INTEGER,
  "created_at"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)       NOT NULL,
  CONSTRAINT "match_player_stats_pkey" PRIMARY KEY ("id")
);

-- One structured row per imported map. Re-importing a match must update the
-- scoreboard, never append a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "match_maps_quest_valorant_match_id_key"
  ON "match_maps" ("quest_valorant_match_id");

-- A series game is one map. NULLs do not collide in Postgres, so any number of
-- maps may sit unattached to a series.
CREATE UNIQUE INDEX IF NOT EXISTS "match_maps_series_game_id_key"
  ON "match_maps" ("series_game_id");

CREATE INDEX IF NOT EXISTS "match_maps_match_id_idx" ON "match_maps" ("match_id");
CREATE INDEX IF NOT EXISTS "match_maps_started_at_idx" ON "match_maps" ("started_at");

-- One scoreboard line per player per map.
CREATE UNIQUE INDEX IF NOT EXISTS "match_player_stats_match_map_id_puuid_key"
  ON "match_player_stats" ("match_map_id", "puuid");

CREATE INDEX IF NOT EXISTS "match_player_stats_player_id_idx"
  ON "match_player_stats" ("player_id");

-- The resolution path from a scoreboard row to a Quest profile runs through
-- this column against `game_accounts (game, external_id)`.
CREATE INDEX IF NOT EXISTS "match_player_stats_puuid_idx"
  ON "match_player_stats" ("puuid");

DO $$
BEGIN
  -- The owner. This row is a projection of that import and means nothing
  -- without it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_maps_quest_valorant_match_id_fkey') THEN
    ALTER TABLE "match_maps"
      ADD CONSTRAINT "match_maps_quest_valorant_match_id_fkey"
      FOREIGN KEY ("quest_valorant_match_id") REFERENCES "quest_valorant_matches"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- SET NULL, not CASCADE: detaching a map from a series is admin bookkeeping
  -- and must not delete a scoreboard the public page is rendering.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_maps_series_game_id_fkey') THEN
    ALTER TABLE "match_maps"
      ADD CONSTRAINT "match_maps_series_game_id_fkey"
      FOREIGN KEY ("series_game_id") REFERENCES "quest_valorant_series_games"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- The bracket link. Nothing populates it yet -- nothing joins a discovered
  -- VAL series to a bracket `matches` row -- so this is the column a later
  -- release fills rather than a schema change it has to make.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_maps_match_id_fkey') THEN
    ALTER TABLE "match_maps"
      ADD CONSTRAINT "match_maps_match_id_fkey"
      FOREIGN KEY ("match_id") REFERENCES "matches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_player_stats_match_map_id_fkey') THEN
    ALTER TABLE "match_player_stats"
      ADD CONSTRAINT "match_player_stats_match_map_id_fkey"
      FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- SET NULL: most people on a VALORANT scoreboard are not Quest players, and
  -- deleting a player must not delete the record of a match they played. The
  -- row falls back to its display-name snapshot, which is the pre-identity
  -- state.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_player_stats_player_id_fkey') THEN
    ALTER TABLE "match_player_stats"
      ADD CONSTRAINT "match_player_stats_player_id_fkey"
      FOREIGN KEY ("player_id") REFERENCES "players"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- The PUUID is the join key to `game_accounts`, which stores it normalized
  -- under its own CHECK. If the two disagreed on case or padding the join would
  -- silently miss and a real Quest player would render as an unlinked stranger,
  -- so the same constraint is enforced on both sides.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_player_stats_puuid_normalized') THEN
    ALTER TABLE "match_player_stats"
      ADD CONSTRAINT "match_player_stats_puuid_normalized"
      CHECK ("puuid" = lower(btrim("puuid")) AND length("puuid") > 0);
  END IF;

  -- Round counts are never negative. They are the denominator of ACS and ADR,
  -- so a negative would not merely look wrong, it would invert a ratio.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_maps_scores_non_negative') THEN
    ALTER TABLE "match_maps"
      ADD CONSTRAINT "match_maps_scores_non_negative"
      CHECK (
        ("red_score" IS NULL OR "red_score" >= 0)
        AND ("blue_score" IS NULL OR "blue_score" >= 0)
      );
  END IF;

  -- A map that has not finished has no duration; one that has cannot have run
  -- for a negative length of time.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_maps_duration_non_negative') THEN
    ALTER TABLE "match_maps"
      ADD CONSTRAINT "match_maps_duration_non_negative"
      CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
  END IF;
END
$$;

-- Supabase hardening, matching every other table Quest owns. `match_player_stats`
-- holds PUUIDs, so an exposed Data API role here would leak the identity key the
-- public projection exists to keep private.
ALTER TABLE public."match_maps" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."match_maps" FROM PUBLIC;

ALTER TABLE public."match_player_stats" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."match_player_stats" FROM PUBLIC;

DO $migration$
DECLARE
  role_name  TEXT;
  target     TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['match_maps', 'match_player_stats'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          target,
          role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END
$migration$;
