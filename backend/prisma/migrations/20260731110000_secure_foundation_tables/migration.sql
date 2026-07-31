-- These tables were introduced after the database-wide RLS hardening migration.
-- The application accesses them through Prisma, not through the Supabase Data API.
ALTER TABLE public."tournament_staff_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."match_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."challonge_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."challonge_participant_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."challonge_sync_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."tournament_staff_assignments",
  public."matches",
  public."match_participants",
  public."challonge_integrations",
  public."challonge_participant_links",
  public."challonge_sync_logs",
  public."audit_logs"
FROM PUBLIC;

DO $migration$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."tournament_staff_assignments", public."matches", public."match_participants", public."challonge_integrations", public."challonge_participant_links", public."challonge_sync_logs", public."audit_logs" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
