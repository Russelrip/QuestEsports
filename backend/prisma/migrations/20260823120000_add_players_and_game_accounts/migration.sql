-- Quest-owned durable player identity and per-title game accounts.
--
-- Additive only. No existing table is altered and nothing is backfilled: the
-- legacy free-text identity columns (`saved_team_members.riot_id`,
-- `registration_members.riot_id`, `team_registrations.captain_riot_id`) keep
-- their values and their meaning. Linking rosters to players is a separate,
-- later migration; backfill is a separate reviewed job that runs only after the
-- duplicate-identity census.

-- CreateEnum
CREATE TYPE "GameAccountGame" AS ENUM ('valorant');

-- CreateEnum
CREATE TYPE "GameAccountVerificationStatus" AS ENUM (
  'resolved',
  'user_confirmed',
  'discord_corroborated',
  'admin_verified',
  'legacy_unverified',
  'revoked'
);

-- CreateEnum
CREATE TYPE "GameAccountStatus" AS ENUM (
  'active',
  'change_requested',
  'locked',
  'replaced',
  'revoked'
);

-- Public player reference (QPID-000001). Sequence-backed so the value is
-- allocated by the database and can never collide under concurrent inserts.
CREATE SEQUENCE "player_public_id_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL DEFAULT ('QPID-' || lpad(nextval('player_public_id_seq')::text, 6, '0')),
    "user_id" UUID,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

ALTER SEQUENCE "player_public_id_seq" OWNED BY "players"."public_id";

CREATE UNIQUE INDEX "players_public_id_key" ON "players"("public_id");
-- One player per Quest account. A player may be unclaimed (`user_id` NULL) so
-- legacy roster rows and LAN guests can exist before anyone signs in.
CREATE UNIQUE INDEX "players_user_id_key" ON "players"("user_id");
CREATE INDEX "players_created_at_idx" ON "players"("created_at");

-- CreateTable
CREATE TABLE "game_accounts" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "game" "GameAccountGame" NOT NULL,
    "external_id" TEXT NOT NULL,
    "username" TEXT,
    "tagline" TEXT,
    "region" TEXT,
    "verification_status" "GameAccountVerificationStatus" NOT NULL DEFAULT 'resolved',
    "status" "GameAccountStatus" NOT NULL DEFAULT 'active',
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_accounts_pkey" PRIMARY KEY ("id")
);

-- The abuse boundary from the identity plan: one Quest player per real game
-- account, enforced by the database rather than by application checks.
CREATE UNIQUE INDEX "game_accounts_game_external_id_key"
ON "game_accounts"("game", "external_id");
CREATE INDEX "game_accounts_player_id_idx" ON "game_accounts"("player_id");
CREATE INDEX "game_accounts_game_status_idx" ON "game_accounts"("game", "status");
CREATE INDEX "game_accounts_verification_status_idx" ON "game_accounts"("verification_status");

-- One ACTIVE account per player per game (partial unique index; Prisma cannot
-- express it). `replaced`/`revoked` rows stay for history without colliding
-- with their successor.
CREATE UNIQUE INDEX "game_accounts_active_player_game_idx"
ON "game_accounts"("player_id", "game")
WHERE status = 'active';

-- The external identifier is the identity key, so it must be stored
-- normalized or uniqueness is only cosmetic. The application normalizes on
-- write; this constraint makes a de-normalized write impossible.
ALTER TABLE "game_accounts"
ADD CONSTRAINT "game_accounts_external_id_normalized"
CHECK ("external_id" = lower(btrim("external_id")) AND length("external_id") > 0);

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Security posture (matches every other public table): RLS on, and no grants
-- to the Supabase Data API roles. Quest reaches these tables only through the
-- Prisma runtime role.
ALTER TABLE public."players" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."game_accounts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."players" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."game_accounts" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE public."player_public_id_seq" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."players" FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."game_accounts" FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public."player_public_id_seq" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
