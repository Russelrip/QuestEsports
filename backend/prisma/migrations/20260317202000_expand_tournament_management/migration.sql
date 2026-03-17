-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM (
    'draft',
    'upcoming',
    'registration_open',
    'ongoing',
    'completed',
    'cancelled'
);

-- CreateEnum
CREATE TYPE "RegistrationPaymentStatus" AS ENUM ('unpaid', 'pending', 'paid');

-- CreateEnum
CREATE TYPE "RegistrationVerificationStatus" AS ENUM ('pending', 'verified', 'flagged');

-- AlterTable
ALTER TABLE "tournaments"
ADD COLUMN "game" TEXT,
ADD COLUMN "banner_image_name" TEXT,
ADD COLUMN "short_description" TEXT,
ADD COLUMN "full_description" TEXT,
ADD COLUMN "rules" TEXT,
ADD COLUMN "start_date" TIMESTAMP(3),
ADD COLUMN "end_date" TIMESTAMP(3),
ADD COLUMN "registration_deadline" TIMESTAMP(3),
ADD COLUMN "format" TEXT,
ADD COLUMN "team_size" INTEGER,
ADD COLUMN "max_teams" INTEGER,
ADD COLUMN "prize_pool" TEXT,
ADD COLUMN "status" "TournamentStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "bracket_link" TEXT,
ADD COLUMN "contact_link" TEXT,
ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team_registrations"
ADD COLUMN "payment_status" "RegistrationPaymentStatus" NOT NULL DEFAULT 'unpaid',
ADD COLUMN "verification_status" "RegistrationVerificationStatus" NOT NULL DEFAULT 'pending';

UPDATE "tournaments"
SET
    "game" = 'valorant',
    "short_description" = CASE
        WHEN "slug" = 'valorant-women' THEN 'A special tournament created to spotlight women in competitive Valorant and support the local esports scene.'
        WHEN "slug" = 'valorant-showdown' THEN 'A competitive Valorant event featuring open teams, structured brackets, and a strong finals stage.'
        WHEN "slug" = 'quest-masters-open' THEN 'An open-entry Valorant tournament with a polished bracket flow, live coverage, and room for new teams to break through.'
        ELSE CONCAT("title", ' is a Quest Esports tournament.')
    END,
    "full_description" = CASE
        WHEN "slug" = 'valorant-women' THEN 'A special tournament created to spotlight women in competitive Valorant and support the local esports scene.'
        WHEN "slug" = 'valorant-showdown' THEN 'A competitive Valorant event featuring open teams, structured brackets, and a strong finals stage.'
        WHEN "slug" = 'quest-masters-open' THEN 'An open-entry Valorant tournament with a polished bracket flow, live coverage, and room for new teams to break through.'
        ELSE CONCAT("title", ' is a Quest Esports tournament.')
    END,
    "rules" = 'Please follow the official Quest Esports rulebook and all admin instructions.',
    "start_date" = CASE
        WHEN "slug" = 'valorant-women' THEN TIMESTAMP '2025-08-01 12:00:00'
        WHEN "slug" = 'valorant-showdown' THEN TIMESTAMP '2026-02-12 12:00:00'
        WHEN "slug" = 'quest-masters-open' THEN TIMESTAMP '2026-04-15 12:00:00'
        ELSE NOW()
    END,
    "end_date" = CASE
        WHEN "slug" = 'valorant-women' THEN TIMESTAMP '2025-08-03 18:00:00'
        WHEN "slug" = 'valorant-showdown' THEN TIMESTAMP '2026-02-14 18:00:00'
        WHEN "slug" = 'quest-masters-open' THEN TIMESTAMP '2026-04-20 18:00:00'
        ELSE NOW() + INTERVAL '1 day'
    END,
    "registration_deadline" = CASE
        WHEN "slug" = 'valorant-women' THEN TIMESTAMP '2025-07-25 23:59:00'
        WHEN "slug" = 'valorant-showdown' THEN TIMESTAMP '2026-02-05 23:59:00'
        WHEN "slug" = 'quest-masters-open' THEN TIMESTAMP '2026-04-10 23:59:00'
        ELSE NOW()
    END,
    "format" = 'BO3 / 5v5',
    "team_size" = 5,
    "max_teams" = 32,
    "prize_pool" = CASE
        WHEN "slug" = 'valorant-women' THEN 'LKR 50,000'
        WHEN "slug" = 'valorant-showdown' THEN 'LKR 40,000'
        WHEN "slug" = 'quest-masters-open' THEN 'LKR 75,000'
        ELSE 'TBD'
    END,
    "status" = CASE
        WHEN "slug" = 'valorant-women' THEN 'completed'::"TournamentStatus"
        WHEN "slug" = 'valorant-showdown' THEN 'completed'::"TournamentStatus"
        WHEN "slug" = 'quest-masters-open' THEN 'registration_open'::"TournamentStatus"
        ELSE 'draft'::"TournamentStatus"
    END,
    "is_published" = true,
    "is_featured" = CASE WHEN "slug" = 'quest-masters-open' THEN true ELSE false END;

ALTER TABLE "tournaments"
ALTER COLUMN "game" SET NOT NULL,
ALTER COLUMN "short_description" SET NOT NULL,
ALTER COLUMN "full_description" SET NOT NULL,
ALTER COLUMN "start_date" SET NOT NULL,
ALTER COLUMN "end_date" SET NOT NULL,
ALTER COLUMN "registration_deadline" SET NOT NULL,
ALTER COLUMN "format" SET NOT NULL,
ALTER COLUMN "team_size" SET NOT NULL,
ALTER COLUMN "max_teams" SET NOT NULL,
ALTER COLUMN "prize_pool" SET NOT NULL;

CREATE INDEX "tournaments_is_published_status_start_date_idx"
ON "tournaments"("is_published", "status", "start_date");

CREATE INDEX "tournaments_is_featured_is_published_idx"
ON "tournaments"("is_featured", "is_published");

CREATE INDEX "team_registrations_payment_status_verification_status_idx"
ON "team_registrations"("payment_status", "verification_status");
