-- Optional player links on the two roster tables.
--
-- Nullable and unbackfilled by design. Roster history is sensitive: every
-- existing `riot_id`, `email`, `discord`, and invite column keeps its value and
-- stays authoritative for rows that predate player identity. Linking is done
-- later, deliberately, and only where identity can be established safely — a
-- probabilistic backfill run inside a migration is exactly how two people get
-- merged into one.
--
-- `TeamRegistration` ownership is deliberately NOT changed. A registration's
-- captain is represented through its captain `registration_members` row, so the
-- link lands there rather than on the aggregate.

-- AlterTable
ALTER TABLE "saved_team_members" ADD COLUMN "player_id" UUID;
ALTER TABLE "registration_members" ADD COLUMN "player_id" UUID;

CREATE INDEX "saved_team_members_player_id_idx" ON "saved_team_members"("player_id");
CREATE INDEX "registration_members_player_id_idx" ON "registration_members"("player_id");

-- AddForeignKey
--
-- SET NULL, not CASCADE: deleting a player must never delete roster history or
-- a historical registration row. The worst case is a roster row that falls back
-- to its legacy free-text identity, which is exactly the pre-migration state.
ALTER TABLE "saved_team_members" ADD CONSTRAINT "saved_team_members_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
