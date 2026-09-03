-- 0012_rating_event_sequences.sql — durable sequence reservations (Task 16 fix round 4)
-- A sequence value in a run must be OWNED by exactly one series before any event may use
-- it. rating_event_sequences makes that ownership enforceable and concurrency-safe:
--   - PRIMARY KEY (run_id, sequence): one sequence per run, owned by one series — the
--     serialization point. Two transactions racing to use the same sequence for
--     DIFFERENT series: the second reservation INSERT blocks on the first's uncommitted
--     row, then fails with a unique violation when the first commits — exactly one wins.
--   - UNIQUE (run_id, series_id): a series holds at most one reservation (one sequence)
--     per run.
--
-- Finalize/rebuild reserve (insert) the sequence BEFORE inserting the two team events,
-- always inside the shared RATING_WORK_LOCK_KEY advisory-lock transaction. rating_events
-- gains a composite FK to this table, so an unreserved (run, sequence) can never appear
-- on an event. The deferred pair guard from 0011 is rewritten to validate the event pair
-- against the reservation (exactly two events of the reserved series, teams exactly the
-- series' team_a/team_b).

CREATE TABLE rating_event_sequences (
    run_id     uuid NOT NULL REFERENCES rating_runs(id),
    series_id  uuid NOT NULL REFERENCES series(id),
    sequence   bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sequence),
    CONSTRAINT rating_event_sequences_run_series_key UNIQUE (run_id, series_id)
);

CREATE INDEX rating_event_sequences_series_id_idx ON rating_event_sequences (series_id);

-- Backfill reservations from events already sequenced by 0011: one reservation per
-- (run, series) with its sequence. The unique keys fail loudly if the pre-existing
-- events ever violated one-series-per-sequence ownership.
INSERT INTO rating_event_sequences (run_id, series_id, sequence)
SELECT DISTINCT run_id, series_id, sequence
FROM rating_events
ORDER BY run_id, sequence;

-- Events must reference a reservation: an unreserved (run, sequence) cannot be inserted.
ALTER TABLE rating_events
    ADD CONSTRAINT rating_events_sequence_reservation_fk
    FOREIGN KEY (run_id, sequence) REFERENCES rating_event_sequences (run_id, sequence);

-- Rewrite the deferred pair guard (0011) to validate the event pair against the
-- reservation: exactly two events of the RESERVED series, teams exactly the series'
-- team_a/team_b, no duplicate team. Runs at COMMIT; partial/wrong/arbitrary pairs cannot
-- commit, while valid application pairs (reservation + two team events) always do.
CREATE OR REPLACE FUNCTION rating_events_pair_guard() RETURNS trigger AS $$
DECLARE
    total int;
    reserved_series uuid;
    series_team_a uuid;
    series_team_b uuid;
BEGIN
    -- The (run, sequence) must be reserved by exactly one series (the reservation
    -- table's primary key; the events FK to it).
    SELECT series_id INTO reserved_series
    FROM rating_event_sequences
    WHERE run_id = NEW.run_id AND sequence = NEW.sequence;
    IF reserved_series IS NULL THEN
        RAISE EXCEPTION 'rating_events sequence % in run % has no reservation',
            NEW.sequence, NEW.run_id;
    END IF;

    -- Exactly two events of the reserved series.
    SELECT count(*) INTO total
    FROM rating_events
    WHERE run_id = NEW.run_id AND sequence = NEW.sequence;
    IF total <> 2 THEN
        RAISE EXCEPTION 'rating_events (run, sequence) must hold exactly two events of one series';
    END IF;
    IF EXISTS (
        SELECT 1 FROM rating_events
        WHERE run_id = NEW.run_id AND sequence = NEW.sequence AND series_id <> reserved_series
    ) THEN
        RAISE EXCEPTION 'rating_events pair must belong to the reserved series';
    END IF;

    -- The pair's teams are exactly the reserved series' team_a and team_b.
    SELECT s.team_a_id, s.team_b_id INTO series_team_a, series_team_b
    FROM series s
    WHERE s.id = reserved_series;
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

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
