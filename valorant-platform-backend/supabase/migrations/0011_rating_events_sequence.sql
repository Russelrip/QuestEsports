-- 0011_rating_events_sequence.sql — per-run application/replay sequence (Task 16 fix round 3)
-- rating_events gain a stable per-run sequence so history can be presented in the ACTUAL
-- application/replay order, not transaction-stable now()/random-UUID order:
--   - ordinary finalization allocates the next sequence (max+1 within the run) under the
--     shared RATING_WORK_LOCK_KEY advisory lock and writes BOTH team events with it;
--   - a rebuild assigns sequences in deterministic replay order;
--   - history orders by sequence; elo_before/elo_after chain in that order even when
--     finalization order differs from played_at.
--
-- BACKFILL POLICY (fix round 3): pre-0011 events carry no persisted sequence, so their
-- order is backfilled from the persisted APPLICATION proxy — each run's series are ranked
-- by their earliest event's (created_at, id). created_at is the actual insert (application)
-- time, so the live run keeps its true finalization order; the played_at column is NEVER
-- used, because out-of-chronology finalizations must not be silently reordered. This
-- proxy order is legacy: it reflects the original application sequence (reliable for the
-- live run) but is not authoritative replay chronology for any rebuild run created before
-- this migration. Events inserted after this migration carry authoritative sequences.
--
-- HARDENING (fix round 3): a DEFERRED constraint trigger replaces the earlier weak
-- per-row count guard. At COMMIT it verifies that every (run, sequence) holds EXACTLY TWO
-- events of ONE series, that the two teams are exactly the series' team_a/team_b (no
-- duplicate team, no wrong team, no partial pair), and that the series uses exactly one
-- sequence per run. A partial/arbitrary pair can never commit.

-- The immutable-audit trigger (0010) rejects UPDATE, so it is suspended only for the
-- one-time backfill of pre-existing rows.
ALTER TABLE rating_events DISABLE TRIGGER rating_events_immutable_trg;

ALTER TABLE rating_events ADD COLUMN sequence bigint;

WITH series_order AS (
    SELECT e.run_id,
           e.series_id,
           min(e.created_at) AS applied_at,   -- earliest event insert = application time
           min(e.id::text) AS first_id        -- deterministic tie-breaker (uuid has no min())
    FROM rating_events e
    GROUP BY e.run_id, e.series_id
),
ranked AS (
    SELECT run_id,
           series_id,
           dense_rank() OVER (
               PARTITION BY run_id
               ORDER BY applied_at, first_id
           ) AS seq
    FROM series_order
)
UPDATE rating_events e
SET sequence = r.seq
FROM ranked r
WHERE r.run_id = e.run_id AND r.series_id = e.series_id;

ALTER TABLE rating_events ENABLE TRIGGER rating_events_immutable_trg;

ALTER TABLE rating_events ALTER COLUMN sequence SET NOT NULL;

-- Exact-event-pair guard: a DEFERRED constraint trigger that runs at COMMIT, so a partial
-- pair (one event), a wrong-team pair, a duplicate-team pair, an arbitrary/third series
-- pair, or a series claiming two sequences can never commit. The advisory lock serializes
-- allocation in the application; this is the durable DB-enforced truth.
CREATE OR REPLACE FUNCTION rating_events_pair_guard() RETURNS trigger AS $$
DECLARE
    total int;
    distinct_series int;
    pair_series uuid;
    series_team_a uuid;
    series_team_b uuid;
BEGIN
    -- Exactly two events from exactly one series share each (run, sequence).
    SELECT count(*), count(DISTINCT series_id)
    INTO total, distinct_series
    FROM rating_events
    WHERE run_id = NEW.run_id AND sequence = NEW.sequence;
    IF total <> 2 OR distinct_series <> 1 THEN
        RAISE EXCEPTION 'rating_events (run, sequence) must hold exactly two events of one series';
    END IF;

    SELECT series_id INTO pair_series
    FROM rating_events
    WHERE run_id = NEW.run_id AND sequence = NEW.sequence
    LIMIT 1;

    -- The pair's teams are exactly the series' team_a and team_b.
    SELECT s.team_a_id, s.team_b_id INTO series_team_a, series_team_b
    FROM series s
    WHERE s.id = pair_series;
    IF series_team_a IS NULL OR series_team_b IS NULL THEN
        RAISE EXCEPTION 'rating_events pair references a missing series';
    END IF;
    IF EXISTS (
        SELECT 1 FROM rating_events
        WHERE run_id = NEW.run_id AND sequence = NEW.sequence
          AND team_id NOT IN (series_team_a, series_team_b)
    ) THEN
        RAISE EXCEPTION 'rating_events pair must be exactly the series'' team_a and team_b';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (
            SELECT team_id FROM rating_events
            WHERE run_id = NEW.run_id AND sequence = NEW.sequence
            GROUP BY team_id HAVING count(*) > 1
        ) dup
    ) THEN
        RAISE EXCEPTION 'rating_events pair must not duplicate a team';
    END IF;

    -- The pair's series uses exactly one sequence per run.
    IF EXISTS (
        SELECT 1 FROM rating_events
        WHERE run_id = NEW.run_id AND series_id = pair_series AND sequence <> NEW.sequence
    ) THEN
        RAISE EXCEPTION 'rating_events series may use only one sequence per run';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER rating_events_pair_guard_trg
    AFTER INSERT ON rating_events
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION rating_events_pair_guard();
