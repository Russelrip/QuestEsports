ALTER TYPE "PaymentTransactionStatus" ADD VALUE IF NOT EXISTS 'refunded';

ALTER TABLE "payment_transactions"
  ADD COLUMN "reconciled_at" TIMESTAMP(3),
  ADD COLUMN "reconciled_by_id" UUID,
  ADD COLUMN "reconciliation_note" TEXT,
  ADD COLUMN "provider_refund_id" TEXT;

CREATE INDEX "payment_transactions_reconciled_by_id_idx"
  ON "payment_transactions"("reconciled_by_id");

ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_reconciled_by_id_fkey"
  FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
