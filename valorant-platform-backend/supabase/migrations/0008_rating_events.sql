-- 0008_rating_events.sql — immutable per-series rating events (Phase 2; Appendix A)
-- rating_events are audit records: never updated, never deleted. Rebuilds insert under a
-- new rating_runs row; reads use the current run (max run_number). The unique
-- (run_id, series_id, team_id) plus series.status='finalized' enforce at-most-once
-- rating per series per run.
CREATE TABLE rating_events (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  uuid NOT NULL REFERENCES rating_runs(id),
    series_id               uuid NOT NULL REFERENCES series(id),
    team_id                 uuid NOT NULL REFERENCES teams(id),
    elo_before              numeric NOT NULL,
    elo_after               numeric NOT NULL,
    elo_change              numeric NOT NULL,
    opponent_team_id        uuid NOT NULL REFERENCES teams(id),
    result                  text NOT NULL,
    k_factor                numeric,
    expected_score          numeric,
    performance_multiplier  numeric,
    importance_multiplier   numeric,
    upset_bonus             numeric,
    calculation_details     jsonb NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rating_events_run_series_team_key UNIQUE (run_id, series_id, team_id),
    CONSTRAINT rating_events_result_check CHECK (result IN ('win','loss'))
);

CREATE INDEX rating_events_team_id_idx ON rating_events (team_id);
CREATE INDEX rating_events_series_id_idx ON rating_events (series_id);
CREATE INDEX rating_events_run_id_idx ON rating_events (run_id);
