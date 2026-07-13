CREATE TYPE "TournamentDateStatus" AS ENUM ('scheduled', 'tba', 'tbd');

ALTER TABLE "tournaments"
  ALTER COLUMN "start_date" DROP NOT NULL,
  ALTER COLUMN "end_date" DROP NOT NULL,
  ALTER COLUMN "registration_deadline" DROP NOT NULL,
  ADD COLUMN "start_date_status" "TournamentDateStatus" NOT NULL DEFAULT 'scheduled',
  ADD COLUMN "end_date_status" "TournamentDateStatus" NOT NULL DEFAULT 'scheduled',
  ADD COLUMN "registration_deadline_status" "TournamentDateStatus" NOT NULL DEFAULT 'scheduled';
