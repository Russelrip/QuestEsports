-- 0010_rating_events_immutable.sql — DB-enforced immutability of rating_events (Task 15 fix round 1)
-- rating_events are immutable audit records: never updated, never deleted (the unique
-- (run_id, series_id, team_id) double-rate guard and INSERT behavior are preserved).
CREATE OR REPLACE FUNCTION rating_events_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'rating_events are immutable audit records';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rating_events_immutable_trg
    BEFORE UPDATE OR DELETE ON rating_events
    FOR EACH ROW EXECUTE FUNCTION rating_events_immutable();
