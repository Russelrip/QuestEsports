ALTER TABLE "tournaments"
ADD COLUMN "display_priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "schedule_file_name" TEXT,
ADD COLUMN "schedule_data" JSONB,
ADD COLUMN "completed_poster_image_name" TEXT,
ADD COLUMN "first_place_image_name" TEXT,
ADD COLUMN "second_place_image_name" TEXT,
ADD COLUMN "third_place_image_name" TEXT;

CREATE INDEX "tournaments_display_priority_start_date_idx"
ON "tournaments"("display_priority", "start_date");
