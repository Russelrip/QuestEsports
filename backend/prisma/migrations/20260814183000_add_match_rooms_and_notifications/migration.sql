CREATE TYPE "MatchRoomMemberRole" AS ENUM ('player', 'captain', 'staff');
CREATE TYPE "MatchRoomMessageKind" AS ENUM ('player', 'staff', 'system');
CREATE TYPE "MatchSupportStatus" AS ENUM ('open', 'resolved');

CREATE TABLE "match_rooms" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "chat_locked_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "match_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_room_members" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_slot" INTEGER,
    "role" "MatchRoomMemberRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),
    "notifications_muted" BOOLEAN NOT NULL DEFAULT false,
    "muted_until" TIMESTAMP(3),
    CONSTRAINT "match_room_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_room_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "kind" "MatchRoomMessageKind" NOT NULL DEFAULT 'player',
    "body" TEXT NOT NULL,
    "hidden_at" TIMESTAMP(3),
    "hidden_by_user_id" UUID,
    "hidden_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_room_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_support_requests" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "opened_by_user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "MatchSupportStatus" NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "match_support_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_support_messages" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "match_room_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_recipients" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "web_push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_notification_preferences" (
    "user_id" UUID NOT NULL,
    "match_push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "match_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "match_rooms_match_id_key" ON "match_rooms"("match_id");
CREATE UNIQUE INDEX "match_rooms_code_key" ON "match_rooms"("code");
CREATE INDEX "match_rooms_last_message_at_idx" ON "match_rooms"("last_message_at");
CREATE INDEX "match_rooms_created_at_idx" ON "match_rooms"("created_at");
CREATE UNIQUE INDEX "match_room_members_room_id_user_id_key" ON "match_room_members"("room_id", "user_id");
CREATE INDEX "match_room_members_user_id_last_read_at_idx" ON "match_room_members"("user_id", "last_read_at");
CREATE INDEX "match_room_members_room_id_role_idx" ON "match_room_members"("room_id", "role");
CREATE INDEX "match_room_messages_room_id_created_at_idx" ON "match_room_messages"("room_id", "created_at");
CREATE INDEX "match_room_messages_sender_user_id_created_at_idx" ON "match_room_messages"("sender_user_id", "created_at");
CREATE INDEX "match_support_requests_room_id_status_created_at_idx" ON "match_support_requests"("room_id", "status", "created_at");
CREATE INDEX "match_support_requests_opened_by_user_id_created_at_idx" ON "match_support_requests"("opened_by_user_id", "created_at");
CREATE INDEX "match_support_messages_request_id_created_at_idx" ON "match_support_messages"("request_id", "created_at");
CREATE INDEX "match_support_messages_sender_user_id_created_at_idx" ON "match_support_messages"("sender_user_id", "created_at");
CREATE UNIQUE INDEX "notifications_event_key_key" ON "notifications"("event_key");
CREATE INDEX "notifications_match_room_id_created_at_idx" ON "notifications"("match_room_id", "created_at");
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");
CREATE UNIQUE INDEX "notification_recipients_notification_id_user_id_key" ON "notification_recipients"("notification_id", "user_id");
CREATE INDEX "notification_recipients_user_id_read_at_created_at_idx" ON "notification_recipients"("user_id", "read_at", "created_at");
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_user_id_revoked_at_idx" ON "web_push_subscriptions"("user_id", "revoked_at");
CREATE INDEX "web_push_subscriptions_last_used_at_idx" ON "web_push_subscriptions"("last_used_at");

ALTER TABLE "match_rooms" ADD CONSTRAINT "match_rooms_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_room_members" ADD CONSTRAINT "match_room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "match_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_room_members" ADD CONSTRAINT "match_room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_room_messages" ADD CONSTRAINT "match_room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "match_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_room_messages" ADD CONSTRAINT "match_room_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "match_room_messages" ADD CONSTRAINT "match_room_messages_hidden_by_user_id_fkey" FOREIGN KEY ("hidden_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "match_support_requests" ADD CONSTRAINT "match_support_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "match_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_support_requests" ADD CONSTRAINT "match_support_requests_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_support_requests" ADD CONSTRAINT "match_support_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "match_support_messages" ADD CONSTRAINT "match_support_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "match_support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_support_messages" ADD CONSTRAINT "match_support_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_match_room_id_fkey" FOREIGN KEY ("match_room_id") REFERENCES "match_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."match_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."match_room_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."match_room_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."match_support_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."match_support_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notification_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."web_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_notification_preferences" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public."match_rooms", public."match_room_members", public."match_room_messages", public."match_support_requests", public."match_support_messages", public."notifications", public."notification_recipients", public."web_push_subscriptions", public."user_notification_preferences" FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."match_rooms", public."match_room_members", public."match_room_messages", public."match_support_requests", public."match_support_messages", public."notifications", public."notification_recipients", public."web_push_subscriptions", public."user_notification_preferences" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
