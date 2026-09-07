-- Unlimited registration capacity and automatic registration approval.
--
-- `max_teams` becomes nullable, where NULL means "no slot ceiling". Every
-- existing row keeps its number, so nothing changes for a tournament that was
-- configured with a capacity; unlimited is only reachable by clearing the
-- field deliberately. Dropping NOT NULL is additive in the sense that matters
-- here: no existing value is rewritten and no read path breaks, because a
-- capacity check on NULL now means "always has room" rather than "full".
--
-- Slot-numbered fee tiers stay incompatible with unlimited capacity by
-- validation rather than by constraint: a tier list must cover every slot, and
-- an unbounded slot range cannot be covered.
--
-- `auto_approve_registrations` defaults to FALSE so every existing tournament
-- keeps its manual approval step. Turning it on approves a registration the
-- moment nothing is left to wait on — the roster is verified and the fee, if
-- any, is provider-confirmed — which is the state an admin was clicking
-- through by hand for an open-entry, free tournament.

ALTER TABLE "tournaments"
ALTER COLUMN "max_teams" DROP NOT NULL;

ALTER TABLE "tournaments"
ADD COLUMN "auto_approve_registrations" BOOLEAN NOT NULL DEFAULT FALSE;
