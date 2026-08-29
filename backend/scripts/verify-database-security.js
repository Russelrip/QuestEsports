const { prisma } = require("../src/lib/prisma");

const verify = async () => {
  const tablesWithoutRls = await prisma.$queryRaw`
    SELECT c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  `;
  const tablesWithoutRuntimePolicy = await prisma.$queryRaw`
    SELECT c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = c.relname || '_runtime_all'
          AND p.cmd = 'ALL'
          AND 'quest_runtime' = ANY (p.roles)
          AND p.qual = 'true'
          AND p.with_check = 'true'
      )
    ORDER BY c.relname
  `;
  const migrationRuntimeAccess = await prisma.$queryRaw`
    SELECT p.policyname AS "policyName"
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = '_prisma_migrations'
      AND ('quest_runtime' = ANY (p.roles) OR p.roles = ARRAY['public']::name[])
    UNION ALL
    SELECT '_prisma_migrations:' || privilege
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
    WHERE has_table_privilege('quest_runtime', 'public."_prisma_migrations"', privilege)
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
      SELECT r.rolname AS grantee, c.relname AS object_name, privilege
      FROM protected_roles r
      CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND has_table_privilege(r.oid, c.oid, privilege)
    ), public_table_grants AS (
      SELECT 'PUBLIC'::name AS grantee, c.relname AS object_name, acl.privilege_type AS privilege
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND acl.grantee = 0
    )
    SELECT grantee, object_name AS "objectName", privilege
    FROM effective_table_grants
    UNION ALL
    SELECT grantee, object_name AS "objectName", privilege
    FROM public_table_grants
    ORDER BY grantee, "objectName", privilege
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

  if (
    tablesWithoutRls.length ||
    tablesWithoutRuntimePolicy.length ||
    migrationRuntimeAccess.length ||
    bypassRoles.length ||
    dataApiGrants.length ||
    crossSchemaGrants.length
  ) {
    if (tablesWithoutRls.length) {
      console.error(
        `Public tables without RLS: ${tablesWithoutRls.map(({ tableName }) => tableName).join(", ")}`
      );
    }
    if (dataApiGrants.length) {
      console.error(
        `Unexpected Data API table grants: ${dataApiGrants
          .map(({ grantee, objectName, privilege }) => `${grantee}:${objectName}:${privilege}`)
          .join(", ")}`
      );
    }
    if (tablesWithoutRuntimePolicy.length) {
      console.error(
        `Public tables without quest_runtime policy: ${tablesWithoutRuntimePolicy
          .map(({ tableName }) => tableName)
          .join(", ")}`
      );
    }
    if (migrationRuntimeAccess.length) {
      console.error(
        `Unexpected quest_runtime access to _prisma_migrations: ${migrationRuntimeAccess
          .map(({ policyName, objectName, privilege }) => policyName || `${objectName || "_prisma_migrations"}:${privilege}`)
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
    process.exitCode = 1;
    return;
  }

  console.log("Database security verification passed: public RLS enabled and Data API table grants absent.");
};

verify()
  .catch((error) => {
    console.error("Database security verification failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
