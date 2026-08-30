const fs = require("node:fs");
const { prisma } = require("../src/lib/prisma");

const verifySecurityUrl = (authority) => {
  if (!process.env.SECURITY_VERIFY_TARGET && !process.env.TARGET_AUTHORITY) return;
  const rawUrl = process.env.SECURITY_VERIFY_DATABASE_URL ||
    (process.env.SECURITY_VERIFY_DATABASE_URL_FILE &&
      fs.readFileSync(process.env.SECURITY_VERIFY_DATABASE_URL_FILE, "utf8").trim()) ||
    process.env.DATABASE_URL;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("security verification database URL is invalid");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("security verification requires a libpq PostgreSQL URL");
  }
  const expected = {
    "quest-postgres": { host: "quest-postgres", port: "5432", ca: "/run/secrets/quest-private-ca.crt" },
    "staged-loopback": { host: "127.0.0.1", port: "55432", ca: "/etc/quest-esports/tls/quest-private-ca.crt" },
  }[authority];
  if (!expected || url.hostname !== expected.host || url.port !== expected.port) {
    throw new Error("security verification URL does not match the selected PostgreSQL target authority");
  }
  if (url.pathname !== "/quest" || url.username !== "quest_recovery_admin" || !url.password) {
    throw new Error("security verification URL must use the protected quest_recovery_admin identity");
  }
  const query = [...url.searchParams.entries()];
  if (query.length !== 2 || query[0][0] !== "sslmode" || query[0][1] !== "verify-full" ||
      query[1][0] !== "sslrootcert" || query[1][1] !== expected.ca) {
    throw new Error("security verification URL must require the canonical CA and sslmode=verify-full");
  }
};

const verifyTargetBinding = async () => {
  if (!process.env.TARGET_AUTHORITY && !process.env.SECURITY_VERIFY_TARGET) return;
  const authority = process.env.TARGET_AUTHORITY;
  if (process.env.SECURITY_VERIFY_TARGET && process.env.SECURITY_VERIFY_TARGET !== authority) {
    throw new Error("security verification target and authority disagree");
  }
  verifySecurityUrl(authority);
  const expectedHost = authority === "staged-loopback" ? "127.0.0.1" : "quest-postgres";
  const expectedPort = authority === "staged-loopback" ? "55432" : "5432";
  if (
    !["quest-postgres", "staged-loopback"].includes(process.env.TARGET_AUTHORITY) ||
    process.env.TARGET_DATABASE_HOST !== expectedHost ||
    process.env.TARGET_DATABASE_PORT !== expectedPort ||
    process.env.TARGET_DATABASE_NAME !== "quest" ||
    process.env.TARGET_POSTGRES_MAJOR !== "17"
  ) {
    throw new Error("security verification target is not the private PostgreSQL 17 Compose target");
  }
  const [observed] = await prisma.$queryRaw`
    SELECT current_database() AS "databaseName",
           current_setting('server_version_num') AS "serverVersionNum",
           inet_server_addr() AS "serverAddress",
           inet_server_port() AS "serverPort",
           session_user AS "sessionUser",
           current_user AS "currentUser",
           CASE WHEN EXISTS (
             SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl
           ) THEN 'on' ELSE 'off' END AS "sslStatus",
           (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS "sslVersion",
           (SELECT cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS "sslCipher"
  `;
  if (
    !observed ||
    observed.databaseName !== "quest" ||
    !/^17\d{4,}$/.test(String(observed.serverVersionNum)) ||
    String(observed.serverPort) !== "5432" ||
    !observed.serverAddress ||
    observed.sessionUser !== "quest_recovery_admin" ||
    observed.currentUser !== "quest_recovery_admin" ||
    observed.sslStatus !== "on" ||
    !observed.sslVersion ||
    !observed.sslCipher
  ) {
    throw new Error("security verification connected to an unexpected database target");
  }
};

const verify = async () => {
  await verifyTargetBinding();
  const tablesWithoutRls = await prisma.$queryRaw`
    SELECT n.nspname AS "schemaName", c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'valorant')
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('_prisma_migrations', '_migration_ledger')
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  `;
  const tablesWithoutRuntimePolicy = await prisma.$queryRaw`
    SELECT n.nspname AS "schemaName", c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'valorant')
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('_prisma_migrations', '_migration_ledger')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = n.nspname
          AND p.tablename = c.relname
          AND p.policyname = c.relname || '_runtime_all'
          AND p.cmd = 'ALL'
          AND (CASE WHEN n.nspname = 'public' THEN 'quest_runtime' ELSE 'val_runtime' END) = ANY (p.roles)
          AND p.qual = 'true'
          AND p.with_check = 'true'
      )
    ORDER BY c.relname
  `;
  const migrationRuntimeAccess = await prisma.$queryRaw`
    WITH ledgers(schema_name, table_name, runtime_role) AS (
      VALUES ('public'::name, '_prisma_migrations'::name, 'quest_runtime'::name),
             ('valorant'::name, '_migration_ledger'::name, 'val_runtime'::name)
    )
    SELECT l.schema_name || '.' || l.table_name || ':' || p.policyname AS "access"
    FROM ledgers l
    JOIN pg_policies p ON p.schemaname = l.schema_name AND p.tablename = l.table_name
    WHERE p.roles && ARRAY['quest_runtime', 'val_runtime']::name[]
       OR 'public' = ANY (p.roles)
    UNION ALL
    SELECT l.schema_name || '.' || l.table_name || ':' || l.runtime_role || ':' || privilege AS "access"
    FROM ledgers l
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
    WHERE has_table_privilege(l.runtime_role, format('%I.%I', l.schema_name, l.table_name), privilege)
    ORDER BY 1
  `;
  const bypassRoles = await prisma.$queryRaw`
    SELECT rolname AS "roleName"
    FROM pg_roles
    WHERE rolname IN ('quest_runtime', 'val_runtime')
      AND rolbypassrls
    ORDER BY rolname
  `;
  const unsafeRuntimeOrMigratorRoles = await prisma.$queryRaw`
    SELECT rolname AS "roleName"
    FROM pg_roles
    WHERE rolname IN ('quest_runtime', 'quest_migrator', 'val_runtime', 'val_migrator')
      AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls)
    ORDER BY rolname
  `;
  const recoveryAdminContract = await prisma.$queryRaw`
    SELECT CASE WHEN r.rolcanlogin AND r.rolsuper AND NOT r.rolcreatedb
      AND r.rolcreaterole AND NOT r.rolreplication AND r.rolbypassrls
      AND NOT r.rolinherit AND r.rolconnlimit = 1
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
      THEN 'verified' ELSE 'failed' END AS status
    FROM pg_roles r WHERE r.rolname = 'quest_recovery_admin'
  `;
  const dataApiGrants = await prisma.$queryRaw`
    WITH protected_roles AS (
      SELECT oid, rolname
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    ), effective_table_grants AS (
      SELECT r.rolname AS grantee, n.nspname AS schema_name, c.relname AS object_name, privilege
      FROM protected_roles r
      CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
      WHERE n.nspname IN ('public', 'valorant')
        AND c.relkind IN ('r', 'p')
        AND has_table_privilege(r.oid, c.oid, privilege)
    ), public_table_grants AS (
      SELECT 'PUBLIC'::name AS grantee, n.nspname AS schema_name, c.relname AS object_name, acl.privilege_type AS privilege
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname IN ('public', 'valorant')
        AND c.relkind IN ('r', 'p')
        AND acl.grantee = 0
    )
    SELECT grantee, schema_name AS "schemaName", object_name AS "objectName", privilege
    FROM effective_table_grants
    UNION ALL
    SELECT grantee, schema_name AS "schemaName", object_name AS "objectName", privilege
    FROM public_table_grants
    UNION ALL
    SELECT r.rolname, n.nspname, p.proname, 'EXECUTE'
    FROM protected_roles r
    JOIN pg_proc p ON has_function_privilege(r.oid, p.oid, 'EXECUTE')
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'valorant')
    UNION ALL
    SELECT r.rolname, n.nspname, t.typname, 'USAGE'
    FROM protected_roles r
    JOIN pg_type t ON has_type_privilege(r.oid, t.oid, 'USAGE')
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname IN ('public', 'valorant') AND t.typelem = 0
      AND (t.typrelid = 0 OR EXISTS (SELECT 1 FROM pg_class composite_relation WHERE composite_relation.oid = t.typrelid AND composite_relation.relkind = 'c'))
    UNION ALL
    SELECT 'PUBLIC'::name, n.nspname, p.proname, acl.privilege_type
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname IN ('public', 'valorant') AND acl.grantee = 0
    UNION ALL
    SELECT 'PUBLIC'::name, n.nspname, t.typname, acl.privilege_type
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) acl
    WHERE n.nspname IN ('public', 'valorant') AND t.typelem = 0
      AND (t.typrelid = 0 OR EXISTS (SELECT 1 FROM pg_class composite_relation WHERE composite_relation.oid = t.typrelid AND composite_relation.relkind = 'c'))
      AND acl.grantee = 0
    UNION ALL
    SELECT 'PUBLIC'::name, n.nspname, c.relname, acl.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) acl
    WHERE n.nspname IN ('public', 'valorant') AND c.relkind = 'S' AND acl.grantee = 0
    ORDER BY grantee, "schemaName", "objectName", privilege
  `;
  const crossSchemaGrants = await prisma.$queryRaw`
    WITH cross_schema_roles(role_name, schema_name) AS (
      VALUES ('quest_runtime'::name, 'valorant'::name), ('val_runtime'::name, 'public'::name)
    ), schema_grants AS (
      SELECT r.role_name AS "roleName", r.schema_name AS "schemaName", privilege
      FROM cross_schema_roles r
      CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) privilege
      JOIN pg_roles role_record ON role_record.rolname = r.role_name
      WHERE has_schema_privilege(role_record.rolname, r.schema_name, privilege)
    ), table_grants AS (
      SELECT r.role_name AS "roleName", r.schema_name AS "schemaName",
        c.relname AS "objectName", privilege
      FROM cross_schema_roles r
      JOIN pg_roles role_record ON role_record.rolname = r.role_name
      JOIN pg_namespace n ON n.nspname = r.schema_name
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
      WHERE has_table_privilege(role_record.rolname, c.oid, privilege)
    )
    SELECT "roleName", "schemaName", NULL::name AS "objectName", privilege FROM schema_grants
    UNION ALL
    SELECT "roleName", "schemaName", "objectName", privilege FROM table_grants
    UNION ALL
    SELECT r.role_name, r.schema_name, p.proname, 'EXECUTE'
    FROM cross_schema_roles r
    JOIN pg_namespace n ON n.nspname = r.schema_name
    JOIN pg_proc p ON p.pronamespace = n.oid
    WHERE has_function_privilege(r.role_name, p.oid, 'EXECUTE')
    UNION ALL
    SELECT r.role_name, r.schema_name, t.typname, 'USAGE'
    FROM cross_schema_roles r
    JOIN pg_namespace n ON n.nspname = r.schema_name
    JOIN pg_type t ON t.typnamespace = n.oid AND t.typelem = 0
      AND (t.typrelid = 0 OR EXISTS (SELECT 1 FROM pg_class composite_relation WHERE composite_relation.oid = t.typrelid AND composite_relation.relkind = 'c'))
    WHERE has_type_privilege(r.role_name, t.oid, 'USAGE')
    ORDER BY "roleName", "schemaName", "objectName", privilege
  `;
  const objectOwnership = await prisma.$queryRaw`
    WITH relation_owners AS (
      SELECT n.nspname AS "schemaName", c.relname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname IN ('public', 'valorant') AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
    ), routine_owners AS (
      SELECT n.nspname AS "schemaName", p.proname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname IN ('public', 'valorant') AND p.prokind IN ('f', 'p', 'a')
    ), type_owners AS (
      SELECT n.nspname AS "schemaName", t.typname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_roles r ON r.oid = t.typowner
      WHERE n.nspname IN ('public', 'valorant') AND t.typisdefined
        AND t.typtype IN ('b', 'c', 'd', 'e', 'r') AND t.typtype <> 'm' AND t.typelem = 0
        AND (t.typrelid = 0 OR EXISTS (
          SELECT 1 FROM pg_class composite_relation
          WHERE composite_relation.oid = t.typrelid AND composite_relation.relkind = 'c'
        ))
    ), operator_owners AS (
      SELECT n.nspname AS "schemaName", o.oprname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace JOIN pg_roles r ON r.oid = o.oprowner
      WHERE n.nspname IN ('public', 'valorant')
    ), named_owners AS (
      SELECT n.nspname AS "schemaName", c.collname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace JOIN pg_roles r ON r.oid = c.collowner
      WHERE n.nspname IN ('public', 'valorant')
      UNION ALL SELECT n.nspname, c.conname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END
      FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_roles r ON r.oid = c.conowner
      WHERE n.nspname IN ('public', 'valorant')
      UNION ALL SELECT n.nspname, s.stxname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END
      FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace JOIN pg_roles r ON r.oid = s.stxowner
      WHERE n.nspname IN ('public', 'valorant')
    ), operator_family_owners AS (
      SELECT n.nspname AS "schemaName", o.opcname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace JOIN pg_roles r ON r.oid = o.opcowner
      WHERE n.nspname IN ('public', 'valorant')
      UNION ALL SELECT n.nspname, o.opfname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END
      FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace JOIN pg_roles r ON r.oid = o.opfowner
      WHERE n.nspname IN ('public', 'valorant')
    ), text_search_owners AS (
      SELECT n.nspname AS "schemaName", d.dictname AS "objectName", r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace JOIN pg_roles r ON r.oid = d.dictowner
      WHERE n.nspname IN ('public', 'valorant')
      UNION ALL SELECT n.nspname, c.cfgname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END
      FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace JOIN pg_roles r ON r.oid = c.cfgowner
      WHERE n.nspname IN ('public', 'valorant')
    )
    SELECT "schemaName", "objectName", "ownerName", "expectedOwner"
    FROM (
      SELECT * FROM relation_owners UNION ALL SELECT * FROM routine_owners UNION ALL SELECT * FROM type_owners
      UNION ALL SELECT * FROM operator_owners UNION ALL SELECT * FROM named_owners
      UNION ALL SELECT * FROM operator_family_owners UNION ALL SELECT * FROM text_search_owners
    ) objects
    WHERE "ownerName" <> "expectedOwner"
    ORDER BY "schemaName", "objectName", "ownerName"
  `;

  const schemaOwnership = await prisma.$queryRaw`
    SELECT n.nspname AS "schemaName", r.rolname AS "ownerName",
      CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname IN ('public', 'valorant')
      AND r.rolname <> CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END
    ORDER BY n.nspname
  `;

  if (
    tablesWithoutRls.length ||
    tablesWithoutRuntimePolicy.length ||
    migrationRuntimeAccess.length ||
    bypassRoles.length ||
    dataApiGrants.length ||
    crossSchemaGrants.length ||
    objectOwnership.length ||
    schemaOwnership.length
    || recoveryAdminContract.length !== 1
    || recoveryAdminContract[0].status !== "verified"
    || unsafeRuntimeOrMigratorRoles.length
  ) {
    if (tablesWithoutRls.length) {
      console.error(
        `Public tables without RLS: ${tablesWithoutRls.map(({ tableName }) => tableName).join(", ")}`
      );
    }
    if (dataApiGrants.length) {
      console.error(
        `Unexpected Data API table grants: ${dataApiGrants
          .map(({ grantee, schemaName, objectName, privilege }) => `${grantee}:${schemaName}:${objectName}:${privilege}`)
          .join(", ")}`
      );
    }
    if (tablesWithoutRuntimePolicy.length) {
      console.error(
        `Application tables without their runtime policy: ${tablesWithoutRuntimePolicy
          .map(({ schemaName, tableName }) => `${schemaName}.${tableName}`)
          .join(", ")}`
      );
    }
    if (migrationRuntimeAccess.length) {
      console.error(
        `Unexpected runtime/PUBLIC access to a migration ledger: ${migrationRuntimeAccess
          .map(({ access }) => access)
          .join(", ")}`
      );
    }
    if (bypassRoles.length) {
      console.error(`Runtime roles with BYPASSRLS: ${bypassRoles.map(({ roleName }) => roleName).join(", ")}`);
    }
    if (unsafeRuntimeOrMigratorRoles.length) {
      console.error(`Runtime or migrator roles with unsafe attributes: ${unsafeRuntimeOrMigratorRoles.map(({ roleName }) => roleName).join(", ")}`);
    }
    if (crossSchemaGrants.length) {
      console.error(
        `Unexpected cross-schema runtime grants: ${crossSchemaGrants
          .map(({ roleName, schemaName, objectName, privilege }) => `${roleName}:${schemaName}:${objectName || "schema"}:${privilege}`)
          .join(", ")}`
      );
    }
    if (objectOwnership.length) {
      console.error(
        `Objects with unexpected schema owners: ${objectOwnership
          .map(({ schemaName, objectName, ownerName, expectedOwner }) =>
            `${schemaName}:${objectName}:${ownerName} (expected ${expectedOwner})`,
          )
          .join(", ")}`,
      );
    }
    if (schemaOwnership.length) {
      console.error(
        `Schemas with unexpected owners: ${schemaOwnership
          .map(({ schemaName, ownerName, expectedOwner }) =>
            `${schemaName}:${ownerName} (expected ${expectedOwner})`,
          )
          .join(", ")}`,
      );
    }
    if (recoveryAdminContract.length !== 1 || recoveryAdminContract[0].status !== "verified") {
      console.error("Recovery administrator role contract is missing or does not match the protected direct-superuser model.");
    }
    process.exitCode = 1;
    return;
  }

  console.log("Database security verification passed: RLS, runtime isolation, object ownership, and Data API grants are compliant.");
};

verify()
  .catch((error) => {
    console.error("Database security verification failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
