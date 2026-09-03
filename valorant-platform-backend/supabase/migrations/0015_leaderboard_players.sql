-- 0015_leaderboard_players.sql — SL player leaderboard (Phase 2, spec §4)
CREATE TABLE leaderboard_players (
    puuid text PRIMARY KEY,
    name text NOT NULL,
    tag text NOT NULL,
    region text NOT NULL,
    discord_id text NOT NULL DEFAULT '',
    discord_username text NOT NULL,
    elo integer,
    currenttierpatched text,
    rank_details jsonb NOT NULL DEFAULT '{}',
    peak_rank jsonb,
    seasonal_ranks jsonb,
    last_played_match timestamptz,
    update_source text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX leaderboard_players_discord_username_key
    ON leaderboard_players (discord_username);
CREATE UNIQUE INDEX leaderboard_players_discord_id_key
    ON leaderboard_players (discord_id) WHERE discord_id <> '';
CREATE INDEX leaderboard_players_elo_idx ON leaderboard_players (elo DESC);
CREATE INDEX leaderboard_players_last_played_idx ON leaderboard_players (last_played_match);
