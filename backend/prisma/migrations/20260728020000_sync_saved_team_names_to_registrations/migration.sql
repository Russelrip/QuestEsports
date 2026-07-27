-- Team registrations keep a presentation snapshot of the saved team name.
-- Bring existing linked registrations in sync so earlier admin renames appear
-- across tournament, account, payment, export, and administration views.
UPDATE "team_registrations" AS registration
SET "team_name" = team."name",
    "updated_at" = CURRENT_TIMESTAMP
FROM "saved_teams" AS team
WHERE registration."saved_team_id" = team."id"
  AND registration."team_name" IS DISTINCT FROM team."name";
