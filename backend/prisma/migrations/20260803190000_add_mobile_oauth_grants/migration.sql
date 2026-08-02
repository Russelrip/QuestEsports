CREATE TABLE "mobile_oauth_grants" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mobile_oauth_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_oauth_grants_token_hash_key"
ON "mobile_oauth_grants"("token_hash");

CREATE INDEX "mobile_oauth_grants_user_id_idx"
ON "mobile_oauth_grants"("user_id");

CREATE INDEX "mobile_oauth_grants_expires_at_idx"
ON "mobile_oauth_grants"("expires_at");

ALTER TABLE "mobile_oauth_grants"
ADD CONSTRAINT "mobile_oauth_grants_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- This short-lived credential table is application-only and must never be
-- exposed through Supabase Data API roles.
ALTER TABLE public."mobile_oauth_grants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."mobile_oauth_grants" FROM PUBLIC;

DO $migration$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."mobile_oauth_grants" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
