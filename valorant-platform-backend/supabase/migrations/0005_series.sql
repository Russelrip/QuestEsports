-- 0005_series.sql — series table (Phase 2; Appendix A of the implementation plan)
CREATE TABLE series (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_a_id              uuid NOT NULL REFERENCES teams(id),
    team_b_id              uuid NOT NULL REFERENCES teams(id),
    format                 text NOT NULL,
    importance             text NOT NULL,
    status                 text NOT NULL DEFAULT 'draft',
    calculated_winner_id   uuid REFERENCES teams(id),
    official_winner_id     uuid REFERENCES teams(id),
    winner_override_reason text,
    team_a_maps_won        integer NOT NULL DEFAULT 0,
    team_b_maps_won        integer NOT NULL DEFAULT 0,
    played_at              timestamptz,
    finalized_at           timestamptz,
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT series_team_distinct CHECK (team_a_id <> team_b_id),
    CONSTRAINT series_format_check CHECK (format IN ('bo1','bo3','bo5')),
    CONSTRAINT series_importance_check CHECK (importance IN ('regular','playoff','finals')),
    CONSTRAINT series_status_check CHECK (status IN ('draft','finalized')),        -- locked: only draft/finalized
    CONSTRAINT series_calculated_winner_check CHECK (
        calculated_winner_id IS NULL OR calculated_winner_id IN (team_a_id, team_b_id)),
    CONSTRAINT series_official_winner_check CHECK (
        official_winner_id IS NULL OR official_winner_id IN (team_a_id, team_b_id)),
    CONSTRAINT series_override_reason_check CHECK (
        official_winner_id IS NULL
        OR official_winner_id = calculated_winner_id
        OR (winner_override_reason IS NOT NULL AND length(trim(winner_override_reason)) > 0))
);

CREATE INDEX series_status_idx ON series (status);
CREATE INDEX series_team_a_idx ON series (team_a_id);
CREATE INDEX series_team_b_idx ON series (team_b_id);
