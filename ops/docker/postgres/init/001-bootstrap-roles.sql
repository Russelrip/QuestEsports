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

-- Remove the database-level defaults before granting only the service roles.
-- This also repairs databases initialized with PostgreSQL's PUBLIC CONNECT and
-- TEMP privileges.
REVOKE ALL ON DATABASE quest FROM PUBLIC;

-- Normalize attributes even when a role already existed. In particular,
-- bootstrap must not preserve inherited memberships or elevated capabilities.
ALTER ROLE quest_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE quest_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE val_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE val_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Remove pre-existing memberships as well as INHERIT. NOINHERIT alone would
-- still allow an explicit SET ROLE into a role that was already granted.
DO $$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted_role.rolname AS granted_role, member_role.rolname AS member_role
    FROM pg_auth_members
    JOIN pg_roles AS granted_role ON granted_role.oid = pg_auth_members.roleid
    JOIN pg_roles AS member_role ON member_role.oid = pg_auth_members.member
    WHERE granted_role.rolname IN ('quest_migrator', 'quest_runtime', 'val_migrator', 'val_runtime')
       OR member_role.rolname IN ('quest_migrator', 'quest_runtime', 'val_migrator', 'val_runtime')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$$;

CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator;

ALTER SCHEMA public OWNER TO quest_migrator;
ALTER SCHEMA valorant OWNER TO val_migrator;

GRANT CONNECT ON DATABASE quest TO quest_migrator, quest_runtime, val_migrator, val_runtime;

REVOKE ALL ON SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA valorant FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;

-- PostgreSQL has no ALL TYPES IN SCHEMA form. Normalize every existing type
-- explicitly, then grant USAGE only to the owning service runtime role.
DO $$
DECLARE
  object_type record;
BEGIN
  FOR object_type IN
    SELECT namespace.nspname, type_object.typname
    FROM pg_type AS type_object
    JOIN pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
    WHERE namespace.nspname IN ('public', 'valorant')
      AND type_object.typtype <> 'p'
  LOOP
    EXECUTE format('REVOKE ALL ON TYPE %I.%I FROM PUBLIC', object_type.nspname, object_type.typname);
    IF object_type.nspname = 'public' THEN
      EXECUTE format('REVOKE ALL ON TYPE %I.%I FROM val_runtime', object_type.nspname, object_type.typname);
      EXECUTE format('GRANT USAGE ON TYPE %I.%I TO quest_runtime', object_type.nspname, object_type.typname);
    ELSE
      EXECUTE format('REVOKE ALL ON TYPE %I.%I FROM quest_runtime', object_type.nspname, object_type.typname);
      EXECUTE format('GRANT USAGE ON TYPE %I.%I TO val_runtime', object_type.nspname, object_type.typname);
    END IF;
  END LOOP;
END
$$;

GRANT USAGE, CREATE ON SCHEMA public TO quest_migrator;
GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quest_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quest_runtime;

GRANT USAGE ON SCHEMA valorant TO val_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA valorant TO val_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA valorant TO val_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quest_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quest_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public
  REVOKE ALL ON TYPES FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO val_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  GRANT USAGE, SELECT ON SEQUENCES TO val_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant
  REVOKE ALL ON TYPES FROM PUBLIC;

-- Explicitly prevent the two runtime roles from crossing schema boundaries.
REVOKE ALL ON SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM val_runtime;
