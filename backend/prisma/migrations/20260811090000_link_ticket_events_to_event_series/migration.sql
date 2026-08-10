ALTER TABLE "ticket_events" ADD COLUMN "series_id" UUID;

CREATE UNIQUE INDEX "ticket_events_series_id_key" ON "ticket_events"("series_id");

ALTER TABLE "ticket_events"
  ADD CONSTRAINT "ticket_events_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
