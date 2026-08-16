ALTER TABLE "tournaments"
  ADD COLUMN "allow_coach" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coach_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "registration_members"
  ADD COLUMN "phone" TEXT;
