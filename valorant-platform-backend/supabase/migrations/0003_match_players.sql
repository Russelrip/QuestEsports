-- 0003_match_players.sql — match_players table (Phase 1; Appendix A of the implementation plan)
CREATE TABLE match_players (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id           uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id          uuid NOT NULL REFERENCES players(id),
    puuid_snapshot     text NOT NULL,
    name_snapshot      text NOT NULL,
    tag_snapshot       text NOT NULL,
    side               text NOT NULL,
    agent_id           text,
    agent_name         text,
    score_total        integer,
    kills              integer,
    deaths             integer,
    assists            integer,
    damage_dealt       integer,
    damage_received    integer,
    headshots          integer,
    bodyshots          integer,
    legshots           integer,
    raw_player_payload jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT match_players_match_player_key UNIQUE (match_id, player_id),
    CONSTRAINT match_players_side_check CHECK (side IN ('red','blue'))
);

CREATE INDEX match_players_puuid_snapshot_idx ON match_players (puuid_snapshot);
CREATE INDEX match_players_player_id_idx ON match_players (player_id);
