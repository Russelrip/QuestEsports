CREATE TYPE "RecruitmentApplicationStatus" AS ENUM ('pending', 'reviewed', 'accepted', 'rejected');

CREATE TABLE "recruitment_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_type" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "discord" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "applicant_id_number_ciphertext" TEXT NOT NULL,
    "team_name" TEXT,
    "current_roster_size" INTEGER,
    "members" JSONB NOT NULL,
    "notes" TEXT,
    "womens_league_interest" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecruitmentApplicationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruitment_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recruitment_applications_user_id_created_at_idx"
ON "recruitment_applications"("user_id", "created_at");

CREATE INDEX "recruitment_applications_status_created_at_idx"
ON "recruitment_applications"("status", "created_at");

ALTER TABLE "recruitment_applications"
ADD CONSTRAINT "recruitment_applications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
