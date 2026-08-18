CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'PENDING_USER', 'PENDING_STAFF', 'RESOLVED');

CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_staff_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_conversation_reads" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_conversation_reads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_conversations_owner_user_id_status_updated_at_idx"
ON "support_conversations"("owner_user_id", "status", "updated_at");
CREATE INDEX "support_conversations_assigned_staff_user_id_status_updated_at_idx"
ON "support_conversations"("assigned_staff_user_id", "status", "updated_at");
CREATE INDEX "support_messages_conversation_id_created_at_idx"
ON "support_messages"("conversation_id", "created_at");
CREATE INDEX "support_messages_sender_user_id_created_at_idx"
ON "support_messages"("sender_user_id", "created_at");
CREATE UNIQUE INDEX "support_conversation_reads_conversation_id_user_id_key"
ON "support_conversation_reads"("conversation_id", "user_id");
CREATE INDEX "support_conversation_reads_user_id_last_read_at_idx"
ON "support_conversation_reads"("user_id", "last_read_at");

ALTER TABLE "support_conversations"
ADD CONSTRAINT "support_conversations_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_conversations"
ADD CONSTRAINT "support_conversations_assigned_staff_user_id_fkey"
FOREIGN KEY ("assigned_staff_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_sender_user_id_fkey"
FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_conversation_reads"
ADD CONSTRAINT "support_conversation_reads_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_conversation_reads"
ADD CONSTRAINT "support_conversation_reads_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."support_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_conversation_reads" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."support_conversations",
  public."support_messages",
  public."support_conversation_reads"
FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."support_conversations", public."support_messages", public."support_conversation_reads" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
