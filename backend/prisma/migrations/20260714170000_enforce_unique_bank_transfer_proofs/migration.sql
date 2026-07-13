-- Prevent the same receipt from being attached to multiple payment transactions.
-- The guard gives operators an actionable failure if legacy duplicate data exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bank_transfer_proofs"
    GROUP BY "sha256"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate bank-transfer proof hashes must be reconciled before this migration can run';
  END IF;
END $$;

DROP INDEX IF EXISTS "bank_transfer_proofs_sha256_idx";
CREATE UNIQUE INDEX "bank_transfer_proofs_sha256_key" ON "bank_transfer_proofs"("sha256");
