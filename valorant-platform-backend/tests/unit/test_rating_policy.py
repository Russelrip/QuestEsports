"""Rating policy resolution tests (plan Task 14; design §10.3, App. B).

The pure ``resolve_rating_policy`` separates the calculated winner (derived
strictly from the imported games) from the official winner and resolves the
explicit rating mode. In-memory repository + fake session for the service
wiring — no network, no DB. Covers:

- no override → ``normal``; official == calculated → ``normal``;
- override without a reason → ``RATING_POLICY_REQUIRED``; override with a
  reason but no explicit mode → ``RATING_POLICY_REQUIRED`` (ambiguous);
- override with reason + ``manual_override`` → ``rate_series=true``;
- ``forfeit_no_rating`` → ``rate_series=false`` (no events, no counters, but
  the result is recorded);
- ``forfeit_result_only`` → official winner + counters, no rating;
- an explicit mode is honored even when the official winner matches the
  calculated winner (a forfeit declared after the maps were played);
- the official winner must be a team of the series (else ``SERIES_INVALID``);
- the calculated winner derives from CURRENT canonical match scores through the
  persisted side mappings (single joined read, the preview contract) — a
  refreshed canonical match flips the policy's calculated winner, and the parse
  never writes (one read only, session never committed/rolled back).
"""

from __future__ import annotations

import uuid
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.errors import AppError
from app.db.models import Match, Series, SeriesGame, Team
from app.domain.ratings.policy import (
    RATING_MODES,
    RatingPolicyDecision,
    RatingPolicyRequiredError,
    resolve_rating_policy,
)
from app.domain.series.bo import CanonicalGameSnapshot
from app.schemas.series import FinalizeRequest
from app.services.series_service import SeriesService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

TEAM_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TEAM_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


# ------------------------------------------------------------------ pure policy


def test_rating_modes_are_exactly_the_locked_modes() -> None:
    assert RATING_MODES == (
        "normal",
        "unrated",
        "forfeit_no_rating",
        "forfeit_result_only",
        "manual_override",
    )


def test_no_override_defaults_to_normal_and_calculated_winner() -> None:
    decision = resolve_rating_policy(
        official_winner_id=None, calculated_winner_id=TEAM_A, override_reason=None
    )

    assert decision.mode == "normal"
    assert decision.rate_series is True
    # Official winner defaults to the calculated winner.
    assert decision.official_winner_id == TEAM_A
    assert decision.override_reason is None


def test_official_equals_calculated_is_normal() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A, calculated_winner_id=TEAM_A, override_reason=None
    )

    assert decision.mode == "normal"
    assert decision.rate_series is True
    assert decision.official_winner_id == TEAM_A


def test_override_without_reason_raises_policy_required() -> None:
    with pytest.raises(RatingPolicyRequiredError):
        resolve_rating_policy(
            official_winner_id=TEAM_B,
            calculated_winner_id=TEAM_A,
            override_reason=None,
            explicit_mode="manual_override",
        )


def test_override_with_blank_reason_raises_policy_required() -> None:
    for blank in ("", "   ", "\t\n  "):
        with pytest.raises(RatingPolicyRequiredError):
            resolve_rating_policy(
                official_winner_id=TEAM_B,
                calculated_winner_id=TEAM_A,
                override_reason=blank,
                explicit_mode="manual_override",
            )


def test_override_with_reason_but_no_mode_is_ambiguous() -> None:
    with pytest.raises(RatingPolicyRequiredError):
        resolve_rating_policy(
            official_winner_id=TEAM_B,
            calculated_winner_id=TEAM_A,
            override_reason="eligibility ruling",
            explicit_mode=None,
        )


def test_override_with_reason_and_manual_override_rates() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_B,
        calculated_winner_id=TEAM_A,
        override_reason="eligibility ruling",
        explicit_mode="manual_override",
    )

    assert decision.mode == "manual_override"
    assert decision.rate_series is True
    assert decision.official_winner_id == TEAM_B
    assert decision.override_reason == "eligibility ruling"


def test_override_with_explicit_normal_mode_is_honored() -> None:
    """An explicitly selected mode is honored even for an override: the plan
    says "if the payload carries a mode, honor it"; the override itself is
    never hidden (official_winner_id + reason are carried on the decision)."""
    decision = resolve_rating_policy(
        official_winner_id=TEAM_B,
        calculated_winner_id=TEAM_A,
        override_reason="scores corrected after review",
        explicit_mode="normal",
    )

    assert decision.mode == "normal"
    assert decision.rate_series is True
    assert decision.official_winner_id == TEAM_B


def test_forfeit_no_rating_never_rates() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_B,
        calculated_winner_id=TEAM_A,
        override_reason="team B no-show",
        explicit_mode="forfeit_no_rating",
    )

    assert decision.mode == "forfeit_no_rating"
    assert decision.rate_series is False
    assert decision.official_winner_id == TEAM_B


def test_forfeit_result_only_records_winner_without_rating() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_B,
        calculated_winner_id=TEAM_A,
        override_reason="team A forfeits the series",
        explicit_mode="forfeit_result_only",
    )

    assert decision.mode == "forfeit_result_only"
    assert decision.rate_series is False
    assert decision.official_winner_id == TEAM_B
    assert decision.override_reason == "team A forfeits the series"


def test_official_equals_calculated_honors_explicit_forfeit_mode() -> None:
    """A forfeit declared after the maps were played: the official winner still
    matches the calculated winner, but the explicit forfeit mode is honored."""
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A,
        calculated_winner_id=TEAM_A,
        override_reason="team B forfeited after game 1",
        explicit_mode="forfeit_no_rating",
    )

    assert decision.mode == "forfeit_no_rating"
    assert decision.rate_series is False
    assert decision.official_winner_id == TEAM_A


def test_official_none_with_explicit_forfeit_mode_defaults_and_honors() -> None:
    decision = resolve_rating_policy(
        official_winner_id=None,
        calculated_winner_id=TEAM_A,
        override_reason="declared after play",
        explicit_mode="forfeit_result_only",
    )

    assert decision.official_winner_id == TEAM_A
    assert decision.mode == "forfeit_result_only"
    assert decision.rate_series is False


def test_unknown_explicit_mode_is_rejected() -> None:
    with pytest.raises(ValueError):
        resolve_rating_policy(
            official_winner_id=TEAM_A,
            calculated_winner_id=TEAM_A,
            override_reason=None,
            explicit_mode="void",
        )


def test_decision_is_a_frozen_dataclass() -> None:
    decision = RatingPolicyDecision(
        mode="normal", rate_series=True, official_winner_id=None, override_reason=None
    )
    assert decision.mode == "normal"
    with pytest.raises(FrozenInstanceError):
        decision.mode = "manual_override"  # type: ignore[misc]


# ------------------------------------------------------------- FinalizeRequest schema


def test_finalize_request_accepts_every_locked_mode() -> None:
    for mode in RATING_MODES:
        req = FinalizeRequest(rating_mode=mode)
        assert req.rating_mode == mode


def test_finalize_request_defaults_to_no_override() -> None:
    req = FinalizeRequest()
    assert req.official_winner_id is None
    assert req.override_reason is None
    assert req.rating_mode is None


def test_finalize_request_rejects_unknown_rating_mode() -> None:
    with pytest.raises(ValidationError):
        FinalizeRequest(rating_mode="void")


# ------------------------------------------------------ service input parsing


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0
        self.rolled_back = 0

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        self.rolled_back += 1


def _team(name: str) -> Team:
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


def _series(team_a: Team, team_b: Team, *, format_: str) -> Series:
    return Series(
        id=uuid.uuid4(),
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format=format_,
        importance="regular",
        status="draft",
        team_a_maps_won=0,
        team_b_maps_won=0,
        created_at=START,
        updated_at=START,
    )


def _match(*, red_wins: bool) -> Match:
    red, blue = (13, 9) if red_wins else (9, 13)
    return Match(
        id=uuid.uuid4(),
        henrik_match_id=str(uuid.uuid4()),
        affinity="eu",
        map_name="Ascent",
        started_at=START,
        is_completed=True,
        red_score=red,
        blue_score=blue,
        winning_side="red" if red_wins else "blue",
        raw_payload={},
        imported_at=START,
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
    winner_team_id: uuid.UUID,
) -> SeriesGame:
    return SeriesGame(
        id=uuid.uuid4(),
        series_id=series.id,
        game_number=number,
        match_id=match.id,
        team_a_side="red",
        team_b_side="blue",
        team_a_rounds=team_a_rounds,
        team_b_rounds=team_b_rounds,
        winner_team_id=winner_team_id,
        created_at=START,
        updated_at=START,
    )


def _scenario(
    *, format_: str, winners: list[str]
) -> tuple[Team, Team, Series, list[SeriesGame], list[Match]]:
    """Two teams, a draft series, and one game per ``winners`` entry
    (``"A"``/``"B"`` = the team that wins that map)."""
    team_a = _team("Alpha")
    team_b = _team("Beta")
    series = _series(team_a, team_b, format_=format_)
    games: list[SeriesGame] = []
    matches: list[Match] = []
    for number, winner in enumerate(winners, start=1):
        red_wins = winner == "A"
        match = _match(red_wins=red_wins)
        matches.append(match)
        games.append(
            _game(
                series,
                match,
                number,
                team_a_rounds=13 if red_wins else 9,
                team_b_rounds=9 if red_wins else 13,
                winner_team_id=team_a.id if winner == "A" else team_b.id,
            )
        )
    return team_a, team_b, series, games, matches


class InMemoryPolicyRepository:
    """In-memory mirror of ``SeriesRepository.get_series_with_canonical_games``
    — the ONLY repository method the finalize-input parsing may call.

    Each game's rounds/winner are derived from the CURRENT in-memory ``Match``
    row through the persisted side mapping (a test simulates a canonical
    refresh by mutating a match's scores), never from the copied
    ``SeriesGame`` round/winner columns. The ``calls`` list proves the parse is
    one consistent joined read; any other call fails the test loudly.
    """

    def __init__(self, series: Series, games: list[SeriesGame], matches: dict[uuid.UUID, Match]) -> None:
        self.series = series
        self.games = games
        self.matches = matches
        self.calls: list[str] = []

    async def get_series_with_canonical_games(
        self, series_id: uuid.UUID
    ) -> tuple[Series | None, list[CanonicalGameSnapshot]]:
        self.calls.append("get_series_with_canonical_games")
        if self.series is None or self.series.id != series_id:
            return None, []
        ordered = sorted((g for g in self.games if g.series_id == series_id), key=lambda g: g.game_number)
        snapshots: list[CanonicalGameSnapshot] = []
        for game in ordered:
            match = self.matches.get(game.match_id)
            if match is None:
                continue  # mirror the LEFT JOIN
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


def _service(repo: InMemoryPolicyRepository, session: FakeSession | None = None) -> SeriesService:
    return SeriesService(
        session=session or FakeSession(),  # type: ignore[arg-type]
        series_repo=repo,  # type: ignore[arg-type]
        match_repo=object(),  # type: ignore[arg-type]  # the policy parse never touches matches
    )


async def test_service_resolves_no_override_to_normal() -> None:
    team_a, _team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(series.id, FinalizeRequest())

    assert decision.mode == "normal"
    assert decision.rate_series is True
    # Official winner defaults to the calculated winner (team A won 2 maps).
    assert decision.official_winner_id == team_a.id


async def test_service_resolves_override_with_reason_and_mode() -> None:
    _team_a, team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(
        series.id,
        FinalizeRequest(
            official_winner_id=team_b.id, override_reason="ruling", rating_mode="manual_override"
        ),
    )

    assert decision.mode == "manual_override"
    assert decision.rate_series is True
    assert decision.official_winner_id == team_b.id
    assert decision.override_reason == "ruling"


async def test_service_override_without_reason_raises_policy_required() -> None:
    _team_a, team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.resolve_finalization_policy(
            series.id,
            FinalizeRequest(official_winner_id=team_b.id, rating_mode="manual_override"),
        )

    assert excinfo.value.code == "RATING_POLICY_REQUIRED"
    assert excinfo.value.status == 409


async def test_service_override_with_reason_but_no_mode_raises_policy_required() -> None:
    _team_a, team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.resolve_finalization_policy(
            series.id,
            FinalizeRequest(official_winner_id=team_b.id, override_reason="ruling"),
        )

    assert excinfo.value.code == "RATING_POLICY_REQUIRED"
    assert excinfo.value.status == 409


async def test_service_official_winner_must_be_a_team_of_the_series() -> None:
    _team_a, _team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)
    stranger = uuid.uuid4()

    with pytest.raises(AppError) as excinfo:
        await svc.resolve_finalization_policy(
            series.id,
            FinalizeRequest(official_winner_id=stranger, override_reason="x", rating_mode="manual_override"),
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_service_missing_series_raises_series_not_found() -> None:
    _team_a, _team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.resolve_finalization_policy(uuid.uuid4(), FinalizeRequest())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_service_policy_parse_never_writes() -> None:
    _team_a, team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    session = FakeSession()
    svc = _service(repo, session)

    decision = await svc.resolve_finalization_policy(
        series.id,
        FinalizeRequest(
            official_winner_id=team_b.id, override_reason="ruling", rating_mode="manual_override"
        ),
    )

    assert decision.mode == "manual_override"
    # The parse only reads — exactly the single joined canonical read — and the
    # series row is untouched; the session is never committed or rolled back.
    assert repo.calls == ["get_series_with_canonical_games"]
    assert series.status == "draft"
    assert series.official_winner_id is None
    assert series.winner_override_reason is None
    assert session.committed == 0
    assert session.rolled_back == 0


# ----------------------------------- canonical derivation (fix round 1)


async def test_service_policy_parse_uses_single_joined_read() -> None:
    """The calculated winner comes from ONE consistent joined read
    (``get_series_with_canonical_games``) — never separate series/game reads
    that could mix states under a concurrent mutation."""
    _team_a, _team_b, series, games, matches = _scenario(format_="bo3", winners=["A", "A"])
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    await svc.resolve_finalization_policy(series.id, FinalizeRequest())

    assert repo.calls == ["get_series_with_canonical_games"]


async def test_service_uses_current_canonical_winner_after_refresh() -> None:
    """A canonical match refresh that flips a map winner must flip the calculated
    winner the policy resolves against — never the stale copied winner/rounds."""
    team_a, team_b, series, games, matches = _scenario(format_="bo1", winners=["A"])
    # The stored SeriesGame row says team A won; the canonical match now says
    # blue (team B) won (e.g. a refresh correcting the scores).
    matches[0].red_score, matches[0].blue_score = 9, 13
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(series.id, FinalizeRequest())

    # Official defaults to the CURRENT calculated winner (team B).
    assert decision.mode == "normal"
    assert decision.rate_series is True
    assert decision.official_winner_id == team_b.id
    assert decision.official_winner_id != team_a.id


async def test_service_override_compares_against_current_canonical_winner() -> None:
    """An override is only an override against the CURRENT canonical calculated
    winner: after a refresh flips the calculated winner to match the official
    winner, the same request resolves to normal — no override, no mode needed."""
    _team_a, team_b, series, games, matches = _scenario(format_="bo1", winners=["A"])
    # Stored winner was team A; refresh the canonical match so blue (team B) is
    # the current calculated winner and the "override" to team B is a no-op.
    matches[0].red_score, matches[0].blue_score = 9, 13
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(
        series.id,
        FinalizeRequest(official_winner_id=team_b.id, override_reason="stale ruling"),
    )

    assert decision.mode == "normal"  # official == current calculated
    assert decision.rate_series is True
    assert decision.official_winner_id == team_b.id


async def test_service_canonical_refresh_changing_margin_keeps_winner() -> None:
    """A refresh that changes only the round margin (not the winner) leaves the
    resolved policy unchanged — the winner is derived from the rounds, never
    the margin or the stored copy."""
    team_a, _team_b, series, games, matches = _scenario(format_="bo1", winners=["A"])
    matches[0].red_score, matches[0].blue_score = 13, 11  # stored copy was 13-9
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(series.id, FinalizeRequest())

    assert decision.mode == "normal"
    assert decision.official_winner_id == team_a.id


async def test_service_scoreless_canonical_match_yields_no_calculated_winner() -> None:
    """A scoreless canonical match (raw DB artifact) contributes no map win:
    the calculated winner is None and a no-override request resolves to
    official=None (the Task 15 finalize gate rejects the series itself)."""
    _team_a, _team_b, series, games, matches = _scenario(format_="bo1", winners=["A"])
    matches[0].red_score, matches[0].blue_score = None, None
    repo = InMemoryPolicyRepository(series, games, {m.id: m for m in matches})
    svc = _service(repo)

    decision = await svc.resolve_finalization_policy(series.id, FinalizeRequest())

    assert decision.mode == "normal"
    assert decision.official_winner_id is None


# ------------------------------------------------------- D4/D5 (plan Task 6)


def test_rating_modes_include_unrated() -> None:
    assert "unrated" in RATING_MODES


def test_unrated_never_rates_and_never_counts() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A,
        calculated_winner_id=TEAM_A,
        override_reason=None,
        explicit_mode="unrated",
    )
    assert decision.mode == "unrated"
    assert decision.rate_series is False


def test_unrated_requires_no_reason() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A,
        calculated_winner_id=TEAM_A,
        override_reason=None,
        explicit_mode="unrated",
    )
    assert decision.override_reason is None


def test_forfeit_modes_require_reason_even_when_official_equals_calculated() -> None:
    # D5: official == calculated still demands a reason for forfeit/override modes.
    for mode in ("manual_override", "forfeit_no_rating", "forfeit_result_only"):
        with pytest.raises(RatingPolicyRequiredError):
            resolve_rating_policy(
                official_winner_id=TEAM_A,
                calculated_winner_id=TEAM_A,
                override_reason=None,
                explicit_mode=mode,  # type: ignore[arg-type]
            )
        with pytest.raises(RatingPolicyRequiredError):
            resolve_rating_policy(
                official_winner_id=TEAM_A,
                calculated_winner_id=TEAM_A,
                override_reason="   ",
                explicit_mode=mode,  # type: ignore[arg-type]
            )


def test_blank_reason_rejected_for_forfeit_mode_even_with_override() -> None:
    with pytest.raises(RatingPolicyRequiredError):
        resolve_rating_policy(
            official_winner_id=TEAM_B,
            calculated_winner_id=TEAM_A,
            override_reason="\t\n ",
            explicit_mode="forfeit_result_only",
        )
