-- Backfill for the `expired` invite state added in the previous migration.
--
-- Separate from the ALTER TYPE on purpose: PostgreSQL will not let a new enum
-- value be used in the transaction that added it, and Prisma runs each
-- migration file in one transaction.
--
-- Two shapes of already-expired invitation exist. One still carries the
-- deadline it missed. The other was swept by data hygiene, which cleared the
-- token and both timestamps and left the row at `pending` — a pending
-- invitation with no deadline and no record of ever being sent is the fingerprint
-- of that sweep, and cannot be produced any other way: every path that creates
-- a pending invitation writes `invite_sent_at` at the same moment.
--
-- An accepted or declined invitation is left alone. Expiry is about an
-- invitation nobody answered, and both of those were answered.

UPDATE "registration_members"
SET "invite_status" = 'expired'
WHERE "invite_status" = 'pending'
  AND (
    "invite_expires_at" < NOW()
    OR (
      "invite_expires_at" IS NULL
      AND "invite_sent_at" IS NULL
      AND "invite_token_hash" IS NULL
    )
  );

UPDATE "saved_team_members"
SET "invite_status" = 'expired'
WHERE "invite_status" = 'pending'
  AND (
    "invite_expires_at" < NOW()
    OR (
      "invite_expires_at" IS NULL
      AND "invite_sent_at" IS NULL
      AND "invite_token_hash" IS NULL
    )
  );
