CREATE TABLE "support_message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_message_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_message_attachments_position_check" CHECK ("position" >= 0 AND "position" < 3),
    CONSTRAINT "support_message_attachments_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 5242880),
    CONSTRAINT "support_message_attachments_content_type_check" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE UNIQUE INDEX "support_message_attachments_message_id_position_key"
ON "support_message_attachments"("message_id", "position");
CREATE INDEX "support_message_attachments_message_id_created_at_idx"
ON "support_message_attachments"("message_id", "created_at");

ALTER TABLE "support_message_attachments"
ADD CONSTRAINT "support_message_attachments_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."support_message_attachments" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO quest_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public."support_message_attachments"
TO quest_runtime;

DROP POLICY IF EXISTS support_message_attachments_runtime_all
ON public."support_message_attachments";
CREATE POLICY support_message_attachments_runtime_all
ON public."support_message_attachments"
FOR ALL TO quest_runtime
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."support_message_attachments" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."support_message_attachments" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
