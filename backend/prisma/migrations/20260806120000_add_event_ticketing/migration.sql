ALTER TYPE "PaymentPurpose" ADD VALUE 'ticket_order';

CREATE TYPE "TicketEventStatus" AS ENUM (
  'draft',
  'on_sale',
  'sales_paused',
  'sales_closed',
  'completed',
  'cancelled'
);

CREATE TYPE "TicketOrderStatus" AS ENUM (
  'pending_payment',
  'paid',
  'cancelled',
  'expired',
  'refunded'
);

CREATE TYPE "TicketStatus" AS ENUM (
  'pending',
  'valid',
  'checked_in',
  'cancelled',
  'refunded'
);

CREATE TYPE "TicketScanResult" AS ENUM (
  'accepted',
  'already_used',
  'invalid_code',
  'invalid_status',
  'wrong_event'
);

CREATE TABLE "ticket_events" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "sales_start_at" TIMESTAMP(3) NOT NULL,
  "sales_end_at" TIMESTAMP(3) NOT NULL,
  "status" "TicketEventStatus" NOT NULL DEFAULT 'draft',
  "capacity" INTEGER NOT NULL,
  "max_tickets_per_order" INTEGER NOT NULL DEFAULT 10,
  "currency" TEXT NOT NULL DEFAULT 'LKR',
  "single_price" DECIMAL(12,2) NOT NULL,
  "pair_price" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_events_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "ticket_events_max_per_order_check" CHECK ("max_tickets_per_order" > 0),
  CONSTRAINT "ticket_events_prices_check" CHECK ("single_price" >= 0 AND "pair_price" >= 0),
  CONSTRAINT "ticket_events_sales_window_check" CHECK ("sales_end_at" > "sales_start_at")
);

CREATE TABLE "ticket_orders" (
  "id" UUID NOT NULL,
  "public_token" TEXT NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID,
  "email" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "pair_count" INTEGER NOT NULL,
  "single_count" INTEGER NOT NULL,
  "pair_price" DECIMAL(12,2) NOT NULL,
  "single_price" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'LKR',
  "total" DECIMAL(12,2) NOT NULL,
  "status" "TicketOrderStatus" NOT NULL DEFAULT 'pending_payment',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "capacity_released_at" TIMESTAMP(3),
  "confirmation_email_queued_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_orders_quantity_check" CHECK (
    "quantity" > 0
    AND "pair_count" >= 0
    AND "single_count" IN (0, 1)
    AND "quantity" = ("pair_count" * 2) + "single_count"
  ),
  CONSTRAINT "ticket_orders_total_check" CHECK ("total" >= 0)
);

CREATE TABLE "tickets" (
  "id" UUID NOT NULL,
  "ticket_number" TEXT NOT NULL,
  "order_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "token_version" INTEGER NOT NULL DEFAULT 1,
  "status" "TicketStatus" NOT NULL DEFAULT 'pending',
  "checked_in_at" TIMESTAMP(3),
  "checked_in_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tickets_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "tickets_token_version_check" CHECK ("token_version" > 0)
);

CREATE TABLE "ticket_scans" (
  "id" UUID NOT NULL,
  "event_id" UUID,
  "ticket_id" UUID,
  "scanned_by_id" UUID NOT NULL,
  "result" "TicketScanResult" NOT NULL,
  "detail" TEXT,
  "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_events_slug_key" ON "ticket_events"("slug");
CREATE INDEX "ticket_events_status_starts_at_idx" ON "ticket_events"("status", "starts_at");
CREATE INDEX "ticket_events_sales_start_at_sales_end_at_idx" ON "ticket_events"("sales_start_at", "sales_end_at");
CREATE UNIQUE INDEX "ticket_orders_public_token_key" ON "ticket_orders"("public_token");
CREATE INDEX "ticket_orders_event_id_status_created_at_idx" ON "ticket_orders"("event_id", "status", "created_at");
CREATE INDEX "ticket_orders_user_id_created_at_idx" ON "ticket_orders"("user_id", "created_at");
CREATE INDEX "ticket_orders_status_expires_at_idx" ON "ticket_orders"("status", "expires_at");
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");
CREATE UNIQUE INDEX "tickets_order_id_sequence_key" ON "tickets"("order_id", "sequence");
CREATE INDEX "tickets_event_id_status_idx" ON "tickets"("event_id", "status");
CREATE INDEX "tickets_checked_in_by_id_idx" ON "tickets"("checked_in_by_id");
CREATE INDEX "ticket_scans_event_id_scanned_at_idx" ON "ticket_scans"("event_id", "scanned_at");
CREATE INDEX "ticket_scans_ticket_id_scanned_at_idx" ON "ticket_scans"("ticket_id", "scanned_at");
CREATE INDEX "ticket_scans_scanned_by_id_scanned_at_idx" ON "ticket_scans"("scanned_by_id", "scanned_at");

ALTER TABLE "ticket_orders"
  ADD CONSTRAINT "ticket_orders_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "ticket_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_orders"
  ADD CONSTRAINT "ticket_orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "ticket_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_checked_in_by_id_fkey"
  FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_scans"
  ADD CONSTRAINT "ticket_scans_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "ticket_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_scans"
  ADD CONSTRAINT "ticket_scans_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_scans"
  ADD CONSTRAINT "ticket_scans_scanned_by_id_fkey"
  FOREIGN KEY ("scanned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_transactions" ADD COLUMN "ticket_order_id" UUID;
CREATE INDEX "payment_transactions_ticket_order_id_idx" ON "payment_transactions"("ticket_order_id");
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_ticket_order_id_fkey"
  FOREIGN KEY ("ticket_order_id") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_transactions" DROP CONSTRAINT "payment_transactions_target_check";
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_target_check" CHECK (
    (("registration_id" IS NOT NULL)::integer
      + ("merchandise_order_id" IS NOT NULL)::integer
      + ("ticket_order_id" IS NOT NULL)::integer) = 1
  );

ALTER TABLE public."ticket_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ticket_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ticket_scans" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."ticket_events",
  public."ticket_orders",
  public."tickets",
  public."ticket_scans"
FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."ticket_events", public."ticket_orders", public."tickets", public."ticket_scans" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
