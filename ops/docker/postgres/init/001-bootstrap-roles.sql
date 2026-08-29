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
\if :{?RESTORE_MODE}
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
\else
REVOKE ALL ON DATABASE quest FROM PUBLIC;
\endif

-- Normalize attributes even when a role already existed. In particular,
-- bootstrap must not preserve inherited memberships or elevated capabilities.
ALTER ROLE quest_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE quest_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE val_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE val_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

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

\if :{?RESTORE_MODE}
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO quest_migrator, quest_runtime, val_migrator, val_runtime',
    current_database()
  );
  EXECUTE format(
    'GRANT TEMPORARY ON DATABASE %I TO quest_migrator, val_migrator',
    current_database()
  );
END
$$;
\else
GRANT CONNECT ON DATABASE quest TO quest_migrator, quest_runtime, val_migrator, val_runtime;
GRANT TEMPORARY ON DATABASE quest TO quest_migrator, val_migrator;
\endif

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

-- PostgreSQL has no ALL TYPES IN SCHEMA form. Normalize existing user-defined
-- types explicitly, excluding generated array and multirange types: PostgreSQL
-- 17 rejects ACL changes on those generated companion types. Default privileges
-- below cover types created by future migrations.
DO $$
DECLARE
  object_type record;
BEGIN
  FOR object_type IN
    SELECT namespace.nspname, type_object.typname
    FROM pg_type AS type_object
    JOIN pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
    WHERE namespace.nspname IN ('public', 'valorant')
      AND type_object.typisdefined
      AND type_object.typtype <> 'p'
      AND type_object.typtype <> 'm'
      AND type_object.typelem = 0
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

-- Prisma creates this table through the migrator connection. It must remain
-- migrator-only even when this bootstrap repairs an existing database after
-- migrations have already run.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',
      'public', '_prisma_migrations', 'quest_runtime'
    );
  END IF;
END
$$;

GRANT USAGE ON SCHEMA valorant TO val_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA valorant TO val_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA valorant TO val_runtime;

-- PostgreSQL's built-in PUBLIC defaults are global. Schema-local revokes alone
-- do not remove those defaults from future routines and types, so revoke them
-- globally for each migrator before materializing owner-only schema defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE USAGE ON TYPES FROM PUBLIC;

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
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO quest_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public GRANT USAGE ON TYPES TO quest_migrator;

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
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant GRANT EXECUTE ON FUNCTIONS TO val_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant GRANT USAGE ON TYPES TO val_migrator;

-- Explicitly prevent the two runtime roles from crossing schema boundaries.
REVOKE ALL ON SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA valorant FROM quest_runtime;
REVOKE ALL ON SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM val_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM val_runtime;
