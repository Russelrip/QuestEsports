-- 0007_rating_runs.sql — versioned rating runs (Phase 2; Appendix A of the implementation plan)
-- Versioned runs make rating_events immutable audit records across rebuilds: a rebuild
-- inserts under a NEW run_number and reads always use the current (max) run.
CREATE TABLE rating_runs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_number bigint GENERATED ALWAYS AS IDENTITY,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rating_runs_run_number_key ON rating_runs (run_number);

-- Seed the initial (live) run so normal finalization has a run to write under.
INSERT INTO rating_runs (note) VALUES ('initial live run');
