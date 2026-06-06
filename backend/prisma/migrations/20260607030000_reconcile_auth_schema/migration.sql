DO $$
BEGIN
  CREATE TYPE "AuthProvider" AS ENUM ('google', 'discord');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "last_failed_login_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "user_agent" TEXT,
ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
ADD COLUMN IF NOT EXISTS "remember_me" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "mfa_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "secret_ciphertext" TEXT NOT NULL,
  "enabled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "backup_codes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "login_challenges" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "remember_me" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "email" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "users_locked_until_idx"
ON "users"("locked_until");

CREATE UNIQUE INDEX IF NOT EXISTS "mfa_credentials_user_id_key"
ON "mfa_credentials"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "backup_codes_code_hash_key"
ON "backup_codes"("code_hash");

CREATE INDEX IF NOT EXISTS "backup_codes_user_id_idx"
ON "backup_codes"("user_id");

CREATE INDEX IF NOT EXISTS "backup_codes_used_at_idx"
ON "backup_codes"("used_at");

CREATE UNIQUE INDEX IF NOT EXISTS "login_challenges_token_hash_key"
ON "login_challenges"("token_hash");

CREATE INDEX IF NOT EXISTS "login_challenges_user_id_idx"
ON "login_challenges"("user_id");

CREATE INDEX IF NOT EXISTS "login_challenges_expires_at_idx"
ON "login_challenges"("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_provider_user_id_key"
ON "oauth_accounts"("provider", "provider_user_id");

CREATE INDEX IF NOT EXISTS "oauth_accounts_user_id_idx"
ON "oauth_accounts"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mfa_credentials_user_id_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "mfa_credentials"
    ADD CONSTRAINT "mfa_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'backup_codes_user_id_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "backup_codes"
    ADD CONSTRAINT "backup_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'login_challenges_user_id_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "login_challenges"
    ADD CONSTRAINT "login_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'oauth_accounts_user_id_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "oauth_accounts"
    ADD CONSTRAINT "oauth_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
