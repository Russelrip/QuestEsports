-- A tournament's slug is its public URL, and nothing recorded the one it used to
-- have, so renaming one broke every link already shared for it. Each retired
-- slug is kept here instead, and the old URL keeps resolving.
--
-- Additive only: a new table and nothing touched on `tournaments`, so this
-- applies to a running deployment without taking a lock anything is waiting on.
CREATE TABLE "tournament_slug_history" (
  "id" UUID NOT NULL,
  "tournament_id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tournament_slug_history_pkey" PRIMARY KEY ("id")
);

-- A retired slug has to resolve to exactly one tournament, and it must never
-- collide with a live slug either -- the public lookup checks `tournaments`
-- first, so a duplicate here would simply be unreachable rather than ambiguous,
-- but the write path refuses it outright.
CREATE UNIQUE INDEX "tournament_slug_history_slug_key" ON "tournament_slug_history"("slug");

CREATE INDEX "tournament_slug_history_tournament_id_created_at_idx"
  ON "tournament_slug_history"("tournament_id", "created_at");

ALTER TABLE "tournament_slug_history" ADD CONSTRAINT "tournament_slug_history_tournament_id_fkey"
  FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same access model as every other application table: RLS on, the runtime
-- role reaches it through its policy, and the Supabase Data API roles do not.
ALTER TABLE public."tournament_slug_history" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."tournament_slug_history" TO quest_runtime;

DROP POLICY IF EXISTS tournament_slug_history_runtime_all ON public."tournament_slug_history";
CREATE POLICY tournament_slug_history_runtime_all
ON public."tournament_slug_history"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."tournament_slug_history" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."tournament_slug_history" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
