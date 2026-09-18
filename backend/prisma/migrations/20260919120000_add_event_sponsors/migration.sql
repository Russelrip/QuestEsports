-- Event-level sponsors, shown in the event hero belt ahead of the child
-- tournaments' own sponsors. Additive only: a new table, no existing rows touched.
CREATE TABLE "event_sponsors" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partnership_label" TEXT NOT NULL DEFAULT 'Official Sponsor',
    "logo_image_name" TEXT,
    "website_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_sponsors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_sponsors_series_id_display_order_idx" ON "event_sponsors"("series_id", "display_order");
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same access model as every other application table: RLS on, the runtime
-- role reaches it through its policy, and the Supabase Data API roles do not.
ALTER TABLE public."event_sponsors" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."event_sponsors" TO quest_runtime;

DROP POLICY IF EXISTS event_sponsors_runtime_all ON public."event_sponsors";
CREATE POLICY event_sponsors_runtime_all
ON public."event_sponsors"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."event_sponsors" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."event_sponsors" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
