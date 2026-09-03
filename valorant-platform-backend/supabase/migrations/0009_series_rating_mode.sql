-- 0009_series_rating_mode.sql — durable finalization rating mode (Task 15 fix round 1)
-- The resolved rating policy mode is persisted ATOMICALLY on the series row inside the
-- finalize transaction (ADR-013): forfeit_no_rating vs forfeit_result_only stay
-- distinguishable for audit/rebuild even when no rating events are written. Draft rows
-- keep NULL until they are finalized.
ALTER TABLE series ADD COLUMN rating_mode text;

ALTER TABLE series ADD CONSTRAINT series_rating_mode_check CHECK (
    rating_mode IS NULL
    OR rating_mode IN ('normal', 'forfeit_no_rating', 'forfeit_result_only', 'manual_override')
);
