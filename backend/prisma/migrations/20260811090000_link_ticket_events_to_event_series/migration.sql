ALTER TABLE "ticket_events"
  ADD COLUMN "series_id" UUID,
  ADD COLUMN "payment_methods" JSONB NOT NULL DEFAULT '["payhere"]',
  ADD COLUMN "bank_transfer_review_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_branch" TEXT,
  ADD COLUMN "bank_account_name" TEXT,
  ADD COLUMN "bank_account_number" TEXT;

ALTER TABLE "ticket_events"
  ADD CONSTRAINT "ticket_events_bank_review_minutes_check"
  CHECK ("bank_transfer_review_minutes" > 0);

CREATE UNIQUE INDEX "ticket_events_series_id_key" ON "ticket_events"("series_id");

ALTER TABLE "ticket_events"
  ADD CONSTRAINT "ticket_events_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
