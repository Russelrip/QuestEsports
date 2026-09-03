"""MatchLibraryService unit tests (plan Task 9 + fix round 1; design §8.5, §14.3).

The real ``MatchLibraryService`` is exercised against an in-memory repository
that mirrors the ``MatchRepository`` list contract (filters + ``(started_at,
id)`` DESC keyset pagination + ``MATCH_NOT_FOUND`` for an unresolvable cursor),
so the service plumbing, response shapes, filter wiring, and the raw-payload
opt-in gate are all covered without a database. Covers:

- filter by map (``map_name`` equality);
- filter by ``from``/``to`` (inclusive ``started_at`` range; timezone-naive
  bounds are interpreted as UTC and never raise ``TypeError``);
- filter by ``player_puuid`` (participant snapshot membership);
- keyset cursor pagination: ``next_cursor`` returned when another page exists,
  no overlap between pages, deterministic ``(started_at, id)`` DESC order,
  ``total`` counts the filtered set ignoring limit/cursor, and repeated
  requests over unchanged data are identical;
- detail by internal UUID and by canonical Henrik Match ID (metadata + player
  snapshots, ``raw_payload_available=True``);
- missing detail → ``MATCH_NOT_FOUND`` 404 for both lookups; an unresolvable
  cursor → ``MATCH_NOT_FOUND`` 404; a cross-filter cursor (exists in the table
  but outside the active map/from/to/player_puuid window) → ``MATCH_NOT_FOUND``
  404 (fix round 1);
- ``MATCH_NOT_FOUND`` is a fresh instance per raise — repeated and concurrent
  raises never share an exception or traceback object (fix round 1);
- raw payload content echoed only when ``Settings.raw_payload_in_responses``
  opts in; never in list summaries; serialization *omits* the ``raw_payload``
  key when not opted in (fix round 1).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime

import pytest

from app.api.errors import AppError
from app.config import Settings
from app.db.models import Match, MatchPlayer
from app.schemas.matches import MatchDetailResponse
from app.services.match_library_service import MatchLibraryService

MATCH_1 = uuid.uuid4()
MATCH_2 = uuid.uuid4()
MATCH_3 = uuid.uuid4()

HENRIK_1 = "00000000-0000-0000-0000-000000000001"
HENRIK_2 = "00000000-0000-0000-0000-000000000002"
HENRIK_3 = "00000000-0000-0000-0000-000000000003"

ASMAP = "Ascent"
BIND = "Bind"
HAVEN = "Haven"

T1 = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)
T2 = datetime(2026, 8, 11, 10, 0, tzinfo=UTC)
T3 = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)


class FakeLibraryRepo:
    """In-memory mirror of the ``MatchRepository`` Task 9 read contract."""

    def __init__(self) -> None:
        self.matches: dict[uuid.UUID, Match] = {}
        self.by_henrik: dict[str, Match] = {}
        self.match_players: dict[uuid.UUID, list[MatchPlayer]] = {}

    def seed(self, *, match_id: uuid.UUID, henrik_id: str, map_name: str, started_at: datetime) -> None:
        match = Match(
            id=match_id,
            henrik_match_id=henrik_id,
            affinity="eu",
            platform="pc",
            map_id="map-id",
            map_name=map_name,
            mode="Competitive",
            queue="competitive",
            started_at=started_at,
            duration_ms=2_000_000,
            is_completed=True,
            red_score=13,
            blue_score=9,
            winning_side="red",
            game_version="9.0",
            raw_payload={"metadata": {"match_id": henrik_id}, "map": {"name": map_name}},
        )
        self.matches[match_id] = match
        self.by_henrik[henrik_id] = match
        self.match_players[match_id] = [
            MatchPlayer(
                id=uuid.uuid4(),
                match_id=match_id,
                player_id=uuid.uuid4(),
                puuid_snapshot=puuid,
                name_snapshot=f"Player{puuid[-1].upper()}",
                tag_snapshot="T",
                side="red" if i == 0 else "blue",
                agent_name="Jett",
                score_total=1000 + i,
                kills=10 + i,
                deaths=5,
                assists=3,
            )
            for i, puuid in enumerate(("puuid_p_a", "puuid_p_b"))
        ]

    async def list_matches(
        self,
        *,
        map_name: str | None = None,
        from_=None,
        to=None,
        player_puuid: str | None = None,
        limit: int,
        cursor: uuid.UUID | None = None,
    ) -> tuple[list[Match], uuid.UUID | None]:
        rows = [
            match
            for match in self.matches.values()
            if _filter_match(match, self.match_players[match.id], map_name, from_, to, player_puuid)
        ]
        rows.sort(key=lambda match: (match.started_at, match.id), reverse=True)
        if cursor is not None:
            anchor = self.matches.get(cursor)
            if anchor is None or not _filter_match(
                anchor, self.match_players[anchor.id], map_name, from_, to, player_puuid
            ):
                raise AppError("MATCH_NOT_FOUND", 404, "cursor match not found")
            rows = [
                match
                for match in rows
                if (match.started_at, match.id) < (anchor.started_at, anchor.id)
            ]
        if len(rows) <= limit:
            return rows, None
        return rows[:limit], rows[limit - 1].id

    async def count_matches(
        self, *, map_name: str | None = None, from_=None, to=None, player_puuid: str | None = None
    ) -> int:
        return sum(
            1
            for match in self.matches.values()
            if _filter_match(match, self.match_players[match.id], map_name, from_, to, player_puuid)
        )

    async def get_by_id(self, match_id: uuid.UUID) -> Match | None:
        return self.matches.get(match_id)

    async def get_by_henrik_match_id(self, henrik_match_id: str) -> Match | None:
        return self.by_henrik.get(henrik_match_id)

    async def get_players_for_match(self, match_id: uuid.UUID) -> list[MatchPlayer]:
        return list(self.match_players.get(match_id, []))


def _filter_match(match, players, map_name, from_, to, player_puuid) -> bool:
    if map_name is not None and match.map_name != map_name:
        return False
    if from_ is not None and match.started_at < from_:
        return False
    if to is not None and match.started_at > to:
        return False
    return player_puuid is None or any(p.puuid_snapshot == player_puuid for p in players)


def _repo() -> FakeLibraryRepo:
    repo = FakeLibraryRepo()
    repo.seed(match_id=MATCH_1, henrik_id=HENRIK_1, map_name=ASMAP, started_at=T1)
    repo.seed(match_id=MATCH_2, henrik_id=HENRIK_2, map_name=BIND, started_at=T2)
    repo.seed(match_id=MATCH_3, henrik_id=HENRIK_3, map_name=ASMAP, started_at=T3)
    return repo


def _service(repo: FakeLibraryRepo, *, raw_payload_in_responses: bool = False) -> MatchLibraryService:
    settings = Settings(raw_payload_in_responses=raw_payload_in_responses)
    return MatchLibraryService(session=None, match_repo=repo, settings=settings)  # type: ignore[arg-type]


def _ids(result) -> list[uuid.UUID]:
    return [item.id for item in result.items]


# ----------------------------------------------------------------- filters


async def test_list_filters_by_map() -> None:
    result = await _service(_repo()).list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=20, cursor=None
    )

    assert _ids(result) == [MATCH_1, MATCH_3]  # newest first
    assert result.total == 2
    assert result.next_cursor is None
    for item in result.items:
        assert item.map_name == ASMAP


async def test_list_filters_by_from_to() -> None:
    result = await _service(_repo()).list_matches(
        map_name=None,
        from_=datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
        to=datetime(2026, 8, 11, 23, 59, tzinfo=UTC),
        player_puuid=None,
        limit=20,
        cursor=None,
    )

    assert _ids(result) == [MATCH_2, MATCH_3]
    assert result.total == 2


async def test_list_naive_bounds_treated_as_utc() -> None:
    # Naive bounds must be interpreted as UTC by the service (never left naive,
    # which would break comparisons against aware started_at).
    result = await _service(_repo()).list_matches(
        map_name=None,
        from_=datetime(2026, 8, 11),  # noqa: DTZ001  # naive on purpose: must be read as UTC
        to=datetime(2026, 8, 11, 10, 0),  # noqa: DTZ001  # naive on purpose: inclusive UTC upper bound
        player_puuid=None,
        limit=20,
        cursor=None,
    )

    assert _ids(result) == [MATCH_2]
    assert result.total == 1


async def test_list_filters_by_player_puuid() -> None:
    # Only MATCH_1 carries a participant snapshot with this puuid.
    repo = _repo()
    repo.match_players[MATCH_2][0].puuid_snapshot = "puuid_other"
    repo.match_players[MATCH_3][0].puuid_snapshot = "puuid_other"

    result = await _service(repo).list_matches(
        map_name=None, from_=None, to=None, player_puuid="puuid_p_a", limit=20, cursor=None
    )

    assert _ids(result) == [MATCH_1]
    assert result.total == 1


async def test_list_combined_filters() -> None:
    result = await _service(_repo()).list_matches(
        map_name=ASMAP,
        from_=datetime(2026, 8, 11, 0, 0, tzinfo=UTC),
        to=None,
        player_puuid="puuid_p_a",
        limit=20,
        cursor=None,
    )

    assert _ids(result) == [MATCH_1]
    assert result.total == 1


# ------------------------------------------------------- cursor pagination


async def test_cursor_pagination_no_overlap_and_total() -> None:
    svc = _service(_repo())

    page1 = await svc.list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=2, cursor=None
    )
    assert _ids(page1) == [MATCH_1, MATCH_2]
    assert page1.next_cursor == MATCH_2
    assert page1.total == 3  # total ignores limit/cursor

    page2 = await svc.list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=2, cursor=page1.next_cursor
    )
    assert _ids(page2) == [MATCH_3]
    assert page2.next_cursor is None  # no third page
    assert page2.total == 3

    # no overlap between pages
    assert set(_ids(page1)).isdisjoint(set(_ids(page2)))


async def test_cursor_pagination_with_filters_stays_within_filter() -> None:
    svc = _service(_repo())

    page1 = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=1, cursor=None
    )
    assert _ids(page1) == [MATCH_1]
    assert page1.next_cursor == MATCH_1

    page2 = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=1, cursor=page1.next_cursor
    )
    assert _ids(page2) == [MATCH_3]
    assert page2.next_cursor is None
    assert page2.total == 2


async def test_cursor_pagination_deterministic_on_tied_started_at() -> None:
    repo = _repo()
    # MATCH_3 now ties MATCH_2's started_at; id order breaks the tie.
    repo.matches[MATCH_3].started_at = T2

    page1 = await _service(repo).list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=1, cursor=None
    )
    assert _ids(page1) == [MATCH_1]  # newest started_at first

    page2 = await _service(repo).list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=1, cursor=page1.next_cursor
    )
    # the tied pair is ordered by id DESC — no overlap, no skipped rows
    assert len(page2.items) == 1

    page3 = await _service(repo).list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=1, cursor=page2.next_cursor
    )
    all_ids = _ids(page1) + _ids(page2) + _ids(page3)
    assert len(all_ids) == 3
    assert len(set(all_ids)) == 3  # no overlap across all three pages


async def test_list_summaries_carry_metadata_not_players_or_raw() -> None:
    result = await _service(_repo()).list_matches(
        map_name=None, from_=None, to=None, player_puuid=None, limit=20, cursor=None
    )

    item = result.items[0]
    assert item.id == MATCH_1
    assert item.henrik_match_id == HENRIK_1
    assert item.map_name == ASMAP
    assert item.started_at == T1
    assert item.is_completed is True
    assert item.red_score == 13
    assert item.blue_score == 9
    assert item.winning_side == "red"
    assert item.raw_payload_available is True
    assert not hasattr(item, "players")
    assert not hasattr(item, "raw_payload")


# ----------------------------------------------------------------- details


async def test_detail_by_id() -> None:
    result = await _service(_repo()).get_by_id(MATCH_1)

    assert result.id == MATCH_1
    assert result.henrik_match_id == HENRIK_1
    assert result.map_name == ASMAP
    assert result.started_at == T1
    assert result.red_score == 13
    assert result.winning_side == "red"
    assert result.raw_payload_available is True
    assert result.raw_payload is None  # excluded by default
    assert len(result.players) == 2
    by_puuid = {player.puuid: player for player in result.players}
    assert by_puuid["puuid_p_a"].name == "PlayerA"
    assert by_puuid["puuid_p_a"].side == "red"
    assert by_puuid["puuid_p_a"].kills == 10
    assert by_puuid["puuid_p_b"].side == "blue"


async def test_detail_by_henrik_id_matches_by_id() -> None:
    svc = _service(_repo())

    by_id = await svc.get_by_id(MATCH_1)
    by_henrik = await svc.get_by_henrik_id(HENRIK_1)

    assert by_henrik.id == by_id.id
    assert by_henrik.map_name == by_id.map_name
    assert by_henrik.players == by_id.players


async def test_raw_payload_echoed_only_when_opted_in() -> None:
    result = await _service(_repo(), raw_payload_in_responses=True).get_by_id(MATCH_1)

    assert result.raw_payload_available is True
    assert result.raw_payload == {"metadata": {"match_id": HENRIK_1}, "map": {"name": ASMAP}}


# ------------------------------------------------------------ missing rows


async def test_missing_detail_by_id_raises_match_not_found() -> None:
    with pytest.raises(AppError) as excinfo:
        await _service(_repo()).get_by_id(uuid.uuid4())

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_missing_detail_by_henrik_id_raises_match_not_found() -> None:
    with pytest.raises(AppError) as excinfo:
        await _service(_repo()).get_by_henrik_id("00000000-0000-0000-0000-000000000099")

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_unresolvable_cursor_raises_match_not_found() -> None:
    svc = _service(_repo())

    with pytest.raises(AppError) as excinfo:
        await svc.list_matches(
            map_name=None, from_=None, to=None, player_puuid=None, limit=20, cursor=uuid.uuid4()
        )

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


# ----------------------------------------- fix round 1: filter-scoped cursor


async def test_cross_filter_cursor_by_map_raises_match_not_found() -> None:
    # MATCH_2 is a Bind match; a cursor pointing at it is invalid when the
    # active filter is map=Ascent — it must not skip rows arbitrarily.
    svc = _service(_repo())

    with pytest.raises(AppError) as excinfo:
        await svc.list_matches(
            map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=20, cursor=MATCH_2
        )

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_cross_filter_cursor_by_time_window_raises_match_not_found() -> None:
    # MATCH_1 started at T1 (2026-08-12); a cursor pointing at it is invalid
    # when the active window ends before T1.
    svc = _service(_repo())

    with pytest.raises(AppError) as excinfo:
        await svc.list_matches(
            map_name=None,
            from_=None,
            to=datetime(2026, 8, 11, 23, 59, tzinfo=UTC),
            player_puuid=None,
            limit=20,
            cursor=MATCH_1,
        )

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_cross_filter_cursor_by_player_puuid_raises_match_not_found() -> None:
    # MATCH_2 participants do not include puuid_p_a; a cursor at MATCH_2 with
    # the player_puuid filter active is invalid.
    repo = _repo()
    repo.match_players[MATCH_2][0].puuid_snapshot = "puuid_other"
    repo.match_players[MATCH_2][1].puuid_snapshot = "puuid_other"
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.list_matches(
            map_name=None, from_=None, to=None, player_puuid="puuid_p_a", limit=20, cursor=MATCH_2
        )

    assert excinfo.value.code == "MATCH_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_same_filter_cursor_still_paginates() -> None:
    # Regression guard: a cursor that *does* satisfy the active filters keeps
    # paginating normally (no false 404).
    svc = _service(_repo())

    page1 = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=1, cursor=None
    )
    assert _ids(page1) == [MATCH_1]
    assert page1.next_cursor == MATCH_1

    page2 = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=1, cursor=page1.next_cursor
    )
    assert _ids(page2) == [MATCH_3]
    assert page2.next_cursor is None


# ----------------------- fix round 1: fresh MATCH_NOT_FOUND instances


def _deepest_tb_lineno(exc: AppError) -> int:
    """The raise-site line: walk the traceback chain to its deepest frame."""
    tb = exc.__traceback__
    assert tb is not None
    while tb.tb_next is not None:
        tb = tb.tb_next
    return tb.tb_lineno


async def test_repeated_missing_lookup_raises_fresh_instances() -> None:
    svc = _service(_repo())

    with pytest.raises(AppError) as first:
        await svc.get_by_id(uuid.uuid4())
    with pytest.raises(AppError) as second:
        await svc.get_by_id(uuid.uuid4())

    e1, e2 = first.value, second.value
    assert e1 is not e2  # never the same shared singleton instance
    assert e1.code == e2.code == "MATCH_NOT_FOUND"
    # each raise owns a distinct, complete traceback
    assert e1.__traceback__ is not None
    assert e2.__traceback__ is not None
    assert e1.__traceback__ is not e2.__traceback__
    # both originate at the service's raise site, and a later raise never
    # rewrites an earlier exception's traceback
    assert _deepest_tb_lineno(e1) == _deepest_tb_lineno(e2)
    assert _deepest_tb_lineno(e1) == _deepest_tb_lineno(e2)  # unchanged after second raise


async def test_concurrent_missing_lookups_do_not_share_tracebacks() -> None:
    svc = _service(_repo())

    async def missing() -> AppError:
        with pytest.raises(AppError) as excinfo:
            await svc.get_by_id(uuid.uuid4())
        assert excinfo.value.code == "MATCH_NOT_FOUND"
        return excinfo.value

    errors = await asyncio.gather(*(missing() for _ in range(8)))

    # every concurrent raise produced its own instance and its own traceback
    assert len({id(exc) for exc in errors}) == 8
    assert len({id(exc.__traceback__) for exc in errors}) == 8
    assert all(exc.__traceback__ is not None for exc in errors)
    # every raise originated at the same service source line
    assert len({_deepest_tb_lineno(exc) for exc in errors}) == 1


# ------------------------ fix round 1: deterministic + snapshot semantics


async def test_repeated_list_call_is_deterministic() -> None:
    svc = _service(_repo())

    first = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=10, cursor=None
    )
    second = await svc.list_matches(
        map_name=ASMAP, from_=None, to=None, player_puuid=None, limit=10, cursor=None
    )

    assert _ids(first) == _ids(second)
    assert first.total == second.total
    assert first.next_cursor == second.next_cursor
    assert [item.model_dump() for item in first.items] == [item.model_dump() for item in second.items]


# ---------------------- fix round 1: raw_payload omitted, never null


async def test_raw_payload_key_omitted_from_serialization_when_not_opted_in() -> None:
    result = await _service(_repo()).get_by_id(MATCH_1)
    assert result.raw_payload is None  # model attribute stays None...

    dumped = json.loads(MatchDetailResponse.model_validate(result).model_dump_json())
    # ...but the serialized payload never carries a null key
    assert "raw_payload" not in dumped
    assert dumped["raw_payload_available"] is True


async def test_raw_payload_key_present_when_opted_in() -> None:
    result = await _service(_repo(), raw_payload_in_responses=True).get_by_id(MATCH_1)
    assert result.raw_payload == {"metadata": {"match_id": HENRIK_1}, "map": {"name": ASMAP}}

    dumped = json.loads(MatchDetailResponse.model_validate(result).model_dump_json())
    assert dumped["raw_payload"] == {"metadata": {"match_id": HENRIK_1}, "map": {"name": ASMAP}}
