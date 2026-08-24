-- Cached ranking projection.
--
-- The VALORANT ranking lives in `valorant-platform-backend`, which owns its own
-- rating engine and ingests from HenrikDev; Quest reads it over a signed
-- service token. This table caches a snapshot so a profile still renders when
-- that service is slow, rate limited, or down — the leaderboard client already
-- compensates for exactly that with its own 60-second snapshot.
--
-- It is a CACHE, never a source of truth. Nothing writes rankings here except
-- the sync, and losing the table costs a refresh, not data.
--
-- Keyed on player_id rather than the PUUID, even though the PUUID is what the
-- join is made on: game_accounts already owns the PUUID -> player mapping, and
-- duplicating it would create a second place for it to be wrong. It also keeps
-- the PUUID out of every profile query, which is the boundary the public
-- projection depends on.
--
-- Additive: no existing table or column is touched, and nothing reads it until
-- the profile does.

-- `id` and `updated_at` carry no database default: Prisma generates both
-- client-side, and a DB-side default is drift that fails `prisma migrate diff`.
CREATE TABLE IF NOT EXISTS "player_rankings" (
  "id"             UUID              NOT NULL,
  "player_id"      UUID              NOT NULL,
  "game"           "GameAccountGame" NOT NULL,
  "position"       INTEGER,
  "elo"            INTEGER,
  "tier"           TEXT,
  "rank_in_tier"   INTEGER,
  "peak_tier"      TEXT,
  "peak_season"    TEXT,
  "last_played_at" TIMESTAMP(3),
  "synced_at"      TIMESTAMP(3)      NOT NULL,
  "created_at"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "player_rankings_pkey" PRIMARY KEY ("id")
);

-- One cached standing per player per title. Without it a failed sync could
-- append a second row and a profile would render whichever came back first.
CREATE UNIQUE INDEX IF NOT EXISTS "player_rankings_player_id_game_key"
  ON "player_rankings" ("player_id", "game");
CREATE INDEX IF NOT EXISTS "player_rankings_game_position_idx"
  ON "player_rankings" ("game", "position");
CREATE INDEX IF NOT EXISTS "player_rankings_synced_at_idx"
  ON "player_rankings" ("synced_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_rankings_player_id_fkey') THEN
    ALTER TABLE "player_rankings"
      ADD CONSTRAINT "player_rankings_player_id_fkey"
      FOREIGN KEY ("player_id") REFERENCES "players"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- A leaderboard position is 1-based. Storing 0 or a negative would render as
  -- "Rank #0", which is worse than showing nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_rankings_position_positive_check') THEN
    ALTER TABLE "player_rankings"
      ADD CONSTRAINT "player_rankings_position_positive_check"
      CHECK ("position" IS NULL OR "position" >= 1);
  END IF;
END
$$;

-- Supabase hardening, matching every other table Quest owns.
ALTER TABLE public."player_rankings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."player_rankings" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."player_rankings" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
