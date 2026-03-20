CREATE TYPE "TeamMemberInviteStatus" AS ENUM ('pending', 'accepted', 'declined');

ALTER TABLE "registration_members"
ADD COLUMN "email" TEXT,
ADD COLUMN "email_normalized" TEXT;

CREATE INDEX "registration_members_email_normalized_idx"
ON "registration_members"("email_normalized");

CREATE TABLE "saved_teams" (
    "id" UUID NOT NULL,
    "captain_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logo_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_team_members" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "role" "RegistrationMemberRole" NOT NULL,
    "member_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "discord" TEXT,
    "riot_id" TEXT,
    "invite_status" "TeamMemberInviteStatus" NOT NULL DEFAULT 'pending',
    "invite_token_hash" TEXT,
    "invite_sent_at" TIMESTAMP(3),
    "invite_responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_teams_captain_user_id_name_key"
ON "saved_teams"("captain_user_id", "name");

CREATE INDEX "saved_teams_captain_user_id_idx"
ON "saved_teams"("captain_user_id");

CREATE INDEX "saved_teams_created_at_idx"
ON "saved_teams"("created_at");

CREATE UNIQUE INDEX "saved_team_members_invite_token_hash_key"
ON "saved_team_members"("invite_token_hash");

CREATE UNIQUE INDEX "saved_team_members_team_id_role_member_order_key"
ON "saved_team_members"("team_id", "role", "member_order");

CREATE UNIQUE INDEX "saved_team_members_team_id_email_normalized_key"
ON "saved_team_members"("team_id", "email_normalized");

CREATE INDEX "saved_team_members_team_id_idx"
ON "saved_team_members"("team_id");

CREATE INDEX "saved_team_members_email_normalized_idx"
ON "saved_team_members"("email_normalized");

CREATE INDEX "saved_team_members_invite_status_idx"
ON "saved_team_members"("invite_status");

ALTER TABLE "saved_teams"
ADD CONSTRAINT "saved_teams_captain_user_id_fkey"
FOREIGN KEY ("captain_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_team_members"
ADD CONSTRAINT "saved_team_members_team_id_fkey"
FOREIGN KEY ("team_id") REFERENCES "saved_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
