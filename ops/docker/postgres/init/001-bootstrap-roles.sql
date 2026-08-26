-- Quest production PostgreSQL 17 role/schema bootstrap.
--
-- This file contains no passwords. The bootstrap administrator must set the
-- four role passwords through the secret-management procedure before writer
-- admission. Quest owns public; the sibling VALORANT service owns valorant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quest_migrator') THEN
    CREATE ROLE quest_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quest_runtime') THEN
    CREATE ROLE quest_runtime LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'val_migrator') THEN
    CREATE ROLE val_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'val_runtime') THEN
    CREATE ROLE val_runtime LOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator;

ALTER SCHEMA public OWNER TO quest_migrator;
ALTER SCHEMA valorant OWNER TO val_migrator;

GRANT CONNECT ON DATABASE quest TO quest_migrator, quest_runtime, val_migrator, val_runtime;

REVOKE ALL ON SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

GRANT USAGE, CREATE ON SCHEMA public TO quest_migrator;
GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quest_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quest_runtime;

GRANT USAGE ON SCHEMA valorant TO val_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA valorant TO val_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA valorant TO val_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quest_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quest_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO val_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  GRANT USAGE, SELECT ON SEQUENCES TO val_runtime;

-- Explicitly prevent the two runtime roles from crossing schema boundaries.
REVOKE ALL ON SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM val_runtime;
