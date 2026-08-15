-- This is an empty migration.

-- Task 2 triage MUST-FIX: the detach trigger must run as SECURITY DEFINER.
-- Under RLS a restricted-role DELETE on saved_teams would otherwise evaluate
-- the trigger's UPDATE against the caller's (restricted) policy and could
-- silently no-op the detach. Additive: CREATE OR REPLACE only, no DROP, and
-- the existing trigger definition is unchanged.
CREATE OR REPLACE FUNCTION public.detach_valorant_bindings_on_saved_team_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "valorant_team_bindings"
     SET status = 'detached', detached_at = now()
   WHERE saved_team_id = OLD.id AND status = 'active';
  RETURN OLD;
END;
$$;