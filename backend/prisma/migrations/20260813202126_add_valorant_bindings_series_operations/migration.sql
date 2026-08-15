-- CreateEnum
CREATE TYPE "ValorantBindingStatus" AS ENUM ('active', 'detached');

-- CreateEnum
CREATE TYPE "ValorantSeriesStatus" AS ENUM ('draft', 'finalized', 'orphaned', 'reconciliation_required');

-- CreateEnum
CREATE TYPE "ValorantOperationType" AS ENUM ('team_bind', 'series_create', 'attach_game', 'set_game_order', 'remove_game', 'finalize', 'reconcile');

-- CreateEnum
CREATE TYPE "ValorantOperationStatus" AS ENUM ('pending', 'in_flight', 'succeeded', 'failed', 'reconciliation_required');

-- CreateEnum
CREATE TYPE "ValorantFormat" AS ENUM ('bo1', 'bo3', 'bo5');

-- CreateEnum
CREATE TYPE "ValorantGameSide" AS ENUM ('red', 'blue');

-- CreateTable
CREATE TABLE "valorant_team_bindings" (
    "id" UUID NOT NULL,
    "saved_team_id" UUID,
    "valorant_team_uuid" TEXT NOT NULL,
    "status" "ValorantBindingStatus" NOT NULL DEFAULT 'active',
    "bound_by_user_id" UUID,
    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valorant_team_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_valorant_series" (
    "id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "binding_a_id" UUID NOT NULL,
    "binding_b_id" UUID NOT NULL,
    "format" "ValorantFormat" NOT NULL,
    "played_at" TIMESTAMP(3) NOT NULL,
    "rating_mode_preference" TEXT,
    "status" "ValorantSeriesStatus" NOT NULL DEFAULT 'draft',
    "valorant_series_uuid" TEXT,
    "finalized_by_id" UUID,
    "last_operation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quest_valorant_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_valorant_series_games" (
    "id" UUID NOT NULL,
    "quest_series_id" UUID NOT NULL,
    "game_number" INTEGER NOT NULL,
    "match_id" TEXT NOT NULL,
    "team_a_side" "ValorantGameSide" NOT NULL,
    "team_b_side" "ValorantGameSide" NOT NULL,
    "map_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quest_valorant_series_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_valorant_matches" (
    "id" UUID NOT NULL,
    "match_id" TEXT NOT NULL,
    "henrik_match_id" TEXT NOT NULL,
    "map_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "mode" TEXT,
    "queue" TEXT,
    "red_score" INTEGER,
    "blue_score" INTEGER,
    "winning_side" TEXT,
    "roster_summary" JSONB,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quest_valorant_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_valorant_operations" (
    "id" UUID NOT NULL,
    "operation_id" TEXT NOT NULL,
    "type" "ValorantOperationType" NOT NULL,
    "external_key" TEXT,
    "quest_series_id" UUID,
    "status" "ValorantOperationStatus" NOT NULL DEFAULT 'pending',
    "fastapi_request_id" TEXT,
    "request_body_hash" TEXT,
    "response_code" INTEGER,
    "error_code" TEXT,
    "response_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quest_valorant_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "valorant_team_bindings_saved_team_id_idx" ON "valorant_team_bindings"("saved_team_id");

-- CreateIndex
CREATE INDEX "valorant_team_bindings_valorant_team_uuid_idx" ON "valorant_team_bindings"("valorant_team_uuid");

-- CreateIndex
CREATE INDEX "valorant_team_bindings_status_idx" ON "valorant_team_bindings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_series_external_key_key" ON "quest_valorant_series"("external_key");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_series_last_operation_id_key" ON "quest_valorant_series"("last_operation_id");

-- CreateIndex
CREATE INDEX "quest_valorant_series_binding_a_id_idx" ON "quest_valorant_series"("binding_a_id");

-- CreateIndex
CREATE INDEX "quest_valorant_series_binding_b_id_idx" ON "quest_valorant_series"("binding_b_id");

-- CreateIndex
CREATE INDEX "quest_valorant_series_status_idx" ON "quest_valorant_series"("status");

-- CreateIndex
CREATE INDEX "quest_valorant_series_valorant_series_uuid_idx" ON "quest_valorant_series"("valorant_series_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_series_games_quest_series_id_game_number_key" ON "quest_valorant_series_games"("quest_series_id", "game_number");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_series_games_match_id_key" ON "quest_valorant_series_games"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_matches_match_id_key" ON "quest_valorant_matches"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_matches_henrik_match_id_key" ON "quest_valorant_matches"("henrik_match_id");

-- CreateIndex
CREATE INDEX "quest_valorant_matches_started_at_idx" ON "quest_valorant_matches"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "quest_valorant_operations_operation_id_key" ON "quest_valorant_operations"("operation_id");

-- CreateIndex
CREATE INDEX "quest_valorant_operations_status_idx" ON "quest_valorant_operations"("status");

-- CreateIndex
CREATE INDEX "quest_valorant_operations_quest_series_id_idx" ON "quest_valorant_operations"("quest_series_id");

-- CreateIndex
CREATE INDEX "quest_valorant_operations_type_status_idx" ON "quest_valorant_operations"("type", "status");

-- AddForeignKey
ALTER TABLE "valorant_team_bindings" ADD CONSTRAINT "valorant_team_bindings_saved_team_id_fkey" FOREIGN KEY ("saved_team_id") REFERENCES "saved_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valorant_team_bindings" ADD CONSTRAINT "valorant_team_bindings_bound_by_user_id_fkey" FOREIGN KEY ("bound_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_series" ADD CONSTRAINT "quest_valorant_series_binding_a_id_fkey" FOREIGN KEY ("binding_a_id") REFERENCES "valorant_team_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_series" ADD CONSTRAINT "quest_valorant_series_binding_b_id_fkey" FOREIGN KEY ("binding_b_id") REFERENCES "valorant_team_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_series" ADD CONSTRAINT "quest_valorant_series_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_series" ADD CONSTRAINT "quest_valorant_series_last_operation_id_fkey" FOREIGN KEY ("last_operation_id") REFERENCES "quest_valorant_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_series_games" ADD CONSTRAINT "quest_valorant_series_games_quest_series_id_fkey" FOREIGN KEY ("quest_series_id") REFERENCES "quest_valorant_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_valorant_operations" ADD CONSTRAINT "quest_valorant_operations_quest_series_id_fkey" FOREIGN KEY ("quest_series_id") REFERENCES "quest_valorant_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One ACTIVE binding per SavedTeam (partial unique index; Prisma cannot express it).
CREATE UNIQUE INDEX "valorant_team_bindings_active_saved_team_idx"
ON "valorant_team_bindings"("saved_team_id")
WHERE status = 'active';

-- Bypassed-deletion safety net: a raw DELETE on saved_teams must detach any
-- active binding (the FK SetNull only nulls saved_team_id).
CREATE FUNCTION public.detach_valorant_bindings_on_saved_team_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "valorant_team_bindings"
     SET status = 'detached', detached_at = now()
   WHERE saved_team_id = OLD.id AND status = 'active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_detach_valorant_bindings_on_saved_team_delete
BEFORE DELETE ON "saved_teams"
FOR EACH ROW
EXECUTE FUNCTION public.detach_valorant_bindings_on_saved_team_delete();

ALTER TABLE public."valorant_team_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_series_games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_operations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."valorant_team_bindings",
  public."quest_valorant_series",
  public."quest_valorant_series_games",
  public."quest_valorant_matches",
  public."quest_valorant_operations"
FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."valorant_team_bindings", public."quest_valorant_series", public."quest_valorant_series_games", public."quest_valorant_matches", public."quest_valorant_operations" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
