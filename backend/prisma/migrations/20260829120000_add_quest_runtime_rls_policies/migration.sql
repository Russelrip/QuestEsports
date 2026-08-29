-- Keep the Quest runtime role non-bypass while preserving the application's
-- existing authorization boundary: the API authorizes requests and the role
-- can operate on every Quest application row.
GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quest_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quest_runtime;

-- The Prisma ledger is owned and used by the migrator only. The broad table
-- grant above is intentional for existing application tables, then repaired
-- explicitly here because the ledger is not an application table.
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM quest_runtime;

-- Keep the existing vanilla-PostgreSQL security posture independent of any
-- project-level automatic-RLS setting and remove Data API access again after a
-- restore or role repair.
DO $migration$
DECLARE
  table_record RECORD;
  role_name TEXT;
BEGIN
  FOR table_record IN
    SELECT c.relname AS tablename
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', table_record.tablename);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      table_record.tablename || '_runtime_all', 'public', table_record.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      table_record.tablename || '_runtime_all', 'public', table_record.tablename, 'quest_runtime'
    );
  END LOOP;

  REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I', 'public', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I', 'public', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I', 'public', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I', 'public', role_name);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        'public', role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        'public', role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
        'public', role_name
      );
    END IF;
  END LOOP;
END
$migration$;
