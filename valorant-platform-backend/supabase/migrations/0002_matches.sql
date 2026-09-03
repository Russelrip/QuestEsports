-- 0002_matches.sql — matches table (Phase 1; Appendix A of the implementation plan)
CREATE TABLE matches (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    henrik_match_id    text NOT NULL,
    affinity           text NOT NULL,
    platform           text NOT NULL DEFAULT 'pc',
    map_id             text,
    map_name           text NOT NULL,
    mode               text,
    queue              text,
    started_at         timestamptz NOT NULL,
    duration_ms        bigint,
    is_completed       boolean NOT NULL,
    red_score          integer,
    blue_score         integer,
    winning_side       text,
    game_version       text,
    raw_payload        jsonb NOT NULL,
    henrik_api_version text NOT NULL DEFAULT 'v4',
    imported_at        timestamptz NOT NULL DEFAULT now(),
    refreshed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT matches_henrik_match_id_key UNIQUE (henrik_match_id),
    CONSTRAINT matches_red_score_nonneg CHECK (red_score IS NULL OR red_score >= 0),
    CONSTRAINT matches_blue_score_nonneg CHECK (blue_score IS NULL OR blue_score >= 0),
    CONSTRAINT matches_winning_side_check CHECK (winning_side IS NULL OR winning_side IN ('red','blue','draw','unknown')),
    CONSTRAINT matches_platform_check CHECK (platform IN ('pc','console'))
);

CREATE INDEX matches_started_at_idx ON matches (started_at);
CREATE INDEX matches_map_name_idx ON matches (map_name);
CREATE INDEX matches_mode_idx ON matches (mode);
