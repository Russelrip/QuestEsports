CREATE TYPE "BackgroundJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "background_jobs_status_available_at_idx"
ON "background_jobs"("status", "available_at");

CREATE INDEX "background_jobs_locked_at_idx"
ON "background_jobs"("locked_at");

CREATE INDEX "background_jobs_created_at_idx"
ON "background_jobs"("created_at");
