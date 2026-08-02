ALTER TABLE "challonge_integrations"
ADD COLUMN "automatic_sync_enabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "challonge_integrations"
SET "automatic_sync_enabled" = true
WHERE "enabled" = true
  AND "sync_frequency" <> 'manual';

UPDATE "challonge_integrations"
SET "sync_frequency" = 'five_minutes'
WHERE "sync_frequency" = 'manual';

ALTER TABLE "challonge_sync_logs"
ADD COLUMN "identifier" TEXT;

UPDATE "challonge_sync_logs" AS logs
SET "identifier" = integrations."identifier"
FROM "challonge_integrations" AS integrations
WHERE integrations."id" = logs."integration_id";

ALTER TABLE "challonge_sync_logs"
ALTER COLUMN "identifier" SET NOT NULL;

ALTER TABLE "background_jobs"
ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "background_jobs_dedupe_key_key"
ON "background_jobs"("dedupe_key");
