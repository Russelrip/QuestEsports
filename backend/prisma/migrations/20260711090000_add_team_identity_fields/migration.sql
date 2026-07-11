ALTER TABLE "team_registrations"
ADD COLUMN "country" TEXT,
ADD COLUMN "team_tag" TEXT,
ADD COLUMN "organization_requested" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "saved_teams"
ADD COLUMN "country" TEXT,
ADD COLUMN "team_tag" TEXT,
ADD COLUMN "organization_requested" BOOLEAN NOT NULL DEFAULT false;
