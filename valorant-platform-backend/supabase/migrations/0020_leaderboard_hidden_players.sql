-- 0020_leaderboard_hidden_players.sql — keep a registered player off the public board
-- A lighter tool than a removal or a ban (0017, 0019). A hidden player stays
-- registered: the row keeps its Riot and Discord accounts, the updater keeps
-- refreshing their rank and the Discord bot keeps their rank role. Only the
-- public board, its search and its stats leave them out. Unhiding puts them
-- straight back with a current rank.
--
-- hidden_at marks the row hidden; hidden_by and hidden_reason say who and why.
-- The reason is shown to the player on their Quest profile.
--
-- The removal copy carries the same three columns, so restoring a removed
-- hidden player brings them back hidden, exactly as they were.
ALTER TABLE leaderboard_players
    ADD COLUMN hidden_at timestamptz,
    -- Quest users.id from the signed service token; NULL when unsigned (tests).
    ADD COLUMN hidden_by text,
    ADD COLUMN hidden_reason text,
    ADD CONSTRAINT leaderboard_players_hidden_check
        CHECK (hidden_at IS NOT NULL OR (hidden_by IS NULL AND hidden_reason IS NULL));

ALTER TABLE leaderboard_player_removals
    ADD COLUMN hidden_at timestamptz,
    ADD COLUMN hidden_by text,
    ADD COLUMN hidden_reason text;
