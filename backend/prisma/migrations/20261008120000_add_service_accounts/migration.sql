-- Accounts for automation: bots and agents that act through the admin API.
-- A service account is an ordinary user row flagged as one, so every existing
-- staff-role check, audit record, and foreign key already understands it. It
-- signs in only with a service token from the table below.
--
-- Additive only: a defaulted column on `users` and a new table, so this applies
-- to a running deployment without rewriting a row anything is waiting on.
ALTER TABLE "users" ADD COLUMN "is_service_account" BOOLEAN NOT NULL DEFAULT false;

-- What a service account may open is the staff roles it was granted. Holding
-- the admin role would open everything at once, which is the reach this
-- feature exists to avoid, so the database refuses it outright.
ALTER TABLE "users" ADD CONSTRAINT "users_service_account_not_admin_check"
  CHECK (NOT ("is_service_account" AND "role" = 'admin'));

CREATE TABLE "service_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "last_used_ip" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_by_user_id" UUID,
  "revoked_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_tokens_token_hash_key" ON "service_tokens"("token_hash");
CREATE INDEX "service_tokens_user_id_idx" ON "service_tokens"("user_id");

ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same access model as every other application table: RLS on, the runtime
-- role reaches it through its policy, and the Supabase Data API roles do not.
ALTER TABLE public."service_tokens" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."service_tokens" TO quest_runtime;

DROP POLICY IF EXISTS service_tokens_runtime_all ON public."service_tokens";
CREATE POLICY service_tokens_runtime_all
ON public."service_tokens"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."service_tokens" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."service_tokens" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
