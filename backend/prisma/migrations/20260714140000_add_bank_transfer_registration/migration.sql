-- Add a manual bank-transfer option without changing existing PayHere behaviour.
CREATE TYPE "TournamentPaymentMethod" AS ENUM ('free', 'payhere', 'bank_transfer');

ALTER TABLE "tournaments"
  ADD COLUMN "payment_method" "TournamentPaymentMethod" NOT NULL DEFAULT 'free',
  ADD COLUMN "registration_fee_tiers" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "bank_transfer_review_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_branch" TEXT,
  ADD COLUMN "bank_account_name" TEXT,
  ADD COLUMN "bank_account_number" TEXT;

-- Preserve the behaviour of paid tournaments created before this migration.
UPDATE "tournaments"
SET "payment_method" = CASE
  WHEN "registration_fee_amount" > 0 THEN 'payhere'::"TournamentPaymentMethod"
  ELSE 'free'::"TournamentPaymentMethod"
END;

ALTER TABLE "team_registrations"
  ADD COLUMN "assigned_slot_number" INTEGER,
  ADD COLUMN "quoted_fee_amount" DECIMAL(12, 2),
  ADD COLUMN "quoted_fee_currency" TEXT;

CREATE INDEX "team_registrations_tournament_id_assigned_slot_number_idx"
  ON "team_registrations"("tournament_id", "assigned_slot_number");

CREATE TABLE "bank_transfer_proofs" (
  "id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "stored_filename" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" UUID,
  "rejection_reason" TEXT,
  CONSTRAINT "bank_transfer_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_transfer_proofs_transaction_id_key"
  ON "bank_transfer_proofs"("transaction_id");
CREATE INDEX "bank_transfer_proofs_sha256_idx"
  ON "bank_transfer_proofs"("sha256");
CREATE INDEX "bank_transfer_proofs_reviewed_by_id_idx"
  ON "bank_transfer_proofs"("reviewed_by_id");
CREATE INDEX "bank_transfer_proofs_submitted_at_idx"
  ON "bank_transfer_proofs"("submitted_at");

ALTER TABLE "bank_transfer_proofs"
  ADD CONSTRAINT "bank_transfer_proofs_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_transfer_proofs"
  ADD CONSTRAINT "bank_transfer_proofs_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
