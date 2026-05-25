ALTER TABLE "saved_team_members"
ADD COLUMN "invite_expires_at" TIMESTAMP(3);

CREATE TABLE "rate_limit_buckets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_buckets_name_key_key"
ON "rate_limit_buckets"("name", "key");

CREATE INDEX "rate_limit_buckets_reset_at_idx"
ON "rate_limit_buckets"("reset_at");
