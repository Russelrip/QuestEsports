-- CreateEnum
CREATE TYPE "TeamRegistrationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "contact_submissions"
ADD COLUMN "is_read" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team_registrations"
ADD COLUMN "status" "TeamRegistrationStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "contact_submissions_is_read_created_at_idx" ON "contact_submissions"("is_read", "created_at");

-- CreateIndex
CREATE INDEX "team_registrations_status_created_at_idx" ON "team_registrations"("status", "created_at");
