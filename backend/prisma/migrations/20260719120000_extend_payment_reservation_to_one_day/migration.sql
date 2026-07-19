ALTER TABLE "tournaments"
ALTER COLUMN "reservation_minutes" SET DEFAULT 1440;

UPDATE "tournaments"
SET "reservation_minutes" = 1440
WHERE "reservation_minutes" = 15;
