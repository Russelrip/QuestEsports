ALTER TABLE "users"
ADD COLUMN "password_set_at" TIMESTAMP(3);

UPDATE "users" AS u
SET "password_set_at" = u."created_at"
WHERE NOT EXISTS (
  SELECT 1
  FROM "oauth_accounts" AS oa
  WHERE oa."user_id" = u."id"
);

CREATE TABLE "oauth_link_nonces" (
    "id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_link_nonces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_link_nonces_nonce_key"
ON "oauth_link_nonces"("nonce");
CREATE INDEX "oauth_link_nonces_user_id_provider_idx"
ON "oauth_link_nonces"("user_id", "provider");
CREATE INDEX "oauth_link_nonces_expires_at_idx"
ON "oauth_link_nonces"("expires_at");

ALTER TABLE "oauth_link_nonces"
ADD CONSTRAINT "oauth_link_nonces_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."oauth_link_nonces" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."oauth_link_nonces" FROM PUBLIC;

DO $migration$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."oauth_link_nonces" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
