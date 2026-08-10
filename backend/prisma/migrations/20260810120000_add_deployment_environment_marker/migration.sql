CREATE TABLE "deployment_environment" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "environment" TEXT NOT NULL,
  "project_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deployment_environment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deployment_environment_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "deployment_environment_name_check" CHECK (
    "environment" IN ('production', 'staging', 'development', 'test')
  )
);

CREATE UNIQUE INDEX "deployment_environment_environment_key"
ON "deployment_environment"("environment");

ALTER TABLE public."deployment_environment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."deployment_environment" FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."deployment_environment" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
