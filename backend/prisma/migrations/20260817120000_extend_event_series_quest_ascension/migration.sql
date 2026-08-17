-- AlterEnum
ALTER TYPE "TeamRegistrationStatus" ADD VALUE 'waitlisted';

-- AlterTable
ALTER TABLE "event_series"
ADD COLUMN "short_name" TEXT,
ADD COLUMN "subtitle" TEXT,
ADD COLUMN "short_description" TEXT,
ADD COLUMN "banner_image_name" TEXT,
ADD COLUMN "start_date" TIMESTAMP(3),
ADD COLUMN "end_date" TIMESTAMP(3),
ADD COLUMN "registration_open_at" TIMESTAMP(3),
ADD COLUMN "registration_close_at" TIMESTAMP(3),
ADD COLUMN "venue" TEXT,
ADD COLUMN "location" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "organizer" TEXT,
ADD COLUMN "website_url" TEXT,
ADD COLUMN "discord_url" TEXT,
ADD COLUMN "registration_status_override" TEXT,
ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tournaments"
ADD COLUMN "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "team_registrations"
ADD COLUMN "waitlist_position" INTEGER,
ADD COLUMN "public_reference" TEXT;

-- CreateIndex
CREATE INDEX "event_series_is_published_featured_display_order_idx"
ON "event_series"("is_published", "featured", "display_order");

CREATE UNIQUE INDEX "team_registrations_public_reference_key"
ON "team_registrations"("public_reference");

CREATE INDEX "team_registrations_tournament_id_status_waitlist_position_idx"
ON "team_registrations"("tournament_id", "status", "waitlist_position");
