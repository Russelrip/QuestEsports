CREATE TABLE "event_albums" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "tournament_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "event_date" TIMESTAMP(3),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "allow_downloads" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_albums_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "album_photos" (
    "id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "image_asset_id" UUID NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_albums_slug_key" ON "event_albums"("slug");
CREATE INDEX "event_albums_is_published_event_date_idx" ON "event_albums"("is_published", "event_date");
CREATE INDEX "event_albums_tournament_id_idx" ON "event_albums"("tournament_id");
CREATE INDEX "event_albums_created_at_idx" ON "event_albums"("created_at");
CREATE UNIQUE INDEX "album_photos_album_id_image_asset_id_key" ON "album_photos"("album_id", "image_asset_id");
CREATE INDEX "album_photos_album_id_position_idx" ON "album_photos"("album_id", "position");
CREATE INDEX "album_photos_image_asset_id_idx" ON "album_photos"("image_asset_id");

ALTER TABLE "event_albums"
ADD CONSTRAINT "event_albums_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "album_photos"
ADD CONSTRAINT "album_photos_album_id_fkey"
FOREIGN KEY ("album_id") REFERENCES "event_albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "album_photos"
ADD CONSTRAINT "album_photos_image_asset_id_fkey"
FOREIGN KEY ("image_asset_id") REFERENCES "image_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."event_albums" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."album_photos" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."event_albums",
  public."album_photos"
FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."event_albums", public."album_photos" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
