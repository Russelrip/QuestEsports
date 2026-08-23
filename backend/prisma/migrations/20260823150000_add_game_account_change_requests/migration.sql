-- Admin-reviewed replacement of the game account behind a competitive identity.
--
-- This table exists for ONE case: the underlying account is genuinely
-- different. A Riot rename is not that case — the stable identifier is
-- unchanged, so display fields simply refresh with no request and no approval.
-- Conflating the two would either bury admins in rename paperwork or let a real
-- account swap pass as a rename.

-- CreateEnum
CREATE TYPE "GameAccountChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateTable
CREATE TABLE "game_account_change_requests" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "current_account_id" UUID,
    "game" "GameAccountGame" NOT NULL,
    "requested_external_id" TEXT NOT NULL,
    "requested_username" TEXT,
    "requested_tagline" TEXT,
    "requested_region" TEXT,
    "reason" TEXT NOT NULL,
    "status" "GameAccountChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_by_user_id" UUID,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "admin_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_account_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "game_account_change_requests_status_created_at_idx"
ON "game_account_change_requests"("status", "created_at");
CREATE INDEX "game_account_change_requests_player_id_idx"
ON "game_account_change_requests"("player_id");

-- One open request per player per game. Without this a player could queue
-- several replacements and an admin could approve two of them.
CREATE UNIQUE INDEX "game_account_change_requests_open_player_game_idx"
ON "game_account_change_requests"("player_id", "game")
WHERE status = 'pending';

-- The requested identifier is compared against `game_accounts.external_id`, so
-- it has to be stored in the same normalized shape or the comparison is a lie.
ALTER TABLE "game_account_change_requests"
ADD CONSTRAINT "game_account_change_requests_requested_external_id_normalized"
CHECK (
  "requested_external_id" = lower(btrim("requested_external_id"))
  AND length("requested_external_id") > 0
);

-- A reason is mandatory: an unexplained account swap is not reviewable.
ALTER TABLE "game_account_change_requests"
ADD CONSTRAINT "game_account_change_requests_reason_present"
CHECK (length(btrim("reason")) > 0);

-- AddForeignKey
ALTER TABLE "game_account_change_requests" ADD CONSTRAINT "game_account_change_requests_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on the reviewed account and on both actors: a decision record must
-- outlive the rows it references, or the audit trail rots.
ALTER TABLE "game_account_change_requests" ADD CONSTRAINT "game_account_change_requests_current_account_id_fkey"
FOREIGN KEY ("current_account_id") REFERENCES "game_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "game_account_change_requests" ADD CONSTRAINT "game_account_change_requests_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "game_account_change_requests" ADD CONSTRAINT "game_account_change_requests_reviewed_by_user_id_fkey"
FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security posture (matches every other public table).
ALTER TABLE public."game_account_change_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."game_account_change_requests" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."game_account_change_requests" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
