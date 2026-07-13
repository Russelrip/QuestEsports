CREATE TYPE "TournamentEntryType" AS ENUM ('team', 'solo');
CREATE TYPE "PaymentPurpose" AS ENUM ('tournament_registration', 'merchandise_order');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('created', 'pending', 'paid', 'cancelled', 'failed', 'charged_back', 'expired', 'review_required');
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'active', 'archived');
CREATE TYPE "MerchandiseOrderStatus" AS ENUM ('pending_payment', 'paid', 'processing', 'fulfilled', 'cancelled', 'refunded');

ALTER TABLE "users"
ADD COLUMN "avatar_image_name" TEXT;

CREATE TABLE "event_series" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hero_image_name" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_series_slug_key" ON "event_series"("slug");
CREATE INDEX "event_series_is_published_display_order_idx" ON "event_series"("is_published", "display_order");

ALTER TABLE "tournaments"
ADD COLUMN "series_id" UUID,
ADD COLUMN "series_order" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "entry_type" "TournamentEntryType" NOT NULL DEFAULT 'team',
ADD COLUMN "min_roster_size" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "max_roster_size" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "max_substitutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "registration_fields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "registration_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "registration_fee_currency" TEXT NOT NULL DEFAULT 'LKR',
ADD COLUMN "reservation_minutes" INTEGER NOT NULL DEFAULT 15;

UPDATE "tournaments"
SET "min_roster_size" = GREATEST("team_size", 1),
    "max_roster_size" = GREATEST("team_size", 1),
    "max_substitutes" = 2;

UPDATE "team_registrations" AS registration
SET "payment_status" = 'paid'
FROM "tournaments" AS tournament
WHERE registration."tournament_id" = tournament."id"
  AND tournament."registration_fee_amount" = 0
  AND registration."payment_status" = 'unpaid';

DROP INDEX IF EXISTS "team_registrations_tournament_id_team_name_key";
CREATE INDEX "team_registrations_tournament_id_team_name_idx"
ON "team_registrations"("tournament_id", "team_name");

CREATE INDEX "tournaments_series_id_series_order_idx" ON "tournaments"("series_id", "series_order");
ALTER TABLE "tournaments"
ADD CONSTRAINT "tournaments_series_id_fkey"
FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_registrations"
ADD COLUMN "user_id" UUID,
ADD COLUMN "entry_type" "TournamentEntryType" NOT NULL DEFAULT 'team',
ADD COLUMN "additional_data" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "reserved_until" TIMESTAMP(3);

ALTER TABLE "registration_members"
ADD COLUMN "additional_data" JSONB NOT NULL DEFAULT '{}';

UPDATE "team_registrations" AS registration
SET "user_id" = team."captain_user_id"
FROM "saved_teams" AS team
WHERE registration."saved_team_id" = team."id";

UPDATE "team_registrations" AS registration
SET "user_id" = member."user_id"
FROM "registration_members" AS member
WHERE registration."user_id" IS NULL
  AND member."registration_id" = registration."id"
  AND member."role" = 'CAPTAIN'
  AND member."user_id" IS NOT NULL;

UPDATE "team_registrations" AS registration
SET "user_id" = account."id"
FROM "users" AS account
WHERE registration."user_id" IS NULL
  AND account."email_normalized" = LOWER(TRIM(registration."captain_email"));

CREATE INDEX "team_registrations_user_id_created_at_idx" ON "team_registrations"("user_id", "created_at");
CREATE INDEX "team_registrations_reserved_until_idx" ON "team_registrations"("reserved_until");
ALTER TABLE "team_registrations"
ADD CONSTRAINT "team_registrations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "made_to_order" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_status_display_order_idx" ON "products"("status", "display_order");

CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX "product_variants_product_id_is_active_idx" ON "product_variants"("product_id", "is_active");
ALTER TABLE "product_variants"
ADD CONSTRAINT "product_variants_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "image_asset_id" UUID NOT NULL,
    "alt_text" TEXT NOT NULL DEFAULT '',
    "display_order" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_images_product_id_image_asset_id_key" ON "product_images"("product_id", "image_asset_id");
CREATE INDEX "product_images_product_id_display_order_idx" ON "product_images"("product_id", "display_order");
ALTER TABLE "product_images"
ADD CONSTRAINT "product_images_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_images"
ADD CONSTRAINT "product_images_image_asset_id_fkey"
FOREIGN KEY ("image_asset_id") REFERENCES "image_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "merchandise_orders" (
    "id" UUID NOT NULL,
    "public_token" TEXT NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Sri Lanka',
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "MerchandiseOrderStatus" NOT NULL DEFAULT 'pending_payment',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "inventory_released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchandise_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchandise_orders_public_token_key" ON "merchandise_orders"("public_token");
CREATE INDEX "merchandise_orders_user_id_created_at_idx" ON "merchandise_orders"("user_id", "created_at");
CREATE INDEX "merchandise_orders_status_created_at_idx" ON "merchandise_orders"("status", "created_at");
CREATE INDEX "merchandise_orders_status_expires_at_idx" ON "merchandise_orders"("status", "expires_at");
ALTER TABLE "merchandise_orders"
ADD CONSTRAINT "merchandise_orders_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "merchandise_order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "merchandise_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "merchandise_order_items_order_id_idx" ON "merchandise_order_items"("order_id");
CREATE INDEX "merchandise_order_items_variant_id_idx" ON "merchandise_order_items"("variant_id");
ALTER TABLE "merchandise_order_items"
ADD CONSTRAINT "merchandise_order_items_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "merchandise_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchandise_order_items"
ADD CONSTRAINT "merchandise_order_items_variant_id_fkey"
FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'created',
    "provider" TEXT NOT NULL DEFAULT 'payhere',
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "registration_id" UUID,
    "merchandise_order_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT,
    "status_message" TEXT,
    "notification_digest" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transactions_target_check" CHECK (
      ("registration_id" IS NOT NULL AND "merchandise_order_id" IS NULL)
      OR ("registration_id" IS NULL AND "merchandise_order_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "payment_transactions_provider_order_id_key" ON "payment_transactions"("provider_order_id");
CREATE UNIQUE INDEX "payment_transactions_provider_payment_id_key" ON "payment_transactions"("provider_payment_id");
CREATE INDEX "payment_transactions_registration_id_idx" ON "payment_transactions"("registration_id");
CREATE INDEX "payment_transactions_merchandise_order_id_idx" ON "payment_transactions"("merchandise_order_id");
CREATE INDEX "payment_transactions_status_created_at_idx" ON "payment_transactions"("status", "created_at");
ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_registration_id_fkey"
FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_merchandise_order_id_fkey"
FOREIGN KEY ("merchandise_order_id") REFERENCES "merchandise_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_notification_audits" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "notification_digest" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "applied_status" "PaymentTransactionStatus" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_notification_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_notification_audits_transaction_id_created_at_idx"
ON "payment_notification_audits"("transaction_id", "created_at");
CREATE INDEX "payment_notification_audits_notification_digest_idx"
ON "payment_notification_audits"("notification_digest");
ALTER TABLE "payment_notification_audits"
ADD CONSTRAINT "payment_notification_audits_transaction_id_fkey"
FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
