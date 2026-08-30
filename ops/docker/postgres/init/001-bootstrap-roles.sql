-- Quest production PostgreSQL 17 role/schema bootstrap.
--
-- This file contains no passwords. The bootstrap/recovery administrator must
-- set role passwords through the secret-management procedure before writer
-- admission. Quest owns public; the sibling VALORANT service owns valorant.
--
-- quest_recovery_admin is a break-glass login used only by guarded restore and
-- post-restore security wrappers. It is deliberately not a superuser and is
-- not granted to either runtime role. Membership in the two migrator roles
-- lets it normalize restored object ownership without making it an
-- application credential. The initial bootstrap is run by the PostgreSQL
-- bootstrap administrator; RESTORE_MODE is run by quest_recovery_admin after
-- the --no-owner restore.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quest_recovery_admin') THEN
    CREATE ROLE quest_recovery_admin LOGIN;
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

-- The guarded restore connection is not an application role, but it must be
-- able to reconnect after PUBLIC CONNECT is revoked.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO quest_recovery_admin', current_database());
END
$$;

-- Normalize attributes even when a role already existed. In particular,
-- bootstrap must not preserve inherited memberships or elevated capabilities.
\if :{?RESTORE_MODE}
-- Restore mode runs as quest_recovery_admin, which intentionally cannot alter
-- superuser attributes. The normal bootstrap has already established this
-- contract before the guarded --no-owner restore begins.
\else
ALTER ROLE quest_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE quest_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE val_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- The recovery role is the only privileged non-superuser contract. Its
-- password is set out of band; never add a PASSWORD clause here.
ALTER ROLE quest_recovery_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
ALTER ROLE val_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\endif

-- Remove pre-existing memberships as well as INHERIT. NOINHERIT alone would
-- still allow an explicit SET ROLE into a role that was already granted.
\if :{?RESTORE_MODE}
-- Preserve the recovery administrator's two ownership memberships while it
-- performs the post-restore normalization pass.
\else
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
\endif

\if :{?RESTORE_MODE}
-- The schema already exists during the guarded restore and recovery is not a
-- database owner, so do not re-run CREATE SCHEMA under that connection.
\else
CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator;
\endif

ALTER SCHEMA public OWNER TO quest_migrator;
ALTER SCHEMA valorant OWNER TO val_migrator;

-- A --no-owner restore creates objects as the restore connection role. The
-- recovery administrator runs this bootstrap in RESTORE_MODE after the dump,
-- so every restorable object has the schema migrator as its owner before any
-- runtime role is admitted. Keep the two schemas independent. Indexes,
-- constraints, triggers, and row types follow their owning relation; explicit
-- relation, routine, and user-defined type passes cover the independently
-- owned object classes that a logical archive can contain.
\if :{?RESTORE_MODE}
DO $$
DECLARE
  relation_record record;
  routine_record record;
  type_record record;
  operator_record record;
  named_object record;
  schema_owner name;
BEGIN
  FOR relation_record IN
    SELECT namespace.nspname, relation.relname, relation.relkind
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  LOOP
    schema_owner := CASE relation_record.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    IF relation_record.relkind = 'S' THEN
      EXECUTE format(
        'ALTER SEQUENCE %I.%I OWNER TO %I',
        relation_record.nspname, relation_record.relname, schema_owner
      );
    ELSE
      EXECUTE format(
        'ALTER TABLE %I.%I OWNER TO %I',
        relation_record.nspname, relation_record.relname, schema_owner
      );
    END IF;
  END LOOP;

  FOR routine_record IN
    SELECT namespace.nspname, procedure.proname,
           pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
           procedure.prokind
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
      AND procedure.prokind IN ('f', 'p', 'a')
  LOOP
    schema_owner := CASE routine_record.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    IF routine_record.prokind = 'a' THEN
      EXECUTE format(
        'ALTER AGGREGATE %I.%I(%s) OWNER TO %I',
        routine_record.nspname, routine_record.proname,
        routine_record.identity_arguments, schema_owner
      );
    ELSE
      EXECUTE format(
        'ALTER %s %I.%I(%s) OWNER TO %I',
        CASE WHEN routine_record.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
        routine_record.nspname, routine_record.proname,
        routine_record.identity_arguments, schema_owner
      );
    END IF;
  END LOOP;

  FOR type_record IN
    SELECT namespace.nspname, type_object.typname
    FROM pg_type AS type_object
    JOIN pg_namespace AS namespace ON namespace.oid = type_object.typnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
      AND type_object.typisdefined
      AND type_object.typtype IN ('b', 'd', 'e', 'r')
      AND type_object.typelem = 0
      AND type_object.typrelid = 0
  LOOP
    schema_owner := CASE type_record.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    EXECUTE format(
      'ALTER TYPE %I.%I OWNER TO %I',
      type_record.nspname, type_record.typname, schema_owner
    );
  END LOOP;

  -- These schema-local objects have independent owner columns and are not
  -- repaired by ALTER TABLE. They are valid PostgreSQL 17 archive classes.
  FOR operator_record IN
    SELECT namespace.nspname, operator_object.oprname,
           CASE WHEN operator_object.oprleft = 0 THEN 'NONE' ELSE format_type(operator_object.oprleft, NULL) END AS left_type,
           CASE WHEN operator_object.oprright = 0 THEN 'NONE' ELSE format_type(operator_object.oprright, NULL) END AS right_type
    FROM pg_operator AS operator_object
    JOIN pg_namespace AS namespace ON namespace.oid = operator_object.oprnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
  LOOP
    schema_owner := CASE operator_record.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    EXECUTE format(
      'ALTER OPERATOR %I.%I (%s, %s) OWNER TO %I',
      operator_record.nspname, operator_record.oprname,
      operator_record.left_type, operator_record.right_type, schema_owner
    );
  END LOOP;

  FOR named_object IN
    SELECT namespace.nspname, collation_object.collname AS object_name,
           'COLLATION' AS object_kind
    FROM pg_collation AS collation_object
    JOIN pg_namespace AS namespace ON namespace.oid = collation_object.collnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
    UNION ALL
    SELECT namespace.nspname, conversion_object.conname, 'CONVERSION'
    FROM pg_conversion AS conversion_object
    JOIN pg_namespace AS namespace ON namespace.oid = conversion_object.connamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
    UNION ALL
    SELECT namespace.nspname, statistics_object.stxname, 'STATISTICS'
    FROM pg_statistic_ext AS statistics_object
    JOIN pg_namespace AS namespace ON namespace.oid = statistics_object.stxnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
  LOOP
    schema_owner := CASE named_object.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      named_object.object_kind, named_object.nspname,
      named_object.object_name, schema_owner
    );
  END LOOP;

  FOR named_object IN
    SELECT namespace.nspname, dictionary.dictname AS object_name, 'DICTIONARY' AS object_kind
    FROM pg_ts_dict AS dictionary
    JOIN pg_namespace AS namespace ON namespace.oid = dictionary.dictnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
    UNION ALL
    SELECT namespace.nspname, configuration.cfgname, 'CONFIGURATION'
    FROM pg_ts_config AS configuration
    JOIN pg_namespace AS namespace ON namespace.oid = configuration.cfgnamespace
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
  LOOP
    schema_owner := CASE named_object.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    EXECUTE format(
      'ALTER TEXT SEARCH %s %I.%I OWNER TO %I',
      named_object.object_kind, named_object.nspname,
      named_object.object_name, schema_owner
    );
  END LOOP;

  FOR named_object IN
    SELECT namespace.nspname, opclass.opcname AS object_name,
           access_method.amname AS access_method, 'CLASS' AS object_kind
    FROM pg_opclass AS opclass
    JOIN pg_namespace AS namespace ON namespace.oid = opclass.opcnamespace
    JOIN pg_am AS access_method ON access_method.oid = opclass.opcmethod
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
    UNION ALL
    SELECT namespace.nspname, opfamily.opfname, access_method.amname, 'FAMILY'
    FROM pg_opfamily AS opfamily
    JOIN pg_namespace AS namespace ON namespace.oid = opfamily.opfnamespace
    JOIN pg_am AS access_method ON access_method.oid = opfamily.opfmethod
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
  LOOP
    schema_owner := CASE named_object.nspname
      WHEN 'public' THEN 'quest_migrator'
      ELSE 'val_migrator'
    END;
    EXECUTE format(
      'ALTER OPERATOR %s %I.%I USING %I OWNER TO %I',
      named_object.object_kind, named_object.nspname,
      named_object.object_name, named_object.access_method, schema_owner
    );
  END LOOP;
END
$$;

\endif

-- Only the bootstrap administrator may establish these memberships. They are
-- intentionally absent from runtime roles and are skipped during RESTORE_MODE,
-- which is authenticated as quest_recovery_admin itself.
\if :{?RESTORE_MODE}
DO $$
BEGIN
  IF session_user <> 'quest_recovery_admin' THEN
    RAISE EXCEPTION 'RESTORE_MODE must run as quest_recovery_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE granted.rolname = 'quest_migrator' AND member.rolname = 'quest_recovery_admin')
     OR NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE granted.rolname = 'val_migrator' AND member.rolname = 'quest_recovery_admin') THEN
    RAISE EXCEPTION 'quest_recovery_admin lacks migrator ownership memberships';
  END IF;
END
$$;
\else
GRANT quest_migrator TO quest_recovery_admin;
GRANT val_migrator TO quest_recovery_admin;
REVOKE quest_runtime FROM quest_recovery_admin;
REVOKE val_runtime FROM quest_recovery_admin;
\endif

-- The normal bootstrap has already established grants/default privileges. A
-- --no-acl restore must not replay ACL work as the non-owner recovery role.
\if :{?RESTORE_MODE}
\else
GRANT CONNECT ON DATABASE quest TO quest_migrator, quest_runtime, val_migrator, val_runtime;
GRANT TEMPORARY ON DATABASE quest TO quest_migrator, val_migrator;

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
    WHERE namespace.nspname IN ('public', 'valorant') AND ((namespace.nspname = 'public' AND current_user = 'quest_migrator') OR (namespace.nspname = 'valorant' AND current_user = 'val_migrator'))
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

-- The sibling VALORANT migrator creates this ledger. Repair an existing target
-- without requiring the table to exist during first bootstrap.
DO $$
BEGIN
  IF to_regclass('valorant._migration_ledger') IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',
      'valorant', '_migration_ledger', 'val_runtime'
    );
  END IF;
END
$$;

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
\endif
