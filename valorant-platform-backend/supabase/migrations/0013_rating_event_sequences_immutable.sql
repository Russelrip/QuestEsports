-- 0013_rating_event_sequences_immutable.sql — DB-enforced immutability of
-- rating_event_sequences (Task 16 fix round 5)
-- A committed (run_id, sequence) reservation is a durable OWNERSHIP record: it
-- states which series owns the sequence value, and the exact-event-pair guard
-- (0011/0012) and the rating_events composite FK depend on that ownership never
-- changing after commit. Reassigning a reservation (UPDATE series_id) or
-- deleting a reservation row would silently rewrite history and could strand or
-- re-own a sequence that already has immutable events — so UPDATE and DELETE are
-- rejected at the DB level, exactly like rating_events (0010).
--
-- Inserts remain valid: runtime allocation (reserve_event_sequence) and the
-- 0012 backfill both INSERT, and only INSERT. TRUNCATE is unaffected (the
-- per-row trigger does not fire), so the test harness and schema rebuilds keep
-- working. A trigger (rather than table permissions) is the right tool because
-- the application connects as a single role that must still INSERT; the
-- immutability rule is structural and applies to every connection uniformly.
CREATE OR REPLACE FUNCTION rating_event_sequences_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'rating_event_sequences are immutable audit records';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rating_event_sequences_immutable_trg
    BEFORE UPDATE OR DELETE ON rating_event_sequences
    FOR EACH ROW EXECUTE FUNCTION rating_event_sequences_immutable();
