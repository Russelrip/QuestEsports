-- AlterTable
ALTER TABLE "users"
ADD COLUMN "pending_email" TEXT,
ADD COLUMN "pending_email_normalized" TEXT;

-- CreateTable
CREATE TABLE "email_change_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "next_email" TEXT NOT NULL,
    "next_email_normalized" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_pending_email_normalized_key" ON "users"("pending_email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_tokens_token_hash_key" ON "email_change_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_change_tokens_user_id_idx" ON "email_change_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_change_tokens_next_email_normalized_idx" ON "email_change_tokens"("next_email_normalized");

-- CreateIndex
CREATE INDEX "email_change_tokens_expires_at_idx" ON "email_change_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
