ALTER TABLE "image_assets"
ADD COLUMN "stored_filename" TEXT,
ADD COLUMN "byte_size" INTEGER;

ALTER TABLE "image_assets"
ALTER COLUMN "data" DROP NOT NULL;
