-- 0006_series_games.sql — series_games table (Phase 2; Appendix A of the implementation plan)
CREATE TABLE series_games (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id      uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    game_number    integer NOT NULL,
    match_id       uuid NOT NULL REFERENCES matches(id),
    team_a_side    text NOT NULL,
    team_b_side    text NOT NULL,
    team_a_rounds  integer NOT NULL,
    team_b_rounds  integer NOT NULL,
    winner_team_id uuid REFERENCES teams(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT series_games_number_key UNIQUE (series_id, game_number),
    CONSTRAINT series_games_match_key UNIQUE (match_id),      -- one canonical match rated in at most one series
    CONSTRAINT series_games_number_positive CHECK (game_number > 0),
    CONSTRAINT series_games_sides_check CHECK (
        team_a_side IN ('red','blue') AND team_b_side IN ('red','blue') AND team_a_side <> team_b_side),
    CONSTRAINT series_games_rounds_nonneg CHECK (team_a_rounds >= 0 AND team_b_rounds >= 0)
);

CREATE INDEX series_games_series_id_idx ON series_games (series_id);
CREATE INDEX series_games_match_id_idx ON series_games (match_id);

CREATE OR REPLACE FUNCTION series_games_winner_check() RETURNS trigger AS $$
BEGIN
    IF NEW.winner_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM series s WHERE s.id = NEW.series_id
          AND (s.team_a_id = NEW.winner_team_id OR s.team_b_id = NEW.winner_team_id)
    ) THEN
        RAISE EXCEPTION 'winner_team_id must be a team of the owning series';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER series_games_winner_check_trg
    BEFORE INSERT OR UPDATE OF winner_team_id ON series_games
    FOR EACH ROW EXECUTE FUNCTION series_games_winner_check();
