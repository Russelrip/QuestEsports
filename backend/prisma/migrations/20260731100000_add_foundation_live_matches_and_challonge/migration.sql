CREATE TYPE "TournamentStaffRole" AS ENUM ('tournament_admin', 'referee');
CREATE TYPE "MatchSource" AS ENUM ('quest', 'challonge');
CREATE TYPE "MatchStatus" AS ENUM (
  'not_scheduled',
  'scheduled',
  'check_in_open',
  'veto_starting_soon',
  'veto_in_progress',
  'ready',
  'live',
  'delayed',
  'paused',
  'completed',
  'cancelled',
  'walkover'
);
CREATE TYPE "ChallongeSyncFrequency" AS ENUM ('manual', 'one_minute', 'five_minutes');
CREATE TYPE "ChallongeSyncStatus" AS ENUM ('running', 'succeeded', 'failed', 'skipped');

CREATE TABLE "tournament_staff_assignments" (
  "id" UUID NOT NULL,
  "tournament_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "TournamentStaffRole" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tournament_staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "matches" (
  "id" UUID NOT NULL,
  "tournament_id" UUID NOT NULL,
  "source" "MatchSource" NOT NULL DEFAULT 'quest',
  "external_id" TEXT,
  "identifier" TEXT,
  "round_number" INTEGER,
  "status" "MatchStatus" NOT NULL DEFAULT 'not_scheduled',
  "scheduled_at" TIMESTAMP(3),
  "estimated_at" TIMESTAMP(3),
  "station" TEXT,
  "check_in_deadline" TIMESTAMP(3),
  "veto_start_at" TIMESTAMP(3),
  "assigned_staff_id" UUID,
  "local_notes" TEXT,
  "score_data" JSONB NOT NULL DEFAULT '{}',
  "winner_slot" INTEGER,
  "completed_at" TIMESTAMP(3),
  "external_updated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "matches_winner_slot_check" CHECK ("winner_slot" IS NULL OR "winner_slot" IN (1, 2))
);

CREATE TABLE "match_participants" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "slot" INTEGER NOT NULL,
  "registration_id" UUID,
  "external_participant_id" TEXT,
  "display_name" TEXT NOT NULL,
  "seed" INTEGER,
  "score" TEXT,
  "result" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "match_participants_slot_check" CHECK ("slot" IN (1, 2))
);

CREATE TABLE "challonge_integrations" (
  "id" UUID NOT NULL,
  "tournament_id" UUID NOT NULL,
  "identifier" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sync_frequency" "ChallongeSyncFrequency" NOT NULL DEFAULT 'five_minutes',
  "snapshot_data" JSONB,
  "snapshot_hash" TEXT,
  "snapshot_updated_at" TIMESTAMP(3),
  "next_sync_at" TIMESTAMP(3),
  "sync_lease_until" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "challonge_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "challonge_participant_links" (
  "id" UUID NOT NULL,
  "integration_id" UUID NOT NULL,
  "external_participant_id" TEXT NOT NULL,
  "registration_id" UUID,
  "display_name" TEXT NOT NULL,
  "seed" INTEGER,
  "is_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "challonge_participant_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "challonge_sync_logs" (
  "id" UUID NOT NULL,
  "integration_id" UUID NOT NULL,
  "status" "ChallongeSyncStatus" NOT NULL,
  "trigger" TEXT NOT NULL,
  "request_id" TEXT,
  "http_status" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "tournament_state" TEXT,
  "participant_count" INTEGER NOT NULL DEFAULT 0,
  "match_count" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "challonge_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "request_id" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_staff_assignments_tournament_id_user_id_role_key"
ON "tournament_staff_assignments"("tournament_id", "user_id", "role");
CREATE INDEX "tournament_staff_assignments_user_id_role_idx"
ON "tournament_staff_assignments"("user_id", "role");
CREATE INDEX "tournament_staff_assignments_tournament_id_role_idx"
ON "tournament_staff_assignments"("tournament_id", "role");

CREATE UNIQUE INDEX "matches_tournament_id_source_external_id_key"
ON "matches"("tournament_id", "source", "external_id");
CREATE INDEX "matches_tournament_id_status_scheduled_at_idx"
ON "matches"("tournament_id", "status", "scheduled_at");
CREATE INDEX "matches_status_scheduled_at_idx" ON "matches"("status", "scheduled_at");
CREATE INDEX "matches_assigned_staff_id_scheduled_at_idx"
ON "matches"("assigned_staff_id", "scheduled_at");
CREATE INDEX "matches_source_external_updated_at_idx"
ON "matches"("source", "external_updated_at");

CREATE UNIQUE INDEX "match_participants_match_id_slot_key"
ON "match_participants"("match_id", "slot");
CREATE INDEX "match_participants_registration_id_idx"
ON "match_participants"("registration_id");
CREATE INDEX "match_participants_external_participant_id_idx"
ON "match_participants"("external_participant_id");

CREATE UNIQUE INDEX "challonge_integrations_tournament_id_key"
ON "challonge_integrations"("tournament_id");
CREATE INDEX "challonge_integrations_enabled_next_sync_at_idx"
ON "challonge_integrations"("enabled", "next_sync_at");
CREATE INDEX "challonge_integrations_sync_lease_until_idx"
ON "challonge_integrations"("sync_lease_until");

CREATE UNIQUE INDEX "challonge_participant_links_integration_id_external_participant_id_key"
ON "challonge_participant_links"("integration_id", "external_participant_id");
CREATE INDEX "challonge_participant_links_registration_id_is_confirmed_idx"
ON "challonge_participant_links"("registration_id", "is_confirmed");

CREATE INDEX "challonge_sync_logs_integration_id_started_at_idx"
ON "challonge_sync_logs"("integration_id", "started_at");
CREATE INDEX "challonge_sync_logs_status_started_at_idx"
ON "challonge_sync_logs"("status", "started_at");

CREATE INDEX "audit_logs_actor_user_id_created_at_idx"
ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx"
ON "audit_logs"("target_type", "target_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx"
ON "audit_logs"("action", "created_at");

ALTER TABLE "tournament_staff_assignments"
ADD CONSTRAINT "tournament_staff_assignments_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_staff_assignments"
ADD CONSTRAINT "tournament_staff_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches"
ADD CONSTRAINT "matches_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches"
ADD CONSTRAINT "matches_assigned_staff_id_fkey"
FOREIGN KEY ("assigned_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "match_participants"
ADD CONSTRAINT "match_participants_match_id_fkey"
FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_participants"
ADD CONSTRAINT "match_participants_registration_id_fkey"
FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "challonge_integrations"
ADD CONSTRAINT "challonge_integrations_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challonge_participant_links"
ADD CONSTRAINT "challonge_participant_links_integration_id_fkey"
FOREIGN KEY ("integration_id") REFERENCES "challonge_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challonge_participant_links"
ADD CONSTRAINT "challonge_participant_links_registration_id_fkey"
FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "challonge_sync_logs"
ADD CONSTRAINT "challonge_sync_logs_integration_id_fkey"
FOREIGN KEY ("integration_id") REFERENCES "challonge_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "challonge_integrations" (
  "id",
  "tournament_id",
  "identifier",
  "enabled",
  "sync_frequency",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  "id",
  CASE
    WHEN split_part(split_part("bracket_link", '://', 2), '/', 1) = 'challonge.com'
      THEN split_part(split_part("bracket_link", '://', 2), '/', 2)
    ELSE split_part(split_part(split_part("bracket_link", '://', 2), '/', 1), '.', 1)
      || '-' || split_part(split_part("bracket_link", '://', 2), '/', 2)
  END,
  false,
  'five_minutes',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tournaments"
WHERE "bracket_link" IS NOT NULL
  AND "bracket_link" ~ '^https://([a-zA-Z0-9-]+\.)?challonge\.com/[a-zA-Z0-9_-]+$';
