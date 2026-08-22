-- Records when a captain or an admin explicitly removed a saved team logo.
--
-- `logo_name` alone cannot say why a team has no logo. This column separates
-- the two cases:
--   * logo_name NULL and logo_cleared_at NULL  -> the team has never had a logo,
--     so a registration may supply one.
--   * logo_name NULL and logo_cleared_at set   -> the removal is deliberate and
--     stays authoritative, so a stale registration snapshot cannot resurrect it.
--
-- Additive and nullable, with no backfill: existing logo-less teams read as
-- "never had a logo" and may adopt a registration logo once.
ALTER TABLE "saved_teams"
ADD COLUMN "logo_cleared_at" TIMESTAMP(3);
