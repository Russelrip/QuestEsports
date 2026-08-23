-- Per-tournament Discord requirement.
--
-- Defaults to FALSE so every existing tournament behaves exactly as it does
-- today. Turning it on is a deliberate per-event decision, which is what makes
-- it safe to ship: Discord adoption can be trialled on one tournament instead
-- of blocking every team on the day it lands.
--
-- Roster readiness reports each member's Discord status regardless of this
-- flag; the flag only decides whether a missing connection BLOCKS registration.

ALTER TABLE "tournaments"
ADD COLUMN "discord_required" BOOLEAN NOT NULL DEFAULT FALSE;
