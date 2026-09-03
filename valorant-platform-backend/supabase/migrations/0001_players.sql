-- 0001_players.sql — players table (Phase 1; Appendix A of the implementation plan)
CREATE TABLE players (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    puuid             text NOT NULL,
    current_name      text NOT NULL,
    current_tag       text NOT NULL,
    affinity          text,
    platforms         jsonb,
    henrik_updated_at timestamptz,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX players_puuid_key ON players (puuid);
CREATE INDEX players_lower_name_tag_idx ON players (lower(current_name), lower(current_tag));
CREATE INDEX players_affinity_idx ON players (affinity);
