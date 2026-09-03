-- 0004_teams.sql — teams table (Phase 2; Appendix A of the implementation plan)
CREATE TABLE teams (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    short_name     text,
    slug           text,
    logo_url       text,
    current_elo    numeric NOT NULL DEFAULT 1000,
    peak_elo       numeric NOT NULL DEFAULT 1000,
    seeding_elo    numeric,
    matches_played integer NOT NULL DEFAULT 0,
    series_wins    integer NOT NULL DEFAULT 0,
    series_losses  integer NOT NULL DEFAULT 0,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT teams_slug_key UNIQUE (slug),
    CONSTRAINT teams_current_elo_nonneg CHECK (current_elo >= 0),
    CONSTRAINT teams_peak_elo_nonneg CHECK (peak_elo >= 0),
    CONSTRAINT teams_matches_played_nonneg CHECK (matches_played >= 0),
    CONSTRAINT teams_series_wins_nonneg CHECK (series_wins >= 0),
    CONSTRAINT teams_series_losses_nonneg CHECK (series_losses >= 0)
);

CREATE INDEX teams_is_active_idx ON teams (is_active);
