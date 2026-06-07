ALTER TABLE "team_registrations"
ADD COLUMN "saved_team_id" UUID;

ALTER TABLE "registration_members"
ADD COLUMN "user_id" UUID,
ADD COLUMN "invite_status" "TeamMemberInviteStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "invite_token_hash" TEXT,
ADD COLUMN "invite_sent_at" TIMESTAMP(3),
ADD COLUMN "invite_expires_at" TIMESTAMP(3),
ADD COLUMN "invite_responded_at" TIMESTAMP(3);

ALTER TABLE "saved_team_members"
ADD COLUMN "user_id" UUID;

CREATE INDEX "team_registrations_saved_team_id_idx"
ON "team_registrations"("saved_team_id");

CREATE UNIQUE INDEX "registration_members_invite_token_hash_key"
ON "registration_members"("invite_token_hash");

CREATE INDEX "registration_members_user_id_idx"
ON "registration_members"("user_id");

CREATE INDEX "registration_members_invite_status_idx"
ON "registration_members"("invite_status");

CREATE INDEX "registration_members_invite_expires_at_idx"
ON "registration_members"("invite_expires_at");

CREATE INDEX "saved_team_members_user_id_idx"
ON "saved_team_members"("user_id");

ALTER TABLE "team_registrations"
ADD CONSTRAINT "team_registrations_saved_team_id_fkey"
FOREIGN KEY ("saved_team_id") REFERENCES "saved_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registration_members"
ADD CONSTRAINT "registration_members_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "saved_team_members"
ADD CONSTRAINT "saved_team_members_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "saved_team_members" AS member
SET "user_id" = "users"."id"
FROM "users"
WHERE member."invite_status" = 'accepted'
  AND member."email_normalized" = "users"."email_normalized";

UPDATE "team_registrations" AS registration
SET "saved_team_id" = "saved_team"."id"
FROM "saved_teams" AS "saved_team"
JOIN "users" AS captain
  ON captain."id" = "saved_team"."captain_user_id"
WHERE registration."team_name" = "saved_team"."name"
  AND LOWER(TRIM(registration."captain_email")) = captain."email_normalized";

UPDATE "registration_members" AS member
SET "invite_status" = saved_member."invite_status",
    "user_id" = saved_member."user_id",
    "invite_responded_at" = saved_member."invite_responded_at"
FROM "team_registrations" AS registration
JOIN "saved_team_members" AS saved_member
  ON saved_member."team_id" = registration."saved_team_id"
WHERE member."registration_id" = registration."id"
  AND member."role" = saved_member."role"
  AND member."member_order" = saved_member."member_order"
  AND member."email_normalized" = saved_member."email_normalized";

WITH latest_registrations AS (
  SELECT
    registration."id",
    registration."saved_team_id",
    ROW_NUMBER() OVER (
      PARTITION BY registration."saved_team_id"
      ORDER BY registration."created_at" DESC, registration."id" DESC
    ) AS position
  FROM "team_registrations" AS registration
  WHERE registration."saved_team_id" IS NOT NULL
)
UPDATE "registration_members" AS member
SET "invite_token_hash" = saved_member."invite_token_hash",
    "invite_sent_at" = saved_member."invite_sent_at",
    "invite_expires_at" = saved_member."invite_expires_at"
FROM latest_registrations
JOIN "saved_team_members" AS saved_member
  ON saved_member."team_id" = latest_registrations."saved_team_id"
WHERE latest_registrations.position = 1
  AND member."registration_id" = latest_registrations."id"
  AND member."role" = saved_member."role"
  AND member."member_order" = saved_member."member_order"
  AND member."email_normalized" = saved_member."email_normalized";

UPDATE "registration_members" AS member
SET "invite_status" = 'accepted',
    "user_id" = captain."id",
    "invite_responded_at" = COALESCE(member."invite_responded_at", CURRENT_TIMESTAMP),
    "invite_token_hash" = NULL,
    "invite_expires_at" = NULL
FROM "team_registrations" AS registration
JOIN "users" AS captain
  ON LOWER(TRIM(registration."captain_email")) = captain."email_normalized"
WHERE member."registration_id" = registration."id"
  AND member."role" = 'CAPTAIN';

UPDATE "team_registrations" AS registration
SET "verification_status" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "registration_members" AS member
    WHERE member."registration_id" = registration."id"
      AND member."invite_status" = 'declined'
  ) THEN 'flagged'::"RegistrationVerificationStatus"
  WHEN NOT EXISTS (
    SELECT 1
    FROM "registration_members" AS member
    WHERE member."registration_id" = registration."id"
      AND member."invite_status" <> 'accepted'
  ) THEN 'verified'::"RegistrationVerificationStatus"
  ELSE 'pending'::"RegistrationVerificationStatus"
END;
