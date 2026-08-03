DELETE FROM "rate_limit_buckets"
WHERE "name" IN ('auth-login-mfa', 'mfa-settings');

DROP TABLE IF EXISTS "backup_codes";
DROP TABLE IF EXISTS "login_challenges";
DROP TABLE IF EXISTS "mfa_credentials";

ALTER TABLE "users"
DROP COLUMN IF EXISTS "mfa_enabled";
