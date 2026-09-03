"""SeriesService unit tests (plan Task 12; design §9.2, §10.3, App. B).

In-memory repository + fake session — no network, no DB. Covers:

- create: draft status, teams/format/importance persisted; ``team_a == team_b``
  → 409 ``SERIES_INVALID``; unknown team FK → 404 ``TEAM_NOT_FOUND``;
- attach: derives ``team_b_side``, both round scores, and the winner from the
  imported match; non-completed match → 422 ``MATCH_NOT_COMPLETED``; match
  already in another series → 409 ``MATCH_ALREADY_ASSIGNED_TO_SERIES``;
  duplicate game number in the same series → 409 ``SERIES_INVALID``; missing
  series/match → 404;
- attach/remove/update on a finalized series → 409 ``SERIES_ALREADY_FINALIZED``;
- remove and reorder in draft (recompute of map counts + calculated winner);
- update re-siding re-derives sides/rounds/winner from the match;
- update played_at in draft: only ``played_at`` changes (finalized → 409);
- delete: draft only.
"""

from __future__ import annotations

import types
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.errors import AppError
from app.db.models import Match, Series, SeriesGame, Team
from app.domain.series.bo import GameSnapshot
from app.schemas.series import (
    AttachGameRequest,
    SeriesCreate,
    SetGameOrderRequest,
    UpdateGameRequest,
    UpdateSeriesRequest,
)
from app.services.series_service import SeriesService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _constraint_error(constraint: str) -> IntegrityError:
    orig = types.SimpleNamespace(diag=types.SimpleNamespace(constraint_name=constraint))
    return IntegrityError("statement", {}, orig)


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


def _match(
    *,
    winning_side: str | None = "red",
    red_score: int | None = 13,
    blue_score: int | None = 9,
    is_completed: bool = True,
    map_name: str = "Ascent",
) -> Match:
    return Match(
        id=uuid.uuid4(),
        henrik_match_id=str(uuid.uuid4()),
        affinity="eu",
        map_name=map_name,
        started_at=START,
        is_completed=is_completed,
        red_score=red_score,
        blue_score=blue_score,
        winning_side=winning_side,
        raw_payload={},
        imported_at=START,
        created_at=START,
        updated_at=START,
    )


class InMemorySeriesRepository:
    """In-memory mirror of ``SeriesRepository`` over plain ORM objects.

    Mirrors the DB unique ``(series_id, game_number)`` and ``match_id``
    constraints and the ``series_team_a_id_fkey``/``series_team_b_id_fkey``
    foreign keys so the service's IntegrityError mapping is exercised.
    """

    def __init__(self, teams: dict[uuid.UUID, Team]) -> None:
        self.teams = teams
        self.series: dict[uuid.UUID, Series] = {}
        self.games: dict[uuid.UUID, SeriesGame] = {}
        self.matches: dict[uuid.UUID, Match] = {}
        self.external_quest_series_ids: dict[str, uuid.UUID] = {}
        # Simulates a concurrent create-or-get race: the losing request's
        # pre-lookup runs before the winner's insert commits, so it sees
        # nothing while the key already exists in the unique map. One-shot.
        self.miss_next_lookups = 0

    # ----------------------------------------------------------- reads

    async def get_by_id(self, series_id: uuid.UUID) -> Series | None:
        return self.series.get(series_id)

    async def get_by_external_quest_series_id(self, external_quest_series_id: str) -> Series | None:
        if self.miss_next_lookups > 0:
            self.miss_next_lookups -= 1
            return None
        series_id = self.external_quest_series_ids.get(external_quest_series_id)
        return self.series.get(series_id) if series_id is not None else None

    async def get_by_id_for_update(self, series_id: uuid.UUID) -> Series | None:
        # In-memory mirror of SELECT ... FOR UPDATE: no real locking needed.
        return self.series.get(series_id)

    async def list_series(self) -> list[Series]:
        return sorted(self.series.values(), key=lambda s: str(s.id))

    async def get_games(self, series_id: uuid.UUID) -> list[SeriesGame]:
        rows = [g for g in self.games.values() if g.series_id == series_id]
        rows.sort(key=lambda g: g.game_number)
        return rows

    async def get_games_by_series_ids(
        self, series_ids: set[uuid.UUID]
    ) -> dict[uuid.UUID, list[SeriesGame]]:
        return {series_id: await self.get_games(series_id) for series_id in series_ids}

    async def get_game_by_id(self, game_id: uuid.UUID) -> SeriesGame | None:
        return self.games.get(game_id)

    async def find_game_by_match_id(self, match_id: uuid.UUID) -> SeriesGame | None:
        return next((g for g in self.games.values() if g.match_id == match_id), None)

    async def find_game_by_number(
        self, series_id: uuid.UUID, game_number: int
    ) -> SeriesGame | None:
        return next(
            (
                g
                for g in self.games.values()
                if g.series_id == series_id and g.game_number == game_number
            ),
            None,
        )

    async def get_game_snapshots(self, series_id: uuid.UUID) -> list[GameSnapshot]:
        snapshots = []
        for game in await self.get_games(series_id):
            match = self.matches.get(game.match_id)
            snapshots.append(
                GameSnapshot(
                    game_number=game.game_number,
                    match_id=game.match_id,
                    team_a_side=game.team_a_side,
                    team_b_side=game.team_b_side,
                    team_a_rounds=game.team_a_rounds,
                    team_b_rounds=game.team_b_rounds,
                    winner_team_id=game.winner_team_id,
                    is_completed=match.is_completed if match is not None else True,
                )
            )
        return snapshots

    # ---------------------------------------------------------- writes

    async def create_series(
        self, *, team_a_id, team_b_id, format, importance, played_at, notes, external_quest_series_id=None,
        anchor_a_puuid=None, anchor_b_puuid=None,
    ) -> Series:
        if team_a_id not in self.teams or team_b_id not in self.teams:
            missing = "series_team_a_id_fkey" if team_a_id not in self.teams else "series_team_b_id_fkey"
            raise _constraint_error(missing)
        if external_quest_series_id is not None and external_quest_series_id in self.external_quest_series_ids:
            raise _constraint_error("series_external_quest_series_id_key")
        series = Series(
            id=uuid.uuid4(),
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format=format,
            importance=importance,
            status="draft",
            team_a_maps_won=0,
            team_b_maps_won=0,
            played_at=played_at,
            notes=notes,
            external_quest_series_id=external_quest_series_id,
            anchor_a_puuid=anchor_a_puuid,
            anchor_b_puuid=anchor_b_puuid,
            created_at=START,
            updated_at=START,
        )
        self.series[series.id] = series
        if external_quest_series_id is not None:
            self.external_quest_series_ids[external_quest_series_id] = series.id
        return series

    async def delete_series(self, series: Series) -> None:
        self.series.pop(series.id, None)
        for game_id in [gid for gid, g in self.games.items() if g.series_id == series.id]:
            self.games.pop(game_id, None)

    async def insert_game(
        self, *, series_id, game_number, match_id, team_a_side, team_b_side, team_a_rounds, team_b_rounds, winner_team_id
    ) -> SeriesGame:
        if any(g.series_id == series_id and g.game_number == game_number for g in self.games.values()):
            raise _constraint_error("series_games_number_key")
        if any(g.match_id == match_id for g in self.games.values()):
            raise _constraint_error("series_games_match_key")
        game = SeriesGame(
            id=uuid.uuid4(),
            series_id=series_id,
            game_number=game_number,
            match_id=match_id,
            team_a_side=team_a_side,
            team_b_side=team_b_side,
            team_a_rounds=team_a_rounds,
            team_b_rounds=team_b_rounds,
            winner_team_id=winner_team_id,
            created_at=START,
            updated_at=START,
        )
        self.games[game.id] = game
        return game

    async def delete_game(self, game: SeriesGame) -> None:
        self.games.pop(game.id, None)

    async def update_game(self, game: SeriesGame, **values) -> SeriesGame:
        game_number = values.get("game_number", game.game_number)
        if any(
            g.series_id == game.series_id and g.id != game.id and g.game_number == game_number
            for g in self.games.values()
        ):
            raise _constraint_error("series_games_number_key")
        for key, value in values.items():
            setattr(game, key, value)
        return game

    async def swap_game_numbers(self, game: SeriesGame, other: SeriesGame) -> None:
        # In-memory mirror of the single-statement atomic swap.
        game.game_number, other.game_number = other.game_number, game.game_number

    async def reorder_games(self, series_id: uuid.UUID, desired: dict[uuid.UUID, int]) -> None:
        # In-memory mirror of the repo's two-phase renumber (no DB flush here;
        # the in-memory rows track ``game_number`` directly). The service holds
        # the (fake) series lock and has validated the absolute targets.
        games = await self.get_games(series_id)
        n = len(games)
        for game in games:
            game.game_number += n
        for game in games:
            game.game_number = desired[game.id]

    async def update_series_result(
        self, series, *, team_a_maps_won, team_b_maps_won, calculated_winner_id
    ) -> Series:
        series.team_a_maps_won = team_a_maps_won
        series.team_b_maps_won = team_b_maps_won
        series.calculated_winner_id = calculated_winner_id
        return series

    async def update_played_at(self, series: Series, played_at) -> Series:
        series.played_at = played_at
        return series


class FakeMatchRepository:
    def __init__(self, matches: dict[uuid.UUID, Match]) -> None:
        self.matches = matches
        # ``{match_id: {puuid: side}}`` — mirrors what the real repository
        # reads out of ``match_players`` for the anchor helpers.
        self.anchor_sides: dict[uuid.UUID, dict[str, str]] = {}

    async def get_by_id(self, match_id: uuid.UUID) -> Match | None:
        return self.matches.get(match_id)

    async def get_matches_by_ids(self, match_ids: set[uuid.UUID]) -> list[Match]:
        return [m for mid, m in self.matches.items() if mid in match_ids]

    async def get_anchor_player_sides(
        self, match_ids: list[uuid.UUID], anchor_a: str, anchor_b: str
    ) -> dict[uuid.UUID, dict[str, str]]:
        out: dict[uuid.UUID, dict[str, str]] = {}
        for match_id in match_ids:
            selected = {
                p: s for p, s in self.anchor_sides.get(match_id, {}).items() if p in (anchor_a, anchor_b)
            }
            if selected:
                out[match_id] = selected
        return out

    async def get_anchor_opposing_matches(
        self, anchor_a: str | None, anchor_b: str | None
    ) -> list[tuple[Match, str]]:
        if anchor_a is None or anchor_b is None:
            return []
        out: list[tuple[Match, str]] = []
        for match_id, sides in self.anchor_sides.items():
            side_a = sides.get(anchor_a)
            side_b = sides.get(anchor_b)
            if side_a is None or side_b is None or side_a == side_b:
                continue
            match = self.matches.get(match_id)
            if match is not None:
                out.append((match, side_a))
        # Mirror the repository's ``started_at DESC, id DESC`` order.
        out.sort(key=lambda pair: (pair[0].started_at, pair[0].id), reverse=True)
        return out


def _service(
    repo: InMemorySeriesRepository,
    session: FakeSession | None = None,
    match_repo: FakeMatchRepository | None = None,
) -> SeriesService:
    return SeriesService(
        session=session or FakeSession(),  # type: ignore[arg-type]
        series_repo=repo,  # type: ignore[arg-type]
        match_repo=match_repo or FakeMatchRepository(repo.matches),  # type: ignore[arg-type]
    )


def _harness(*, format_: str = "bo3"):
    """Two teams, one red-winning match, an empty series, and a service."""
    team_a = _team("Alpha")
    team_b = _team("Beta")
    match = _match()
    repo = InMemorySeriesRepository({team_a.id: team_a, team_b.id: team_b})
    repo.matches[match.id] = match
    svc = _service(repo)
    return team_a, team_b, match, repo, svc


async def _scenario(*, format_: str = "bo3", winners: list[str] | None = None):
    """A draft series with one game per ``winners`` entry (``"A"`` = team A
    wins, ``"B"`` = team B wins). Returns
    ``(team_a, team_b, series, games, matches, svc)`` — the ready service so
    the absolute-reorder tests can mutate and inspect the same in-memory rows.
    """
    winners = winners or ["A", "B", "A"]
    team_a = _team("Alpha")
    team_b = _team("Beta")
    repo = InMemorySeriesRepository({team_a.id: team_a, team_b.id: team_b})
    svc = _service(repo)
    matches: dict[int, Match] = {}
    series = await svc.create(
        SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format=format_, importance="regular")
    )
    games = []
    for number, winner in enumerate(winners, start=1):
        if winner == "A":
            match = _match(map_name=f"Map {number}")
        else:
            match = _match(winning_side="blue", red_score=9, blue_score=13, map_name=f"Map {number}")
        matches[number] = match
        repo.matches[match.id] = match
        games.append(
            await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=number, team_a_side="red"))
        )
    return team_a, team_b, series, games, matches, svc


# ------------------------------------------------------------------ create


async def test_create_draft_series() -> None:
    team_a, team_b, _, repo, svc = _harness()

    series = await svc.create(
        SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="playoff")
    )

    assert series.status == "draft"
    assert series.team_a_id == team_a.id
    assert series.team_b_id == team_b.id
    assert series.format == "bo3"
    assert series.importance == "playoff"
    assert series.team_a_maps_won == 0
    assert series.team_b_maps_won == 0
    assert series.calculated_winner_id is None
    assert repo.series[series.id] is series


async def test_create_persists_played_at_and_notes() -> None:
    team_a, team_b, _, _repo, svc = _harness()

    series = await svc.create(
        SeriesCreate(
            team_a_id=team_a.id,
            team_b_id=team_b.id,
            format="bo1",
            importance="finals",
            played_at=START,
            notes="grand final",
        )
    )

    assert series.played_at == START
    assert series.notes == "grand final"


async def test_create_same_team_raises_series_invalid() -> None:
    _, _, _, _, svc = _harness()
    team_id = uuid.uuid4()

    with pytest.raises(AppError) as excinfo:
        await svc.create(
            SeriesCreate(team_a_id=team_id, team_b_id=team_id, format="bo3", importance="regular")
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_create_unknown_team_maps_to_team_not_found() -> None:
    team_a, _team_b, _, repo, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.create(
            SeriesCreate(
                team_a_id=team_a.id,
                team_b_id=uuid.uuid4(),
                format="bo3",
                importance="regular",
            )
        )

    assert excinfo.value.code == "TEAM_NOT_FOUND"
    assert excinfo.value.status == 404
    assert repo.series == {}  # nothing persisted


# ------------------------------------------------------------------ attach


async def test_attach_derives_sides_rounds_and_winner() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    assert game.team_a_side == "red"
    assert game.team_b_side == "blue"  # derived opposite
    assert game.team_a_rounds == 13  # red score
    assert game.team_b_rounds == 9  # blue score
    assert game.winner_team_id == team_a.id  # red winner -> team A
    # authoritative recompute persisted on the series
    assert series.team_a_maps_won == 1
    assert series.team_b_maps_won == 0
    assert series.calculated_winner_id == team_a.id


async def test_attach_blue_side_maps_scores_and_winner_to_team_b() -> None:
    team_a, team_b, match, _, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="blue"))

    assert game.team_a_side == "blue"
    assert game.team_b_side == "red"
    assert game.team_a_rounds == 9  # blue score mapped to team A
    assert game.team_b_rounds == 13
    assert game.winner_team_id == team_b.id  # red winner -> team B
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id == team_b.id


async def test_attach_accumulates_series_result() -> None:
    team_a, team_b, match, repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    blue_wins = _match(winning_side="blue", red_score=8, blue_score=13, map_name="Bind")
    third_a_win = _match(winning_side="red", red_score=13, blue_score=6, map_name="Haven")
    repo.matches[blue_wins.id] = blue_wins
    repo.matches[third_a_win.id] = third_a_win

    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=blue_wins.id, game_number=2, team_a_side="red"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=third_a_win.id, game_number=3, team_a_side="red"))

    # A, B, A -> 2-1 with team A the calculated winner
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id == team_a.id


async def test_attach_non_completed_match_raises_match_not_completed() -> None:
    team_a, team_b, _, repo, svc = _harness()
    incomplete = _match(is_completed=False)
    repo.matches[incomplete.id] = incomplete
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=incomplete.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "MATCH_NOT_COMPLETED"
    assert excinfo.value.status == 422


async def test_attach_missing_match_raises_match_not_found() -> None:
    team_a, team_b, _, _, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=uuid.uuid4(), game_number=1, team_a_side="red"))

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_attach_match_already_in_another_series_raises() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    first = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    second = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(first.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(second.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "MATCH_ALREADY_ASSIGNED_TO_SERIES"
    assert excinfo.value.status == 409


async def test_attach_duplicate_game_number_raises_series_invalid() -> None:
    team_a, team_b, match, repo, svc = _harness()
    other_match = _match(winning_side="blue", red_score=8, blue_score=13)
    repo.matches[other_match.id] = other_match
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=other_match.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_attach_to_missing_series_raises_series_not_found() -> None:
    _, _, match, _, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(uuid.uuid4(), AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_attach_to_finalized_series_raises_series_already_finalized() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    series.status = "finalized"

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "SERIES_ALREADY_FINALIZED"
    assert excinfo.value.status == 409


# ------------------ anchor-derived attach side + relevant matches (pinned contract)


async def _anchored_harness(
    *, format_: str = "bo3", sides: dict[str, str] | None = None
) -> tuple[Team, Team, Series, Match, SeriesService]:
    """A red-winning match with optional anchor sides, an anchored draft series,
    and the service wired to a match repo carrying those sides."""
    team_a, team_b, match, repo, _ = _harness()
    match_repo = FakeMatchRepository(repo.matches)
    if sides is not None:
        match_repo.anchor_sides[match.id] = sides
    svc = _service(repo, match_repo=match_repo)
    series = await svc.create(
        SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format=format_, importance="regular")
    )
    series.anchor_a_puuid = "puuid_a"
    series.anchor_b_puuid = "puuid_b"
    return team_a, team_b, series, match, svc


async def test_attach_omitted_side_derives_team_a_side_from_anchors() -> None:
    team_a, _team_b, series, match, svc = await _anchored_harness(
        sides={"puuid_a": "red", "puuid_b": "blue"}
    )

    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1))

    assert game.team_a_side == "red"  # anchor A's side
    assert game.team_b_side == "blue"  # derived opposite
    assert game.team_a_rounds == 13  # red score
    assert game.team_b_rounds == 9  # blue score
    assert game.winner_team_id == team_a.id  # red winner -> team A
    assert series.team_a_maps_won == 1
    assert series.calculated_winner_id == team_a.id


async def test_attach_omitted_side_derives_blue_when_anchor_a_is_blue() -> None:
    _team_a, team_b, series, match, svc = await _anchored_harness(
        sides={"puuid_a": "blue", "puuid_b": "red"}
    )

    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1))

    assert game.team_a_side == "blue"
    assert game.team_b_side == "red"
    assert game.team_a_rounds == 9  # blue score mapped to team A
    assert game.team_b_rounds == 13
    assert game.winner_team_id == team_b.id


async def test_attach_omitted_side_missing_anchor_raises_anchor_not_in_match() -> None:
    _, _, series, match, svc = await _anchored_harness(
        sides={"puuid_a": "red"}  # anchor B absent from the match
    )

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1))

    assert excinfo.value.code == "ANCHOR_NOT_IN_MATCH"
    assert excinfo.value.status == 409


async def test_attach_omitted_side_same_side_anchors_raises_anchor_not_in_match() -> None:
    _, _, series, match, svc = await _anchored_harness(
        sides={"puuid_a": "red", "puuid_b": "red"}
    )

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1))

    assert excinfo.value.code == "ANCHOR_NOT_IN_MATCH"
    assert excinfo.value.status == 409
    assert "opposing sides" in excinfo.value.message


async def test_attach_omitted_side_series_without_anchors_raises_series_invalid() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "no anchor players" in excinfo.value.message


async def test_attach_explicit_side_still_honored_when_anchors_present() -> None:
    _team_a, team_b, series, match, svc = await _anchored_harness(
        sides={"puuid_a": "red", "puuid_b": "blue"}
    )

    # The explicit side wins over the anchor-derived mapping (backward-compat).
    game = await svc.attach_game(
        series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="blue")
    )

    assert game.team_a_side == "blue"
    assert game.team_b_side == "red"
    assert game.team_a_rounds == 9
    assert game.team_b_rounds == 13
    assert game.winner_team_id == team_b.id


async def test_relevant_matches_returns_only_opposing_anchor_matches() -> None:
    team_a, team_b, _first_match, repo, _ = _harness()
    opposing = _match(map_name="Ascent")
    opposing.started_at = START
    same_side = _match(map_name="Bind")
    same_side.started_at = START
    missing_b = _match(map_name="Haven")
    missing_b.started_at = START
    no_anchor_rows = _match(map_name="Split")
    no_anchor_rows.started_at = START
    blue_anchor_a = _match(map_name="Icebox")
    blue_anchor_a.started_at = START
    for m in (opposing, same_side, missing_b, no_anchor_rows, blue_anchor_a):
        repo.matches[m.id] = m
    match_repo = FakeMatchRepository(repo.matches)
    match_repo.anchor_sides = {
        opposing.id: {"puuid_a": "red", "puuid_b": "blue"},
        same_side.id: {"puuid_a": "red", "puuid_b": "red"},
        missing_b.id: {"puuid_a": "red"},
        blue_anchor_a.id: {"puuid_a": "blue", "puuid_b": "red"},
        no_anchor_rows.id: {"puuid_c": "red", "puuid_d": "blue"},
    }
    svc = _service(repo, match_repo=match_repo)
    series = await svc.create(
        SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular")
    )
    series.anchor_a_puuid = "puuid_a"
    series.anchor_b_puuid = "puuid_b"

    rows = await svc.get_relevant_matches(series.id)

    by_match = {match.id: side for match, side in rows}
    assert set(by_match) == {opposing.id, blue_anchor_a.id}
    assert by_match[opposing.id] == "red"
    assert by_match[blue_anchor_a.id] == "blue"


async def test_relevant_matches_empty_when_series_has_no_anchors() -> None:
    team_a, team_b, match, repo, svc = _harness()
    match_repo = FakeMatchRepository(repo.matches)
    match_repo.anchor_sides[match.id] = {"puuid_a": "red", "puuid_b": "blue"}
    svc = _service(repo, match_repo=match_repo)
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    assert await svc.get_relevant_matches(series.id) == []


async def test_relevant_matches_missing_series_raises_series_not_found() -> None:
    _, _, _, _, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.get_relevant_matches(uuid.uuid4())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


# ------------------------- winner derivation from rounds (fix round 1)


async def test_winner_derived_from_rounds_not_winning_side() -> None:
    """A match whose ``winning_side`` contradicts its scores must still map the
    round-score winner onto the series teams (rounds are authoritative)."""
    team_a, team_b, _, repo, svc = _harness()
    contradictory = _match(winning_side="blue", red_score=13, blue_score=9)  # blue won? no: red 13
    repo.matches[contradictory.id] = contradictory
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    game = await svc.attach_game(series.id, AttachGameRequest(match_id=contradictory.id, game_number=1, team_a_side="red"))

    assert game.team_a_rounds == 13
    assert game.team_b_rounds == 9
    assert game.winner_team_id == team_a.id  # rounds winner, never winning_side
    assert series.calculated_winner_id == team_a.id


async def test_attach_scoreless_match_rejected() -> None:
    team_a, team_b, _, repo, svc = _harness()
    scoreless = _match(red_score=None, blue_score=9)
    repo.matches[scoreless.id] = scoreless
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=scoreless.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "round scores" in excinfo.value.message


async def test_attach_tied_rounds_rejected() -> None:
    team_a, team_b, _, repo, svc = _harness()
    tied = _match(red_score=13, blue_score=13)
    repo.matches[tied.id] = tied
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=tied.id, game_number=1, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "tied round score" in excinfo.value.message


async def test_persisted_winner_disagreement_rejected_on_next_mutation() -> None:
    """A game whose stored winner contradicts its round totals (e.g. written
    directly to the DB) must be rejected by the next mutation's validation."""
    team_a, team_b, match, repo, svc = _harness()
    second = _match(winning_side="blue", red_score=8, blue_score=13)
    repo.matches[second.id] = second
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    assert game.winner_team_id == team_a.id
    # Corrupt the persisted winner (bypassing the service, as a raw DB write would).
    game.winner_team_id = team_b.id

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=second.id, game_number=2, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "winner team does not match round scores" in excinfo.value.message


# ------------------------- draft BO validation on mutations (fix round 1)


async def test_attach_second_game_to_bo1_rejected() -> None:
    team_a, team_b, match, repo, svc = _harness(format_="bo1")
    second = _match(winning_side="blue", red_score=8, blue_score=13)
    repo.matches[second.id] = second
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo1", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=second.id, game_number=2, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert any(word in excinfo.value.message for word in ("clinched", "too many games"))


async def test_attach_after_clinch_rejected() -> None:
    """BO3: after a 2-0 sweep, a third game is a game after the clinch."""
    team_a, team_b, match, repo, svc = _harness()
    second = _match(winning_side="red", red_score=13, blue_score=7, map_name="Bind")
    third = _match(winning_side="red", red_score=13, blue_score=5, map_name="Haven")
    repo.matches[second.id] = second
    repo.matches[third.id] = third
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=second.id, game_number=2, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=third.id, game_number=3, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "clinched" in excinfo.value.message


async def test_attach_gapped_game_number_rejected() -> None:
    team_a, team_b, match, repo, svc = _harness()
    third = _match(winning_side="blue", red_score=8, blue_score=13, map_name="Bind")
    repo.matches[third.id] = third
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.attach_game(series.id, AttachGameRequest(match_id=third.id, game_number=3, team_a_side="red"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "contiguous" in excinfo.value.message


# ------------------------- invalid side literals (fix round 1)


async def test_resolve_sides_maps_invalid_literal_to_invalid_side_mapping() -> None:
    from app.services.series_service import _resolve_sides

    assert _resolve_sides("red") == ("red", "blue")
    assert _resolve_sides("blue") == ("blue", "red")
    with pytest.raises(AppError) as excinfo:
        _resolve_sides("Green")
    assert excinfo.value.code == "INVALID_SIDE_MAPPING"
    assert excinfo.value.status == 400


# ------------------------------------------------------------------ remove


async def test_remove_game_in_draft_recomputes_result() -> None:
    team_a, team_b, match, repo, svc = _harness()
    b_win = _match(winning_side="blue", red_score=8, blue_score=13, map_name="Bind")
    a_win_2 = _match(winning_side="red", red_score=13, blue_score=7, map_name="Haven")
    repo.matches[b_win.id] = b_win
    repo.matches[a_win_2.id] = a_win_2
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo5", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=b_win.id, game_number=2, team_a_side="red"))
    game_3 = await svc.attach_game(series.id, AttachGameRequest(match_id=a_win_2.id, game_number=3, team_a_side="red"))
    # Removing the last game leaves a valid, resumable 1-1 draft.
    await svc.remove_game(series.id, game_3.id)

    assert series.team_a_maps_won == 1
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id is None
    assert [game.game_number for game in await svc.get_games(series.id)] == [1, 2]


async def test_remove_game_creating_gap_is_rejected() -> None:
    team_a, team_b, match, repo, svc = _harness()
    b_win = _match(winning_side="blue", red_score=8, blue_score=13, map_name="Bind")
    a_win_2 = _match(winning_side="red", red_score=13, blue_score=7, map_name="Haven")
    repo.matches[b_win.id] = b_win
    repo.matches[a_win_2.id] = a_win_2
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo5", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    game_2 = await svc.attach_game(series.id, AttachGameRequest(match_id=b_win.id, game_number=2, team_a_side="red"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=a_win_2.id, game_number=3, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.remove_game(series.id, game_2.id)

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_remove_missing_game_raises_series_not_found() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    with pytest.raises(AppError) as excinfo:
        await svc.remove_game(series.id, uuid.uuid4())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_remove_game_from_finalized_series_raises() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    series.status = "finalized"

    with pytest.raises(AppError) as excinfo:
        await svc.remove_game(series.id, game.id)

    assert excinfo.value.code == "SERIES_ALREADY_FINALIZED"


# ------------------------------------------------------------------ update


async def test_swap_occupied_game_numbers_reorders_in_draft() -> None:
    team_a, team_b, match, repo, svc = _harness()
    b_win = _match(winning_side="blue", red_score=8, blue_score=13, map_name="Bind")
    a_win_2 = _match(winning_side="red", red_score=13, blue_score=7, map_name="Haven")
    for m in (b_win, a_win_2):
        repo.matches[m.id] = m
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo5", importance="regular"))
    game_1 = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    game_2 = await svc.attach_game(series.id, AttachGameRequest(match_id=b_win.id, game_number=2, team_a_side="red"))
    game_3 = await svc.attach_game(series.id, AttachGameRequest(match_id=a_win_2.id, game_number=3, team_a_side="red"))

    # PATCH game 1 onto the occupied number 3 -> the two games atomically swap.
    updated = await svc.update_game(series.id, game_1.id, UpdateGameRequest(game_number=3))

    assert updated.game_number == 3
    by_number = {game.game_number: game for game in await svc.get_games(series.id)}
    assert set(by_number) == {1, 2, 3}
    assert by_number[3].id == game_1.id
    assert by_number[1].id == game_3.id
    assert by_number[2].id == game_2.id
    # Shape is unchanged by a pure reorder: still A, B, A -> 2-1 team A.
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id == team_a.id


async def test_update_side_re_derives_sides_rounds_and_winner() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    assert game.winner_team_id == team_a.id

    updated = await svc.update_game(series.id, game.id, UpdateGameRequest(team_a_side="blue"))

    assert updated.team_a_side == "blue"
    assert updated.team_b_side == "red"
    assert updated.team_a_rounds == 9  # blue score now on team A
    assert updated.team_b_rounds == 13
    assert updated.winner_team_id == team_b.id
    assert series.team_a_maps_won == 0
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id == team_b.id


async def test_update_game_number_only_preserves_sides() -> None:
    team_a, team_b, match, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    game = await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    updated = await svc.update_game(series.id, game.id, UpdateGameRequest(game_number=1))

    assert updated.team_a_side == "red"
    assert updated.team_b_side == "blue"
    assert updated.winner_team_id == team_a.id


# ------------------------------------------------------------------ update played_at


async def test_update_played_at_in_draft_changes_only_played_at() -> None:
    team_a, team_b, match, repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    series.notes = "keep me"

    updated = await svc.update_played_at(
        series.id, UpdateSeriesRequest(played_at=START)
    )

    assert updated is series
    assert updated.played_at == START
    # No other field changes.
    assert updated.notes == "keep me"
    assert updated.team_a_id == team_a.id
    assert updated.team_b_id == team_b.id
    assert updated.status == "draft"
    assert updated.team_a_maps_won == 1
    assert updated.team_b_maps_won == 0
    assert updated.calculated_winner_id == team_a.id
    assert updated.finalized_at is None
    assert repo.series[series.id].played_at == START


async def test_update_played_at_on_finalized_series_rejects() -> None:
    team_a, team_b, _, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    series.status = "finalized"

    with pytest.raises(AppError) as excinfo:
        await svc.update_played_at(series.id, UpdateSeriesRequest(played_at=START))

    assert excinfo.value.code == "SERIES_ALREADY_FINALIZED"
    assert excinfo.value.status == 409
    assert series.played_at is None  # nothing changed


async def test_update_played_at_missing_series_raises_series_not_found() -> None:
    _, _, _, _, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.update_played_at(uuid.uuid4(), UpdateSeriesRequest(played_at=START))

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_update_played_at_rejects_future_date() -> None:
    """F1: a future ``played_at`` on a draft is rejected (422 SERIES_INVALID) —
    a future-dated RATED finalize would brick the D8 chronological guard."""
    team_a, team_b, _, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    with pytest.raises(AppError) as excinfo:
        await svc.update_played_at(
            series.id, UpdateSeriesRequest(played_at=datetime.now(UTC) + timedelta(days=30))
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "future" in excinfo.value.message
    assert series.played_at is None  # nothing changed


# ------------------------------------------------------------------ delete


async def test_delete_draft_series() -> None:
    team_a, team_b, match, repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))

    await svc.delete(series.id)

    assert series.id not in repo.series
    assert repo.games == {}  # games cascade


async def test_delete_finalized_series_raises() -> None:
    team_a, team_b, _, _repo, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    series.status = "finalized"

    with pytest.raises(AppError) as excinfo:
        await svc.delete(series.id)

    assert excinfo.value.code == "SERIES_ALREADY_FINALIZED"
    assert excinfo.value.status == 409


async def test_delete_missing_series_raises_series_not_found() -> None:
    _, _, _, _, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.delete(uuid.uuid4())

    assert excinfo.value.code == "SERIES_NOT_FOUND"


# -------------------------------------------------------------------- reads


async def test_get_returns_series() -> None:
    team_a, team_b, _, _, svc = _harness()
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))

    assert await svc.get(series.id) is series


async def test_get_missing_series_raises_series_not_found() -> None:
    _, _, _, _, svc = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.get(uuid.uuid4())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_list_returns_all_series() -> None:
    team_a, team_b, _, _, svc = _harness()
    first = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    second = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo1", importance="regular"))

    assert {s.id for s in await svc.list()} == {first.id, second.id}


async def test_commit_happens_once_per_mutation() -> None:
    team_a, team_b, match, repo, svc = _harness()
    session = FakeSession()
    svc = _service(repo, session)
    series = await svc.create(SeriesCreate(team_a_id=team_a.id, team_b_id=team_b.id, format="bo3", importance="regular"))
    assert session.committed == 1

    await svc.attach_game(series.id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red"))
    assert session.committed == 2


# --------------------------- create-or-get by external_quest_series_id (D3)


async def test_create_or_get_returns_existing_series_for_reused_external_key() -> None:
    team_a, team_b = _team("Alpha"), _team("Beta")
    svc = _service(InMemorySeriesRepository({team_a.id: team_a, team_b.id: team_b}))
    req = SeriesCreate(
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format="bo3",
        importance="regular",
        external_quest_series_id="quest-series-1",
    )
    first, created = await svc.create_or_get(req)
    assert created is True
    assert first.external_quest_series_id == "quest-series-1"

    second, created = await svc.create_or_get(req)
    assert created is False
    assert second.id == first.id  # convergence by external key


async def test_create_or_get_race_reconciles_on_unique_violation() -> None:
    """The losing side of a concurrent create-or-get: the pre-lookup misses
    (the winner hasn't committed yet), the insert trips the
    ``series_external_quest_series_id_key`` unique index, and the service
    re-reads the existing row after rollback (deviation from brief: the brief's
    tests only cover the deterministic fast-path and the preseeded-key path)."""
    team_a, team_b = _team("Alpha"), _team("Beta")
    repo = InMemorySeriesRepository({team_a.id: team_a, team_b.id: team_b})
    session = FakeSession()
    svc = _service(repo, session)
    req = SeriesCreate(
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format="bo3",
        importance="regular",
        external_quest_series_id="quest-series-1",
    )
    existing, _created = await svc.create_or_get(req)
    repo.miss_next_lookups = 1  # the losing pre-lookup sees nothing

    series, created = await svc.create_or_get(req)
    assert created is False
    assert session.rolled_back == 1  # the failed insert was rolled back
    assert series.id == existing.id  # reconciled on the key, no new identity
    assert set(repo.series) == {existing.id}  # nothing extra persisted


# --------------------------- absolute desired order PUT (delta D9)


async def test_set_game_order_swaps_absolute_order() -> None:
    # bo5 (not bo3): reordering the brief's [A,B,A] winners into A,A,B would be
    # a game-after-clinch in bo3, which the platform's own draft validation
    # rejects; in bo5 A,A,B is a valid resumable 2-1 draft (see test data note).
    _team_a, _team_b, series, games, _matches, svc = await _scenario(format_="bo5", winners=["A", "B", "A"])
    g1, g2, g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    ordered = await svc.set_game_order(
        series.id,
        SetGameOrderRequest(games=[
            {"game_id": g3, "game_number": 1},
            {"game_id": g1, "game_number": 2},
            {"game_id": g2, "game_number": 3},
        ]),
    )
    assert [g.game_number for g in sorted(ordered, key=lambda g: g.game_number)] == [1, 2, 3]
    by_id = {g.id: g for g in ordered}
    assert by_id[g1].game_number == 2
    assert by_id[g2].game_number == 3
    assert by_id[g3].game_number == 1


async def test_set_game_order_is_idempotent() -> None:
    _team_a, _team_b, series, games, _matches, svc = await _scenario(format_="bo3", winners=["A", "B", "A"])
    ordered = await svc.set_game_order(
        series.id,
        SetGameOrderRequest(games=[
            {"game_id": g.id, "game_number": g.game_number} for g in games
        ]),
    )
    assert len(ordered) == 3  # no-op converges, returns the current order


async def test_set_game_order_rejects_missing_game() -> None:
    _team_a, _team_b, series, games, _matches, svc = await _scenario(format_="bo3", winners=["A", "B", "A"])
    g1, g2, _g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    with pytest.raises(AppError) as excinfo:
        await svc.set_game_order(
            series.id,
            SetGameOrderRequest(games=[
                {"game_id": g1, "game_number": 1},
                {"game_id": g2, "game_number": 2},
            ]),
        )
    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_set_game_order_rejects_non_contiguous_numbers() -> None:
    _team_a, _team_b, series, games, _matches, svc = await _scenario(format_="bo3", winners=["A", "B", "A"])
    g1, g2, g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    with pytest.raises(AppError) as excinfo:
        await svc.set_game_order(
            series.id,
            SetGameOrderRequest(games=[
                {"game_id": g1, "game_number": 1},
                {"game_id": g2, "game_number": 2},
                {"game_id": g3, "game_number": 5},
            ]),
        )
    assert excinfo.value.code == "SERIES_INVALID"
