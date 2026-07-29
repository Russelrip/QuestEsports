const { prisma } = require("../src/lib/prisma");

const verify = async () => {
  const tablesWithoutRls = await prisma.$queryRaw`
    SELECT c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
    ORDER BY c.relname
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

  if (tablesWithoutRls.length || dataApiGrants.length) {
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
