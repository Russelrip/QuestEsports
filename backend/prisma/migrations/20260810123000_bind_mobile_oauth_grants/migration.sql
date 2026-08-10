ALTER TABLE "mobile_oauth_grants"
ADD COLUMN "code_challenge" TEXT;

UPDATE "mobile_oauth_grants"
SET "used_at" = COALESCE("used_at", CURRENT_TIMESTAMP),
    "code_challenge" = 'invalidated-by-pkce-migration'
WHERE "code_challenge" IS NULL;

COMMENT ON COLUMN "mobile_oauth_grants"."code_challenge" IS
'Expand-first PKCE binding. New application versions require this value; enforce NOT NULL in a later release after the old version is fully retired.';
