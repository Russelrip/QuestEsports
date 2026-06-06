CREATE TYPE "TournamentRegistrationMode" AS ENUM ('open_entry', 'slot_based');

ALTER TABLE "tournaments"
ADD COLUMN "registration_mode" "TournamentRegistrationMode" NOT NULL DEFAULT 'open_entry';

ALTER TABLE "rulebooks"
ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'Standard';

CREATE INDEX "rulebooks_game_variant_idx" ON "rulebooks"("game", "variant");
