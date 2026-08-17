-- Waitlist positions are meaningful only while a registration is waitlisted.
UPDATE team_registrations
SET waitlist_position = NULL
WHERE waitlist_position IS NOT NULL
  AND status <> 'waitlisted';

-- Normalize legacy duplicate positions before adding the nullable composite key.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tournament_id
      ORDER BY waitlist_position ASC, created_at ASC, id ASC
    ) AS normalized_position
  FROM team_registrations
  WHERE waitlist_position IS NOT NULL
    AND status = 'waitlisted'
)
UPDATE team_registrations AS registrations
SET waitlist_position = ranked.normalized_position
FROM ranked
WHERE registrations.id = ranked.id;

CREATE UNIQUE INDEX "team_registrations_tournament_id_waitlist_position_key"
ON "team_registrations"("tournament_id", "waitlist_position");
