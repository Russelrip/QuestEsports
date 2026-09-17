-- 0019_leaderboard_bans.sql — keep a removed player from registering again
-- A removal only deletes the leaderboard_players row, so the player can register
-- again straight away. A ban names the two identities registration keys on: the
-- Riot PUUID (fixed for the life of a Riot account, unlike name#tag) and the
-- Discord snowflake (Quest reads it from the linked Discord account, so a caller
-- cannot choose it). Registration and restore refuse either while the ban is
-- active. Either may be absent — a removal whose Discord owner was released has
-- none — but not both.
--
-- name, tag and discord_username are the player as they were when banned, for
-- the admin list only; nothing matches on them.
--
-- A ban is lifted, never deleted, so the history stays. The partial unique
-- indexes allow one active ban per identity; a second ban of the same identity
-- is refused by the service, and by these indexes if two race.
CREATE TABLE leaderboard_bans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    puuid text,
    discord_id text,
    name text NOT NULL DEFAULT '',
    tag text NOT NULL DEFAULT '',
    discord_username text NOT NULL DEFAULT '',
    reason text,
    banned_at timestamptz NOT NULL DEFAULT now(),
    -- Quest users.id from the signed service token; NULL when unsigned (tests).
    banned_by text,
    lifted_at timestamptz,
    lifted_by text,
    CONSTRAINT leaderboard_bans_identity_check
        CHECK (puuid IS NOT NULL OR discord_id IS NOT NULL),
    -- '' is leaderboard_players' "no Discord owner" value. It must never be
    -- banned, or every registration without a Discord owner would match.
    CONSTRAINT leaderboard_bans_puuid_check CHECK (puuid IS NULL OR puuid <> ''),
    CONSTRAINT leaderboard_bans_discord_id_check CHECK (discord_id IS NULL OR discord_id <> ''),
    CONSTRAINT leaderboard_bans_lifted_by_check
        CHECK (lifted_by IS NULL OR lifted_at IS NOT NULL)
);
CREATE UNIQUE INDEX leaderboard_bans_active_puuid_key
    ON leaderboard_bans (puuid) WHERE lifted_at IS NULL AND puuid IS NOT NULL;
CREATE UNIQUE INDEX leaderboard_bans_active_discord_id_key
    ON leaderboard_bans (discord_id) WHERE lifted_at IS NULL AND discord_id IS NOT NULL;
CREATE INDEX leaderboard_bans_banned_at_idx ON leaderboard_bans (banned_at DESC);
