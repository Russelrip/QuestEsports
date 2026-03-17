-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "RegistrationMemberRole" AS ENUM ('CAPTAIN', 'PLAYER', 'SUBSTITUTE', 'COACH');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "username_normalized" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "phone" TEXT,
    "discord_tag" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_registrations" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "team_name" TEXT NOT NULL,
    "captain_name" TEXT NOT NULL,
    "captain_email" TEXT NOT NULL,
    "captain_phone" TEXT NOT NULL,
    "captain_discord" TEXT NOT NULL,
    "captain_riot_id" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "team_logo_name" TEXT,
    "rulebook_accepted" BOOLEAN NOT NULL DEFAULT false,
    "falsity_warning_accepted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_members" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "role" "RegistrationMemberRole" NOT NULL,
    "member_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "discord" TEXT,
    "riot_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_normalized_key" ON "users"("username_normalized");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE INDEX "tournaments_is_active_idx" ON "tournaments"("is_active");

-- CreateIndex
CREATE INDEX "team_registrations_tournament_id_idx" ON "team_registrations"("tournament_id");

-- CreateIndex
CREATE INDEX "team_registrations_created_at_idx" ON "team_registrations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "team_registrations_tournament_id_team_name_key" ON "team_registrations"("tournament_id", "team_name");

-- CreateIndex
CREATE UNIQUE INDEX "team_registrations_tournament_id_captain_email_key" ON "team_registrations"("tournament_id", "captain_email");

-- CreateIndex
CREATE INDEX "registration_members_registration_id_idx" ON "registration_members"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_members_registration_id_role_member_order_key" ON "registration_members"("registration_id", "role", "member_order");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_registrations" ADD CONSTRAINT "team_registrations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
