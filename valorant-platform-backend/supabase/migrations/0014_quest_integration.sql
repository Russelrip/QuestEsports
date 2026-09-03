-- 0014_quest_integration.sql — Quest integration columns (spec §4.4 D2/D3/D4/D6/D7)
-- Expand-first (§7.3): every column is nullable and no backfill is needed
-- (new data only); the widened rating_mode CHECK only relaxes the allowed set.

-- D2: teams.quest_saved_team_id — the single convergence key for create-or-get.
ALTER TABLE teams ADD COLUMN quest_saved_team_id text;
CREATE UNIQUE INDEX teams_quest_saved_team_id_key
    ON teams (quest_saved_team_id) WHERE quest_saved_team_id IS NOT NULL;

-- D3: series.external_quest_series_id — create-or-get convergence key.
-- A plain UNIQUE constraint is safe: Postgres allows multiple NULLs.
ALTER TABLE series ADD COLUMN external_quest_series_id text;
ALTER TABLE series ADD CONSTRAINT series_external_quest_series_id_key UNIQUE (external_quest_series_id);

-- D6: anchor identity PUUIDs, resolved and persisted at series create.
ALTER TABLE series ADD COLUMN anchor_a_puuid text;
ALTER TABLE series ADD COLUMN anchor_b_puuid text;

-- D7: finalize actor/operation audit fields (persisted from the token claims).
ALTER TABLE series ADD COLUMN finalized_by_actor_id text;
ALTER TABLE series ADD COLUMN finalized_by_operation_id text;

-- D4: widen series_rating_mode_check to include 'unrated'.
ALTER TABLE series DROP CONSTRAINT series_rating_mode_check;
ALTER TABLE series ADD CONSTRAINT series_rating_mode_check CHECK (
    rating_mode IS NULL
    OR rating_mode IN ('normal','unrated','forfeit_no_rating','forfeit_result_only','manual_override')
);
