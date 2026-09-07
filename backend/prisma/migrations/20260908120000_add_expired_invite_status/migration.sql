-- An explicit terminal state for an invitation nobody answered in time.
--
-- Until now "expired" was not a state, it was the absence of a usable token:
-- data hygiene cleared `invite_token_hash`, `invite_sent_at` and
-- `invite_expires_at` on a pending invitation past its deadline and left the
-- row at `pending`. That read correctly only because responding required the
-- token, so a row with no token could not be answered by anyone.
--
-- Responding is moving to the invitee's identity rather than to a token they
-- were emailed, which removes the thing that was silently enforcing expiry. The
-- same rows would otherwise become permanently answerable, with no deadline
-- left on them to notice. So expiry becomes a state that is written down.
--
-- Existing rows are migrated in the same shape hygiene left them: pending, with
-- a deadline already past, or pending with every invite timestamp cleared —
-- which is how a previously expired invitation looks once hygiene has been over
-- it. A captain re-inviting someone moves the row back to `pending`, exactly as
-- it does for a declined invitation today.

ALTER TYPE "TeamMemberInviteStatus" ADD VALUE IF NOT EXISTS 'expired';
