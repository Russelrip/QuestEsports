-- Lease fencing for background jobs.
--
-- A worker that stalls past the lock timeout has its job reclaimed by another
-- worker, but it can still wake up and write its own outcome over the new
-- owner's. Each claim now stamps a fresh `lease_token`, and succeeding,
-- failing or deferring a job only applies while that token still matches.
--
-- Additive: nullable, no backfill. Jobs claimed by the previous release carry
-- no token and are reclaimed normally, and that release ignores the column.

ALTER TABLE "background_jobs"
ADD COLUMN "lease_token" TEXT;
