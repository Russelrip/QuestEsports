-- Delegated admin areas.
--
-- `users.role` is all-or-nothing: `admin` opens every admin route. This lets a
-- non-admin be given one area (the VALORANT leaderboard, to start) without the
-- rest. Admins are unaffected and hold every area implicitly, so no row is ever
-- needed for them.
--
-- Additive: no existing table, column or enum is touched.

CREATE TYPE "StaffPermission" AS ENUM ('valorant_leaderboard');

-- `id` carries no database default: Prisma generates it client-side, and a
-- DB-side default is drift that fails `prisma migrate diff`.
CREATE TABLE "user_staff_permissions" (
  "id"                 UUID              NOT NULL,
  "user_id"            UUID              NOT NULL,
  "permission"         "StaffPermission" NOT NULL,
  "granted_by_user_id" UUID,
  "created_at"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_staff_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_staff_permissions_user_id_permission_key"
ON "user_staff_permissions"("user_id", "permission");
CREATE INDEX "user_staff_permissions_permission_idx"
ON "user_staff_permissions"("permission");

-- Deleting the user removes their grants; deleting the admin who granted one
-- keeps the grant and forgets who gave it (the audit log still says).
ALTER TABLE "user_staff_permissions"
ADD CONSTRAINT "user_staff_permissions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_staff_permissions"
ADD CONSTRAINT "user_staff_permissions_granted_by_user_id_fkey"
FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."user_staff_permissions" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public."user_staff_permissions"
TO quest_runtime;

DROP POLICY IF EXISTS user_staff_permissions_runtime_all
ON public."user_staff_permissions";
CREATE POLICY user_staff_permissions_runtime_all
ON public."user_staff_permissions"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."user_staff_permissions" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."user_staff_permissions" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
