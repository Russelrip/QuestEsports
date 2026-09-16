-- Super admins and Discord-style staff roles.
--
-- `users.is_super_admin` marks the owner tier. A super admin is always an admin
-- as well, so every existing admin guard keeps admitting them; the check below
-- makes that impossible to break by demoting one without clearing the flag.
--
-- Staff roles replace per-user staff permission grants: a role is a named set
-- of admin areas, and a user holds any number of roles. Every existing grant is
-- carried into a role here, so nobody gains or loses access on deploy.
--
-- Additive: `user_staff_permissions` and the `StaffPermission` enum stay so the
-- previous release can still run; a later migration drops them.

ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
ADD CONSTRAINT "users_super_admin_is_admin_check"
CHECK (NOT "is_super_admin" OR "role" = 'admin');

-- `id` and `updated_at` carry no database default: Prisma sets both client-side,
-- and a DB-side default is drift that fails `prisma migrate diff`.
CREATE TABLE "staff_roles" (
  "id"                 UUID         NOT NULL,
  "name"               TEXT         NOT NULL,
  "description"        TEXT,
  "color"              TEXT,
  "permissions"        TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" UUID,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_roles_name_key" ON "staff_roles"("name");

CREATE TABLE "user_staff_roles" (
  "id"                 UUID         NOT NULL,
  "user_id"            UUID         NOT NULL,
  "role_id"            UUID         NOT NULL,
  "granted_by_user_id" UUID,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_staff_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_staff_roles_user_id_role_id_key"
ON "user_staff_roles"("user_id", "role_id");
CREATE INDEX "user_staff_roles_role_id_idx" ON "user_staff_roles"("role_id");

-- Deleting a user removes the roles they hold; deleting the admin who created a
-- role or assigned one keeps it and forgets who did (the audit log still says).
ALTER TABLE "staff_roles"
ADD CONSTRAINT "staff_roles_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_staff_roles"
ADD CONSTRAINT "user_staff_roles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_staff_roles"
ADD CONSTRAINT "user_staff_roles_role_id_fkey"
FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_staff_roles"
ADD CONSTRAINT "user_staff_roles_granted_by_user_id_fkey"
FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry existing grants over. `valorant_leaderboard` is the only area the enum
-- has ever had; its holders get a role granting exactly that area.
INSERT INTO "staff_roles" ("id", "name", "description", "permissions", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'VALORANT Leaderboard',
  'Carried over from individual staff access grants.',
  ARRAY['valorant_leaderboard']::TEXT[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "user_staff_permissions" WHERE "permission" = 'valorant_leaderboard'
);

INSERT INTO "user_staff_roles" ("id", "user_id", "role_id", "granted_by_user_id", "created_at")
SELECT gen_random_uuid(), grant_row."user_id", role_row."id", grant_row."granted_by_user_id", grant_row."created_at"
FROM "user_staff_permissions" AS grant_row
JOIN "staff_roles" AS role_row ON role_row."name" = 'VALORANT Leaderboard'
WHERE grant_row."permission" = 'valorant_leaderboard';

ALTER TABLE public."staff_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_staff_roles" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public."staff_roles", public."user_staff_roles"
TO quest_runtime;

DROP POLICY IF EXISTS staff_roles_runtime_all ON public."staff_roles";
CREATE POLICY staff_roles_runtime_all
ON public."staff_roles"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS user_staff_roles_runtime_all ON public."user_staff_roles";
CREATE POLICY user_staff_roles_runtime_all
ON public."user_staff_roles"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."staff_roles", public."user_staff_roles" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."staff_roles", public."user_staff_roles" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
