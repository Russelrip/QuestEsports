-- 0016_manual_series.sql — manual-result series columns (offline/historical results)
-- Expand-first (§7.3): every column is nullable and set only for manual series
-- created via POST /api/v1/series/manual (no anchors, no attached games — the
-- winner and per-team map counts are recorded directly by the admin). Regular
-- series keep all three NULL.
ALTER TABLE series ADD COLUMN manual_winner_team_id uuid REFERENCES teams(id);
ALTER TABLE series ADD COLUMN manual_team_a_maps integer;
ALTER TABLE series ADD COLUMN manual_team_b_maps integer;

-- The recorded manual winner must be one of the series' two teams (mirrors the
-- existing calculated/official winner CHECK constraints).
ALTER TABLE series ADD CONSTRAINT series_manual_winner_check CHECK (
    manual_winner_team_id IS NULL OR manual_winner_team_id IN (team_a_id, team_b_id)
);
