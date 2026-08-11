CREATE TABLE "event_expenses" (
  "id" UUID NOT NULL,
  "tournament_id" UUID,
  "ticket_event_id" UUID,
  "created_by_id" UUID,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "vendor" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'LKR',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expense_date" DATE NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_expenses_one_target_check" CHECK (
    (("tournament_id" IS NOT NULL)::integer + ("ticket_event_id" IS NOT NULL)::integer) = 1
  ),
  CONSTRAINT "event_expenses_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "event_expenses_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "event_expenses_status_check" CHECK ("status" IN ('pending', 'paid', 'cancelled'))
);

CREATE INDEX "event_expenses_tournament_id_expense_date_idx" ON "event_expenses"("tournament_id", "expense_date");
CREATE INDEX "event_expenses_ticket_event_id_expense_date_idx" ON "event_expenses"("ticket_event_id", "expense_date");
CREATE INDEX "event_expenses_status_expense_date_idx" ON "event_expenses"("status", "expense_date");
CREATE INDEX "event_expenses_created_by_id_idx" ON "event_expenses"("created_by_id");

ALTER TABLE "event_expenses"
  ADD CONSTRAINT "event_expenses_tournament_id_fkey"
  FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_expenses"
  ADD CONSTRAINT "event_expenses_ticket_event_id_fkey"
  FOREIGN KEY ("ticket_event_id") REFERENCES "ticket_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_expenses"
  ADD CONSTRAINT "event_expenses_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."event_expenses" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."event_expenses" FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."event_expenses" FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
