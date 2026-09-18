-- Event-level sponsors, shown in the event hero belt ahead of the child
-- tournaments' own sponsors. Additive only: a new table, no existing rows touched.
CREATE TABLE "event_sponsors" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partnership_label" TEXT NOT NULL DEFAULT 'Official Sponsor',
    "logo_image_name" TEXT,
    "website_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_sponsors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_sponsors_series_id_display_order_idx" ON "event_sponsors"("series_id", "display_order");
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
