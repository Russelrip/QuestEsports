-- 0017_leaderboard_player_removals.sql — restorable leaderboard removals
-- Removing a player deletes their leaderboard_players row, which every reader
-- (board, updater, name audit, Discord bot, registration) already treats as
-- "not registered". This table keeps a copy of the row as it was, taken in the
-- same transaction as the delete, so an admin can put it back. leaderboard_players
-- itself is untouched, so none of those readers change.
--
-- A removal is restored at most once. Restoring an older removal of a PUUID
-- that has been removed again since is refused by the service, not here.
CREATE TABLE leaderboard_player_removals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    puuid text NOT NULL,
    name text NOT NULL,
    tag text NOT NULL,
    region text NOT NULL,
    discord_id text NOT NULL,
    discord_username text NOT NULL,
    elo integer,
    currenttierpatched text,
    rank_details jsonb NOT NULL,
    peak_rank jsonb,
    seasonal_ranks jsonb,
    last_played_match timestamptz,
    update_source text,
    updated_at timestamptz NOT NULL,
    removed_at timestamptz NOT NULL DEFAULT now(),
    -- Quest users.id from the signed service token; NULL when unsigned (tests).
    removed_by text,
    restored_at timestamptz,
    restored_by text,
    CONSTRAINT leaderboard_player_removals_restored_by_check
        CHECK (restored_by IS NULL OR restored_at IS NOT NULL)
);
CREATE INDEX leaderboard_player_removals_removed_at_idx
    ON leaderboard_player_removals (removed_at DESC);
CREATE INDEX leaderboard_player_removals_puuid_idx
    ON leaderboard_player_removals (puuid, removed_at DESC);
