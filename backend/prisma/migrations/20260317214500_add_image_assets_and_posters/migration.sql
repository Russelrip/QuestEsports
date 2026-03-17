-- CreateTable
CREATE TABLE "image_assets" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "original_name" TEXT,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posters" (
    "id" UUID NOT NULL,
    "image_asset_id" UUID NOT NULL,
    "tournament_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'poster',
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "accent_color" TEXT NOT NULL DEFAULT '#7c3aed',
    "text_color" TEXT NOT NULL DEFAULT '#ffffff',
    "overlay_align" TEXT NOT NULL DEFAULT 'bottom-left',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_assets_category_created_at_idx" ON "image_assets"("category", "created_at");

-- CreateIndex
CREATE INDEX "image_assets_created_at_idx" ON "image_assets"("created_at");

-- CreateIndex
CREATE INDEX "posters_image_asset_id_idx" ON "posters"("image_asset_id");

-- CreateIndex
CREATE INDEX "posters_tournament_id_idx" ON "posters"("tournament_id");

-- CreateIndex
CREATE INDEX "posters_category_created_at_idx" ON "posters"("category", "created_at");

-- CreateIndex
CREATE INDEX "posters_created_at_idx" ON "posters"("created_at");

-- AddForeignKey
ALTER TABLE "posters"
ADD CONSTRAINT "posters_image_asset_id_fkey"
FOREIGN KEY ("image_asset_id") REFERENCES "image_assets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posters"
ADD CONSTRAINT "posters_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
