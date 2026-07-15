-- Add the category/content layer first so this migration is safe with the existing frontend.
CREATE TABLE "game_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "artwork_name" TEXT,
    "logo_name" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_categories_slug_key" ON "game_categories"("slug");
CREATE INDEX "game_categories_is_published_display_order_idx" ON "game_categories"("is_published", "display_order");

ALTER TABLE "tournaments"
  ADD COLUMN "game_category_id" UUID,
  ADD COLUMN "organizer" TEXT NOT NULL DEFAULT 'Quest E-sports',
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'Sri Lanka',
  ADD COLUMN "location" TEXT NOT NULL DEFAULT 'TBA',
  ADD COLUMN "hero_image_name" TEXT;

CREATE INDEX "tournaments_game_category_id_idx" ON "tournaments"("game_category_id");
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_game_category_id_fkey"
  FOREIGN KEY ("game_category_id") REFERENCES "game_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tournament_sponsors" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logo_image_name" TEXT,
    "website_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tournament_sponsors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tournament_sponsors_tournament_id_display_order_idx" ON "tournament_sponsors"("tournament_id", "display_order");
ALTER TABLE "tournament_sponsors" ADD CONSTRAINT "tournament_sponsors_tournament_id_fkey"
  FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_teams" ADD COLUMN "organization_name" TEXT;

INSERT INTO "game_categories" ("id", "slug", "display_name", "display_order", "is_published", "updated_at") VALUES
  ('3e1abfa6-8039-4ad0-b53a-100000000001', 'valorant', 'Valorant', 10, true, CURRENT_TIMESTAMP),
  ('3e1abfa6-8039-4ad0-b53a-100000000002', 'pubg-mobile', 'PUBG Mobile', 20, true, CURRENT_TIMESTAMP),
  ('3e1abfa6-8039-4ad0-b53a-100000000003', 'mlbb', 'Mobile Legends: Bang Bang', 30, true, CURRENT_TIMESTAMP),
  ('3e1abfa6-8039-4ad0-b53a-100000000004', 'codm', 'Call of Duty: Mobile', 40, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "tournaments" SET "game_category_id" = '3e1abfa6-8039-4ad0-b53a-100000000001'
WHERE lower("game") LIKE '%valorant%';
UPDATE "tournaments" SET "game_category_id" = '3e1abfa6-8039-4ad0-b53a-100000000002'
WHERE lower("game") LIKE '%pubg%';
UPDATE "tournaments" SET "game_category_id" = '3e1abfa6-8039-4ad0-b53a-100000000003'
WHERE lower("game") LIKE '%mobile legends%' OR lower("game") = 'mlbb';
UPDATE "tournaments" SET "game_category_id" = '3e1abfa6-8039-4ad0-b53a-100000000004'
WHERE lower("game") LIKE '%call of duty%' OR lower("game") = 'codm';
