const { prisma } = require("../src/lib/prisma");

const verify = async () => {
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
    ORDER BY "roleName", "schemaName", "objectName", privilege
  `;
  const objectOwnership = await prisma.$queryRaw`
    WITH relation_owners AS (
      SELECT n.nspname AS "schemaName", c.relname AS "objectName",
        r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname IN ('public', 'valorant')
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ), routine_owners AS (
      SELECT n.nspname AS "schemaName", p.proname AS "objectName",
        r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname IN ('public', 'valorant')
        AND p.prokind IN ('f', 'p', 'a')
    ), type_owners AS (
      SELECT n.nspname AS "schemaName", t.typname AS "objectName",
        r.rolname AS "ownerName",
        CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS "expectedOwner"
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_roles r ON r.oid = t.typowner
      WHERE n.nspname IN ('public', 'valorant')
        AND t.typisdefined
        AND t.typtype IN ('b', 'd', 'e')
        AND t.typelem = 0
        AND t.typrelid = 0
    )
    SELECT "schemaName", "objectName", "ownerName", "expectedOwner"
    FROM (
      SELECT * FROM relation_owners
      UNION ALL SELECT * FROM routine_owners
      UNION ALL SELECT * FROM type_owners
    ) objects
    WHERE "ownerName" <> "expectedOwner"
    ORDER BY "schemaName", "objectName", "ownerName"
  `;

  if (
    tablesWithoutRls.length ||
    tablesWithoutRuntimePolicy.length ||
    migrationRuntimeAccess.length ||
    bypassRoles.length ||
    dataApiGrants.length ||
    crossSchemaGrants.length ||
    objectOwnership.length
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
