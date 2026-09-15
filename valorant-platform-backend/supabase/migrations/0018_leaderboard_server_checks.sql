-- 0018_leaderboard_server_checks.sql — which servers leaderboard players play on
-- The leaderboard is for Sri Lankan players, and in practice they play competitive
-- on the Singapore and Mumbai servers. A registration whose recent matches are
-- mostly somewhere else is worth a human look, so the updater records the server
-- (Henrik's match `cluster`) of each competitive match it sees, and admins review
-- the players that stand out. Nothing is removed automatically.
--
-- Neither table references leaderboard_players by key: a removal must not
-- cascade here, so a restored player comes back with their evidence and review.
-- Rows for a PUUID that is not registered are simply not listed.

-- One row per competitive match seen for a player. The match id is Henrik's, so a
-- match seen on several passes is stored once.
CREATE TABLE leaderboard_player_server_matches (
    puuid text NOT NULL,
    match_id text NOT NULL,
    -- Server name, e.g. 'Singapore'; NULL when Henrik did not say.
    cluster text,
    -- Riot shard, e.g. 'ap'.
    shard text,
    started_at timestamptz NOT NULL,
    observed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (puuid, match_id)
);
CREATE INDEX leaderboard_player_server_matches_started_idx
    ON leaderboard_player_server_matches (puuid, started_at DESC);

-- One row per player: when their servers were last fetched, and whether an admin
-- has reviewed a flag and kept them. A clearance covers the matches played before
-- it; matches after it are judged on their own.
CREATE TABLE leaderboard_player_server_checks (
    puuid text PRIMARY KEY,
    checked_at timestamptz,
    cleared_at timestamptz,
    -- Quest users.id from the signed service token; NULL when unsigned (tests).
    cleared_by text,
    CONSTRAINT leaderboard_player_server_checks_cleared_by_check
        CHECK (cleared_by IS NULL OR cleared_at IS NOT NULL)
);
