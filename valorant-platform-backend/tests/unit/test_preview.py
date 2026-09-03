"""Series preview unit tests (plan Task 13; design §10.2–10.3, §11.2).

Read-only in-memory repository + fake session — no network, no DB. Covers:

- valid BO1/BO3/BO5 shapes (1-0, 2-0, 2-1, 3-2) → ``valid=true`` with the
  recomputed map counts and calculated winner;
- invalid shapes → ``valid=false`` with the stable, deterministic validation
  error messages: a 1-1 BO3 (no winner), a 3-3 BO5 with a sixth map (game
  after clinch + format bound), an empty series, an invalid side mapping, and
  an incomplete match;
- canonical derivation (fix round 1): every game's rounds and winner are
  derived from the CURRENT canonical match scores through the persisted side
  mapping — a refreshed match (flipped winner or changed margin) is reflected
  in the response, a stale stored winner is flagged invalid, and a scoreless
  canonical match reports an error;
- preview never writes: only the single consistent read runs, the stored
  (possibly stale) series result is untouched, and the session is never
  committed/rolled back;
- preview works on finalized series too (reads only — the Task 12 draft-only
  gate does not apply to preview);
- missing series → 404 ``SERIES_NOT_FOUND``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.api.errors import AppError
from app.db.models import Match, Series, SeriesGame, Team
from app.domain.series.bo import CanonicalGameSnapshot
from app.services.series_service import SeriesService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0
        self.rolled_back = 0

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        self.rolled_back += 1


def _team(name: str = "Team A") -> Team:
    return Team(
        id=uuid.uuid4(),
        name=name,
        current_elo=Decimal(1000),
        peak_elo=Decimal(1000),
        matches_played=0,
        series_wins=0,
        series_losses=0,
        is_active=True,
        created_at=START,
        updated_at=START,
    )


def _match(*, red_wins: bool = True, is_completed: bool = True, map_name: str = "Ascent") -> Match:
    red, blue = (13, 9) if red_wins else (9, 13)
    return Match(
        id=uuid.uuid4(),
        henrik_match_id=str(uuid.uuid4()),
        affinity="eu",
        map_name=map_name,
        started_at=START,
        is_completed=is_completed,
        red_score=red,
        blue_score=blue,
        winning_side="red" if red_wins else "blue",
        raw_payload={},
        imported_at=START,
        created_at=START,
        updated_at=START,
    )


def _series(team_a: Team, team_b: Team, *, format_: str, status: str = "draft") -> Series:
    return Series(
        id=uuid.uuid4(),
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format=format_,
        importance="regular",
        status=status,
        team_a_maps_won=0,
        team_b_maps_won=0,
        created_at=START,
        updated_at=START,
    )


def _game(
    series: Series,
    match: Match,
    number: int,
    *,
    team_a_rounds: int,
    team_b_rounds: int,
    winner_team_id: uuid.UUID | None,
    team_a_side: str = "red",
) -> SeriesGame:
    return SeriesGame(
        id=uuid.uuid4(),
        series_id=series.id,
        game_number=number,
        match_id=match.id,
        team_a_side=team_a_side,
        team_b_side="blue" if team_a_side == "red" else "red",
        team_a_rounds=team_a_rounds,
        team_b_rounds=team_b_rounds,
        winner_team_id=winner_team_id,
        created_at=START,
        updated_at=START,
    )


def _scenario(
    *, format_: str, winners: list[str], status: str = "draft"
) -> tuple[Series, list[SeriesGame], list[Match]]:
    """One series plus one game per ``winners`` entry (``"A"``/``"B"`` = the
    team that wins that map). Team A plays red; winners derive from the mapped
    round scores exactly as the service derives them."""
    team_a = _team("Alpha")
    team_b = _team("Beta")
    series = _series(team_a, team_b, format_=format_, status=status)
    matches: list[Match] = []
    games: list[SeriesGame] = []
    for number, winner in enumerate(winners, start=1):
        red_wins = winner == "A"
        match = _match(red_wins=red_wins, map_name=f"Map {number}")
        matches.append(match)
        team_a_rounds, team_b_rounds = (13, 9) if red_wins else (9, 13)
        winner_id = team_a.id if winner == "A" else (team_b.id if winner == "B" else None)
        games.append(
            _game(
                series,
                match,
                number,
                team_a_rounds=team_a_rounds,
                team_b_rounds=team_b_rounds,
                winner_team_id=winner_id,
            )
        )
    return series, games, matches


class ReadOnlySeriesRepository:
    """Read-only in-memory mirror of ``SeriesRepository``.

    The write surface is deliberately absent: any write/unknown method call on
    this repo fails the test loudly, so a preview implementation that tries to
    persist anything can never pass. Mirrors ``get_series_with_canonical_games``:
    each game's state is derived from the CURRENT in-memory ``Match`` row (a
    test simulates a canonical refresh by mutating a match's scores), never
    from the copied ``SeriesGame`` round/winner snapshot columns.
    """

    def __init__(self, series: Series, games: list[SeriesGame], matches: list[Match]) -> None:
        self.series = series
        self.games = games
        self.matches = {match.id: match for match in matches}
        self.calls: list[str] = []

    async def get_series_with_canonical_games(
        self, series_id: uuid.UUID
    ) -> tuple[Series | None, list[CanonicalGameSnapshot]]:
        self.calls.append("get_series_with_canonical_games")
        if self.series is None or self.series.id != series_id:
            return None, []
        rows = [game for game in self.games if game.series_id == series_id]
        rows.sort(key=lambda game: game.game_number)
        snapshots: list[CanonicalGameSnapshot] = []
        for game in rows:
            match = self.matches.get(game.match_id)
            if match is None:
                continue  # mirror the LEFT JOIN: a game without a match is dropped
            snapshots.append(
                CanonicalGameSnapshot(
                    game_id=game.id,
                    game_number=game.game_number,
                    match_id=game.match_id,
                    map_name=match.map_name,
                    team_a_side=game.team_a_side,
                    team_b_side=game.team_b_side,
                    stored_winner_team_id=game.winner_team_id,
                    red_score=match.red_score,
                    blue_score=match.blue_score,
                    is_completed=match.is_completed,
                )
            )
        return self.series, snapshots

    def __getattr__(self, name: str):
        raise AssertionError(f"unexpected SeriesRepository call/attribute: {name!r}")


class FakeMatchRepository:
    def __init__(self, matches: list[Match]) -> None:
        self.matches = {match.id: match for match in matches}

    async def get_matches_by_ids(self, match_ids: set[uuid.UUID]) -> list[Match]:
        return [match for match_id, match in self.matches.items() if match_id in match_ids]

    async def get_by_id(self, match_id: uuid.UUID) -> Match | None:
        return self.matches.get(match_id)


def _service(
    repo: ReadOnlySeriesRepository,
    matches: list[Match],
    session: FakeSession | None = None,
) -> SeriesService:
    return SeriesService(
        session=session or FakeSession(),  # type: ignore[arg-type]
        series_repo=repo,  # type: ignore[arg-type]
        match_repo=FakeMatchRepository(matches),  # type: ignore[arg-type]
    )


def _repo_for(series: Series, games: list[SeriesGame], matches: list[Match]) -> ReadOnlySeriesRepository:
    return ReadOnlySeriesRepository(series, games, matches)


# ------------------------------------------------------------- valid shapes


async def test_preview_valid_bo3_two_one_is_ready() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.team_a_maps_won == 2
    assert preview.team_b_maps_won == 1
    assert preview.calculated_winner_id == series.team_a_id
    assert preview.errors == []
    assert [game.game_number for game in preview.games] == [1, 2, 3]
    assert [game.map_name for game in preview.games] == ["Map 1", "Map 2", "Map 3"]


async def test_preview_valid_bo1_is_ready() -> None:
    series, games, matches = _scenario(format_="bo1", winners=["A"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.team_a_maps_won == 1
    assert preview.team_b_maps_won == 0
    assert preview.calculated_winner_id == series.team_a_id
    assert preview.errors == []


async def test_preview_valid_bo3_two_zero_is_ready() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.team_a_maps_won == 2
    assert preview.calculated_winner_id == series.team_a_id


async def test_preview_valid_bo5_three_two_is_ready() -> None:
    series, games, matches = _scenario(format_="bo5", winners=["A", "B", "A", "B", "A"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.team_a_maps_won == 3
    assert preview.team_b_maps_won == 2
    assert preview.calculated_winner_id == series.team_a_id
    assert preview.errors == []


# ------------------------------------------------------------ invalid shapes


async def test_preview_invalid_bo3_one_one_has_no_winner() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A", "B"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert preview.errors == ["no team reached the required wins"]
    # Map counts are still recomputed from the games (authoritative).
    assert preview.team_a_maps_won == 1
    assert preview.team_b_maps_won == 1
    assert preview.calculated_winner_id is None


async def test_preview_invalid_bo5_three_three_reports_clinch_and_bound() -> None:
    series, games, matches = _scenario(format_="bo5", winners=["A", "B", "A", "B", "A", "B"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert any("no game after the series was already clinched" in err for err in preview.errors)
    assert any("too many games for bo5" in err for err in preview.errors)
    assert preview.team_a_maps_won == 3
    assert preview.team_b_maps_won == 3
    assert preview.calculated_winner_id is None


async def test_preview_invalid_empty_series() -> None:
    series, games, matches = _scenario(format_="bo1", winners=[])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert preview.errors == ["no team reached the required wins"]
    assert preview.games == []
    assert preview.calculated_winner_id is None


async def test_preview_invalid_missing_side_mapping_reports_error() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A"])
    games[0].team_a_side = "purple"  # invalid literal (DB CHECK would reject it)
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game 1: invalid side mapping" in preview.errors


async def test_preview_invalid_same_side_mapping_reports_error() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A"])
    games[0].team_a_side = "red"
    games[0].team_b_side = "red"
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game 1: both teams on the same side" in preview.errors


async def test_preview_invalid_incomplete_match_reports_error() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A"])
    matches[0].is_completed = False
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game 1: match is not completed" in preview.errors


async def test_preview_invalid_gapped_game_numbers_reports_error() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    games[1].game_number = 3  # gap: numbers are 1 and 3
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game numbers must start at 1 and be contiguous" in preview.errors


async def test_preview_detects_stored_winner_disagreement() -> None:
    """A stored winner contradicting the mapped round totals is invalid."""
    series, games, matches = _scenario(format_="bo3", winners=["A"])
    games[0].winner_team_id = series.team_b_id  # corrupt: rounds say team A
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game 1: winner team does not match round scores" in preview.errors


# -------------------------------------------- canonical derivation (fix round 1)


async def test_preview_reflects_refreshed_canonical_scores() -> None:
    """A canonical match refresh that flips the map winner must be reflected:
    rounds and winner are derived from CURRENT canonical data, and the stale
    stored winner makes the series invalid (not silently echoed)."""
    series, games, matches = _scenario(format_="bo1", winners=["A"])
    # Simulate a canonical refresh: the match now says blue (team B) won.
    matches[0].red_score, matches[0].blue_score = 9, 13
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    # The response reflects current canonical data, not the stored copies.
    assert preview.games[0].team_a_rounds == 9
    assert preview.games[0].team_b_rounds == 13
    assert preview.games[0].winner_team_id == series.team_b_id  # derived, current
    assert preview.team_a_maps_won == 0
    assert preview.team_b_maps_won == 1
    assert preview.calculated_winner_id == series.team_b_id
    # The stale stored winner now disagrees with the derived one -> invalid.
    assert preview.valid is False
    assert "game 1: winner team does not match round scores" in preview.errors


async def test_preview_uses_current_canonical_rounds_not_stored_copies() -> None:
    """A refresh that changes the round margin (but not the winner) shows the
    current canonical rounds; map counts and validity are unchanged."""
    series, games, matches = _scenario(format_="bo1", winners=["A"])
    matches[0].red_score, matches[0].blue_score = 13, 11  # stored copy is 13-9
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.games[0].team_a_rounds == 13
    assert preview.games[0].team_b_rounds == 11  # current canonical, not stored 9
    assert preview.games[0].winner_team_id == series.team_a_id
    assert preview.calculated_winner_id == series.team_a_id


async def test_preview_scoreless_canonical_match_reports_error() -> None:
    """A canonical match with no round scores (raw DB artifact) is an error."""
    series, games, matches = _scenario(format_="bo1", winners=["A"])
    matches[0].red_score, matches[0].blue_score = None, None
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is False
    assert "game 1: match has no round scores" in preview.errors


async def test_preview_derives_rounds_through_persisted_side_mapping() -> None:
    """Canonical red 13-9 with team A on blue maps to team A 9 / team B 13 —
    the winner is derived through the persisted side mapping and the stored
    winner was derived the same way at attach time, so the series stays valid."""
    team_a = _team("Alpha")
    team_b = _team("Beta")
    series = _series(team_a, team_b, format_="bo1")
    match = _match(red_wins=True, map_name="Ascent")  # red 13-9
    game = _game(
        series,
        match,
        1,
        team_a_rounds=9,
        team_b_rounds=13,
        winner_team_id=team_b.id,
        team_a_side="blue",
    )
    repo = _repo_for(series, [game], [match])
    svc = _service(repo, [match])

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.games[0].team_a_rounds == 9
    assert preview.games[0].team_b_rounds == 13
    assert preview.games[0].winner_team_id == team_b.id
    assert preview.calculated_winner_id == team_b.id


# ------------------------------------------------------------- no mutation


async def test_preview_never_writes() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    # The stored row carries stale result columns (as a raw DB write could leave).
    series.team_a_maps_won = 0
    series.team_b_maps_won = 0
    series.calculated_winner_id = None
    repo = _repo_for(series, games, matches)
    session = FakeSession()
    svc = _service(repo, matches, session)

    preview = await svc.preview(series.id)

    # Preview recomputes from the games...
    assert preview.valid is True
    assert preview.team_a_maps_won == 2
    assert preview.calculated_winner_id == series.team_a_id
    # ...but never persists: the single consistent read ran, the row is
    # untouched, and the session was never committed or rolled back.
    assert repo.calls == ["get_series_with_canonical_games"]
    assert series.team_a_maps_won == 0
    assert series.team_b_maps_won == 0
    assert series.calculated_winner_id is None
    assert series.status == "draft"
    assert session.committed == 0
    assert session.rolled_back == 0


async def test_preview_works_on_finalized_series() -> None:
    """Preview is a read: the Task 12 draft-only gate (SERIES_ALREADY_FINALIZED)
    must not apply — a finalized series still derives its preview."""
    series, games, matches = _scenario(format_="bo3", winners=["A", "B", "A"], status="finalized")
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    preview = await svc.preview(series.id)

    assert preview.valid is True
    assert preview.team_a_maps_won == 2
    assert preview.calculated_winner_id == series.team_a_id


# -------------------------------------------------------------- not found


async def test_preview_missing_series_raises_series_not_found() -> None:
    series, games, matches = _scenario(format_="bo3", winners=["A"])
    repo = _repo_for(series, games, matches)
    svc = _service(repo, matches)

    with pytest.raises(AppError) as excinfo:
        await svc.preview(uuid.uuid4())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404
