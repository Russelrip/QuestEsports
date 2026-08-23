-- Competitive identity snapshot on the roster row.
--
-- `registration_members` already copies a roster at registration time, but it
-- copies free text: a Riot ID that was typed by a human and checked against
-- nothing. These columns record WHICH game account was actually committed to
-- the tournament, and what it looked like at that moment, so a later rename or
-- account change cannot silently rewrite competitive history.
--
-- Additive and unbackfilled. Historical registrations keep exactly the data
-- they were created with; a NULL snapshot honestly means "this predates
-- identity snapshots", which is different from "no account".

ALTER TABLE "registration_members"
  ADD COLUMN "game_account_id" UUID,
  ADD COLUMN "external_id_snapshot" TEXT,
  ADD COLUMN "username_snapshot" TEXT,
  ADD COLUMN "tag_snapshot" TEXT,
  ADD COLUMN "verification_status_snapshot" "GameAccountVerificationStatus",
  ADD COLUMN "snapshot_at" TIMESTAMP(3);

CREATE INDEX "registration_members_game_account_id_idx"
ON "registration_members"("game_account_id");

-- SET NULL, never CASCADE: the snapshot is the historical record. Deleting a
-- game account must not delete the evidence of what a team registered with.
-- The text snapshot survives the reference on purpose.
ALTER TABLE "registration_members"
ADD CONSTRAINT "registration_members_game_account_id_fkey"
FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
