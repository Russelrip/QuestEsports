"""MatchDiscoveryService unit tests (plan Task 7; design §4.2, §7.2, §11.1).

Fake ``PlayerService`` + a fixture-driven fake ``HenrikClient`` whose
``get_matches_by_puuid`` serves pinned history payloads (the same documented
shape as ``tests/fixtures/henrik/history_v4/*.json``) through the real
``HenrikMapper`` — no network, no DB. Covers:

- same one match; multiple overlapping matches (newest-first, deterministic);
- no overlap -> 200 with empty ``candidates``;
- map filter; date filter; mode filter (local, per U5 fallback);
- different match-list ordering between the two players (intersection exact by
  ``metadata.match_id``);
- accumulated pagination: overlap found on page 2 with ``max_pages=2``,
  ``pages_examined=2``, page-1 lists disjoint; ``start`` advances by ``size``;
- pagination stops on the raw accumulated intersection even when the local
  filters drop it to an empty candidate list (page 2 never requested);
- duplicate match IDs within a page -> no duplicate candidates;
- one account missing (Henrik 404/22 -> ``PLAYER_NOT_FOUND``);
- affinity mismatch -> ``INVALID_RIOT_ID`` 422 before any history call;
- mixed known/null affinities use the sole known affinity; both null falls back
  to ``settings.default_affinity``;
- candidates carry the compatible search affinity (import-ready);
- naive ``from``/``to`` bounds are normalized to UTC (no TypeError on compare);
- Henrik 429 -> ``HENRIK_RATE_LIMITED``; invalid ``start`` (code 45) ->
  ``HENRIK_VALIDATION_ERROR``;
- ``already_imported`` batch lookup + candidate ``match_id`` (internal UUID);
  settings page-size cap;
- attached matches (imported AND in ``series_games``) are excluded entirely.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.api.errors import AppError
from app.config import Settings
from app.db.models import Player
from app.integrations.henrik.exceptions import (
    HenrikRateLimitError,
    HenrikValidationError,
)
from app.integrations.henrik.mapper import HenrikMapper
from app.schemas.match_search import (
    PlayerRef,
    SearchMeta,
    TwoPlayerSearchRequest,
)
from app.services.match_discovery_service import MatchDiscoveryService

START = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)


def _dt(hour: int, minute: int) -> datetime:
    return datetime(2026, 8, 12, hour, minute, tzinfo=UTC)


def _ts(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0

    async def commit(self) -> None:
        self.committed += 1


class FakePlayerService:
    """Duck-typed stand-in for ``PlayerService.resolve``."""

    def __init__(self, players: dict[tuple[str, str], Player]) -> None:
        self.players = players
        self.resolved: list[tuple[str, str]] = []

    async def resolve(self, name: str, tag: str, *, force: bool = False) -> Player:
        self.resolved.append((name, tag))
        player = self.players.get((name.lower(), tag.lower()))
        if player is None:
            raise AppError("PLAYER_NOT_FOUND", 404, "player not found")
        return player


class FakeMatchRepository:
    def __init__(self, imported: set[str] | None = None, attached: set[str] | None = None) -> None:
        self.imported = imported or set()
        self.attached = attached or set()
        self.lookups: list[set[str]] = []
        self.attached_lookups: list[set[str]] = []
        self._ids: dict[str, uuid.UUID] = {}

    def _internal_id(self, henrik_match_id: str) -> uuid.UUID:
        """Stable fake ``matches.id`` per henrik id (deterministic across calls)."""
        return self._ids.setdefault(henrik_match_id, uuid.uuid4())

    async def get_imported_henrik_match_ids(self, henrik_match_ids) -> dict[str, uuid.UUID]:
        ids = set(henrik_match_ids)
        self.lookups.append(ids)
        return {
            match_id: self._internal_id(match_id) for match_id in ids if match_id in self.imported
        }

    async def get_attached_henrik_match_ids(self, henrik_match_ids) -> set[str]:
        ids = set(henrik_match_ids)
        self.attached_lookups.append(ids)
        return {match_id for match_id in ids if match_id in self.attached}


class FakeHistoryHenrik:
    """Fixture-driven fake: serves pinned history payloads through the real mapper.

    ``pages`` maps a puuid to a list of page envelope dicts (the documented
    ``{"status": 200, "data": [...]}`` shape); the page is selected from the
    requested ``start``/``size`` exactly like accumulated pagination advances.
    ``errors`` maps ``(puuid, start)`` to a ``HenrikError`` to raise instead.
    """

    def __init__(
        self,
        pages: dict[str, list[dict]],
        errors: dict[tuple[str, int], Exception] | None = None,
    ) -> None:
        self.pages = pages
        self.errors = errors or {}
        self.calls: list[dict] = []
        self._mapper = HenrikMapper()

    async def get_matches_by_puuid(
        self,
        puuid: str,
        *,
        affinity: str,
        platform: str,
        mode: str | None = None,
        map_name: str | None = None,
        size: int = 10,
        start: int = 0,
    ) -> list:
        self.calls.append(
            {
                "puuid": puuid,
                "affinity": affinity,
                "platform": platform,
                "mode": mode,
                "map_name": map_name,
                "size": size,
                "start": start,
            }
        )
        error = self.errors.get((puuid, start))
        if error is not None:
            raise error
        pages = self.pages.get(puuid, [])
        index = start // size
        if index >= len(pages):
            return []
        return [self._mapper.to_match_list_item(item) for item in pages[index]["data"]]


def _item(
    match_id: str,
    *,
    map_name: str = "Ascent",
    started_at: datetime | None = START,
    is_completed: bool = True,
    mode: str = "Custom",
    queue: str | None = None,
    red_score: int = 13,
    blue_score: int = 9,
) -> dict:
    """A single history object in the pinned fixture shape."""
    return {
        "metadata": {
            "match_id": match_id,
            "map": {"id": f"map-{match_id}", "name": map_name},
            "started_at": _ts(started_at),
            "is_completed": is_completed,
            "mode": mode,
            "queue": queue,
        },
        "players": [],
        "teams": [
            {"team_id": "Red", "rounds": {"won": red_score, "lost": blue_score}, "won": True},
            {"team_id": "Blue", "rounds": {"won": blue_score, "lost": red_score}, "won": False},
        ],
    }


def _page(*items: dict) -> dict:
    return {"status": 200, "data": list(items)}


def _player(puuid: str, name: str, tag: str, *, affinity: str | None = "eu") -> Player:
    return Player(
        id=uuid.uuid4(),
        puuid=puuid,
        current_name=name,
        current_tag=tag,
        affinity=affinity,
        platforms=["PC"],
    )


def _players(*, a_affinity: str | None = "eu", b_affinity: str | None = "eu") -> FakePlayerService:
    return FakePlayerService(
        {
            ("playera", "a"): _player("puuid_p_a", "PlayerA", "A", affinity=a_affinity),
            ("playerb", "b"): _player("puuid_p_b", "PlayerB", "B", affinity=b_affinity),
        }
    )


def _request(
    *,
    player_a: tuple[str, str] = ("PlayerA", "A"),
    player_b: tuple[str, str] = ("PlayerB", "B"),
    **kwargs,
) -> TwoPlayerSearchRequest:
    return TwoPlayerSearchRequest(
        player_a=PlayerRef(name=player_a[0], tag=player_a[1]),
        player_b=PlayerRef(name=player_b[0], tag=player_b[1]),
        **kwargs,
    )


def _service(
    player_svc: FakePlayerService,
    henrik: FakeHistoryHenrik,
    match_repo: FakeMatchRepository | None = None,
) -> MatchDiscoveryService:
    return MatchDiscoveryService(
        session=FakeSession(),  # type: ignore[arg-type]
        player_svc=player_svc,  # type: ignore[arg-type]
        henrik=henrik,  # type: ignore[arg-type]
        match_repo=match_repo or FakeMatchRepository(),  # type: ignore[arg-type]
    )


# ------------------------------------------------------------ same one match

async def test_same_one_match_returns_single_candidate() -> None:
    item = _item("m-1")
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(item)], "puuid_p_b": [_page(item)]}
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request())

    assert result.search == SearchMeta(page_size=10, pages_examined=1)
    assert set(result.players) == {"a", "b"}
    assert result.players["a"].puuid == "puuid_p_a"
    assert result.players["b"].puuid == "puuid_p_b"
    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.match_id is None  # not imported -> no internal UUID yet
    assert candidate.henrik_match_id == "m-1"
    assert candidate.affinity == "eu"  # compatible search affinity, ready for import
    assert candidate.map == "Ascent"
    assert candidate.started_at == START
    assert candidate.mode == "Custom"
    assert candidate.queue is None
    assert candidate.is_completed is True
    assert candidate.red_score == 13
    assert candidate.blue_score == 9
    assert candidate.already_imported is False


# ------------------------------------------------------- multiple overlapping

async def test_multiple_overlapping_matches_newest_first() -> None:
    older = _item("m-1", started_at=_dt(10, 0))
    middle = _item("m-2", started_at=_dt(12, 0), map_name="Bind")
    newer = _item("m-3", started_at=_dt(14, 0), map_name="Haven")
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(older, middle, newer)],
            "puuid_p_b": [_page(older, middle, newer)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request())

    assert [c.henrik_match_id for c in result.candidates] == ["m-3", "m-2", "m-1"]
    assert result.search.pages_examined == 1


# ------------------------------------------------------------------- no overlap

async def test_no_overlap_returns_empty_candidates() -> None:
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(_item("m-a1"), _item("m-a2"))],
            "puuid_p_b": [_page(_item("m-b1"), _item("m-b2"))],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request())

    assert result.candidates == []
    assert result.search == SearchMeta(page_size=10, pages_examined=1)


# ------------------------------------------------------------------ map filter

async def test_map_filter_applied_locally() -> None:
    ascent = _item("m-1", map_name="Ascent")
    bind = _item("m-2", map_name="Bind")
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(ascent, bind)],
            "puuid_p_b": [_page(ascent, bind)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(map="Bind"))

    assert [c.henrik_match_id for c in result.candidates] == ["m-2"]
    # the requested map is also forwarded upstream ("safe when pinned")
    assert all(call["map_name"] == "Bind" for call in henrik.calls)


# ----------------------------------------------------------------- date filter

async def test_date_filter_applied_locally() -> None:
    m1 = _item("m-1", started_at=_dt(10, 0))
    m2 = _item("m-2", started_at=_dt(12, 0))
    m3 = _item("m-3", started_at=_dt(14, 0))
    m4 = _item("m-4", started_at=None)  # unknown time never passes a date bound
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(m1, m2, m3, m4)],
            "puuid_p_b": [_page(m1, m2, m3, m4)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(from_=_dt(11, 0), to=_dt(13, 0)))

    assert [c.henrik_match_id for c in result.candidates] == ["m-2"]


async def test_date_filter_with_naive_bounds_does_not_raise() -> None:
    # Naive from_/to are normalized to UTC by the schema, so comparison against
    # Henrik's aware started_at never raises TypeError.
    m1 = _item("m-1", started_at=_dt(10, 0))
    m2 = _item("m-2", started_at=_dt(12, 0))
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(m1, m2)],
            "puuid_p_b": [_page(m1, m2)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(
        _request(
            from_=datetime(2026, 8, 12, 11, 0),  # noqa: DTZ001  # naive on purpose
            to=datetime(2026, 8, 12, 13, 0),  # noqa: DTZ001
        )
    )

    assert [c.henrik_match_id for c in result.candidates] == ["m-2"]


# ------------------------------------------------------------------ mode filter

async def test_mode_filter_applied_locally() -> None:
    custom = _item("m-1", mode="Custom")
    comp = _item("m-2", mode="Competitive", queue="competitive")
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(custom, comp)],
            "puuid_p_b": [_page(custom, comp)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(mode="Competitive"))

    assert [c.henrik_match_id for c in result.candidates] == ["m-2"]
    # the service forwards mode to the client; serialization upstream only
    # happens when CUSTOM_MODE_LITERAL is pinned (proven in test_henrick_client),
    # so correctness here rests on the local filter
    assert all(call["mode"] == "Competitive" for call in henrik.calls)


# ------------------------------------------------------ different list ordering

async def test_different_list_ordering_intersection_exact_by_match_id() -> None:
    m1 = _item("m-1", started_at=_dt(9, 0))
    m2 = _item("m-2", started_at=_dt(10, 0))
    m3 = _item("m-3", started_at=_dt(11, 0))
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(m1, m2, m3)],
            "puuid_p_b": [_page(m3, m1, m2)],  # same matches, different order
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request())

    assert [c.henrik_match_id for c in result.candidates] == ["m-3", "m-2", "m-1"]
    assert result.search.pages_examined == 1


# ----------------------------------------------------- accumulated pagination

async def test_accumulated_pagination_overlap_found_on_page_two() -> None:
    a_page1 = _page(_item("a-1", started_at=_dt(12, 0)), _item("a-2", started_at=_dt(11, 0)))
    a_page2 = _page(_item("shared-1", started_at=_dt(10, 0)), _item("a-3", started_at=_dt(9, 0)))
    b_page1 = _page(_item("b-1", started_at=_dt(12, 5)), _item("b-2", started_at=_dt(11, 5)))
    b_page2 = _page(_item("shared-1", started_at=_dt(10, 0)), _item("shared-2", started_at=_dt(9, 5)))
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [a_page1, a_page2],
            "puuid_p_b": [b_page1, b_page2],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(page_size=2, max_pages=2))

    assert result.search == SearchMeta(page_size=2, pages_examined=2)
    assert [c.henrik_match_id for c in result.candidates] == ["shared-1"]
    # page-1 lists were disjoint; pagination advanced start by page_size:
    # FIRST_PAGE_START(0) then 0 + 1*2 = 2.
    assert {(c["puuid"], c["start"], c["size"]) for c in henrik.calls} == {
        ("puuid_p_a", 0, 2),
        ("puuid_p_b", 0, 2),
        ("puuid_p_a", 2, 2),
        ("puuid_p_b", 2, 2),
    }


async def test_accumulated_overlap_spanning_pages_deduped() -> None:
    # m1 appears on BOTH of A's pages and on B's page 2 (accumulated) — it must
    # be found once. Page 1 is disjoint, so all three overlaps surface on page 2.
    m1 = _item("m-1", started_at=_dt(12, 0))
    m2 = _item("m-2", started_at=_dt(11, 0))
    m3 = _item("m-3", started_at=_dt(10, 0))
    a_page1 = _page(m1, m2)
    a_page2 = _page(m1, m3)
    b_page1 = _page(_item("x-1", started_at=_dt(13, 0)), m3)
    b_page2 = _page(m1, m2)
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [a_page1, a_page2],
            "puuid_p_b": [b_page1, b_page2],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(page_size=2, max_pages=2))

    assert result.search.pages_examined == 2
    assert [c.henrik_match_id for c in result.candidates] == ["m-1", "m-2", "m-3"]
    assert len(result.candidates) == 3  # m-1 accumulated across pages, not duplicated


async def test_filtered_raw_overlap_does_not_consume_extra_pages() -> None:
    # Page 1 carries a RAW overlap (Custom) that the Competitive filter
    # excludes; page 2 would contain a Competitive overlap but must NOT be
    # requested — pagination stops on the raw accumulated intersection even
    # though the filters drop the resulting candidate list to empty.
    custom = _item("m-1", mode="Custom", started_at=_dt(12, 0))
    comp = _item("m-2", mode="Competitive", started_at=_dt(11, 0))
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(custom), _page(comp)],
            "puuid_p_b": [_page(custom), _page(comp)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(page_size=2, max_pages=2, mode="Competitive"))

    assert result.candidates == []
    assert result.search == SearchMeta(page_size=2, pages_examined=1)
    assert {(c["puuid"], c["start"]) for c in henrik.calls} == {("puuid_p_a", 0), ("puuid_p_b", 0)}


# ------------------------------------------------- duplicate ids within a page

async def test_duplicate_match_ids_within_page_not_duplicated() -> None:
    m1 = _item("m-1", started_at=_dt(12, 0))
    m2 = _item("m-2", started_at=_dt(11, 0))
    henrik = FakeHistoryHenrik(
        {
            "puuid_p_a": [_page(m1, m1, m2, m2)],
            "puuid_p_b": [_page(m1, m2)],
        }
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request())

    assert [c.henrik_match_id for c in result.candidates] == ["m-1", "m-2"]


# ----------------------------------------------------------- one account missing

async def test_one_account_missing_raises_player_not_found() -> None:
    henrik = FakeHistoryHenrik({})
    player_svc = FakePlayerService(
        {("playera", "a"): _player("puuid_p_a", "PlayerA", "A")}  # PlayerB missing
    )
    svc = _service(player_svc, henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.search_two_player(_request())

    assert excinfo.value.code == "PLAYER_NOT_FOUND"
    assert excinfo.value.status == 404
    assert henrik.calls == []  # history never fetched


# ------------------------------------------------------------ affinity mismatch

async def test_affinity_mismatch_rejected_before_any_history_call() -> None:
    henrik = FakeHistoryHenrik({})
    svc = _service(_players(a_affinity="eu", b_affinity="na"), henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.search_two_player(_request())

    assert excinfo.value.code == "INVALID_RIOT_ID"
    assert excinfo.value.status == 422
    assert excinfo.value.message == "players resolve to different affinities"
    assert henrik.calls == []


async def test_null_affinity_falls_back_to_default_affinity() -> None:
    item = _item("m-1")
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(item)], "puuid_p_b": [_page(item)]}
    )
    svc = _service(_players(a_affinity=None, b_affinity=None), henrik)

    result = await svc.search_two_player(_request())

    assert result.search.pages_examined == 1
    assert all(call["affinity"] == "eu" for call in henrik.calls)  # default_affinity


async def test_mixed_null_affinity_uses_sole_known_affinity() -> None:
    # A's affinity is unknown; B resolves to "na". The sole known affinity must
    # win for BOTH history calls (never the configured default).
    item = _item("m-1")
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(item)], "puuid_p_b": [_page(item)]}
    )
    svc = _service(_players(a_affinity=None, b_affinity="na"), henrik)

    result = await svc.search_two_player(_request())

    assert result.search.pages_examined == 1
    assert all(call["affinity"] == "na" for call in henrik.calls)
    assert all(c.affinity == "na" for c in result.candidates)


# ------------------------------------------------------------ Henrik error maps

async def test_henrik_429_during_history_raises_rate_limited() -> None:
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(_item("m-1"))]},
        errors={
            ("puuid_p_a", 0): HenrikRateLimitError(
                "slow down", retry_after=2.0, rate_limit_reset=1700000000
            )
        },
    )
    svc = _service(_players(), henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.search_two_player(_request())

    assert excinfo.value.code == "HENRIK_RATE_LIMITED"
    assert excinfo.value.status == 429


async def test_invalid_start_code_45_raises_validation_error() -> None:
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(_item("m-1"))]},
        errors={
            ("puuid_p_a", 0): HenrikValidationError(
                "start value must be greater than 0", sub_code=45
            )
        },
    )
    svc = _service(_players(), henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.search_two_player(_request())

    assert excinfo.value.code == "HENRIK_VALIDATION_ERROR"
    assert excinfo.value.status == 422


# ------------------------------------------------------------ already_imported

async def test_already_imported_flag_from_batch_lookup() -> None:
    m1 = _item("m-1", started_at=_dt(12, 0))
    m2 = _item("m-2", started_at=_dt(11, 0))
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(m1, m2)], "puuid_p_b": [_page(m1, m2)]}
    )
    repo = FakeMatchRepository(imported={"m-1"})
    svc = _service(_players(), henrik, match_repo=repo)

    result = await svc.search_two_player(_request())

    by_id = {c.henrik_match_id: c for c in result.candidates}
    assert by_id["m-1"].already_imported is True
    assert by_id["m-2"].already_imported is False
    assert repo.lookups == [{"m-1", "m-2"}]


async def test_match_id_present_for_imported_and_null_for_not_imported() -> None:
    # The candidate's ``match_id`` is the VAL ``matches.id`` UUID — present only
    # when the henrik id is already imported (imported-but-unattached here, so
    # it stays discoverable), null otherwise.
    m1 = _item("m-1", started_at=_dt(12, 0))
    m2 = _item("m-2", started_at=_dt(11, 0))
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(m1, m2)], "puuid_p_b": [_page(m1, m2)]}
    )
    repo = FakeMatchRepository(imported={"m-1"})
    svc = _service(_players(), henrik, match_repo=repo)

    result = await svc.search_two_player(_request())

    by_id = {c.henrik_match_id: c for c in result.candidates}
    assert by_id["m-1"].match_id is not None
    assert uuid.UUID(by_id["m-1"].match_id)  # a valid internal UUID string
    assert by_id["m-1"].match_id == str(repo._internal_id("m-1"))  # the VAL matches.id
    assert by_id["m-1"].already_imported is True
    assert by_id["m-2"].match_id is None
    assert by_id["m-2"].already_imported is False


# ------------------------------------------------ attached matches excluded

async def test_attached_matches_excluded_from_candidates() -> None:
    # m-1 is imported AND referenced by a series_games row -> excluded entirely;
    # m-2 is imported but unattached -> still discoverable (with match_id); m-3
    # is untouched by the platform -> plain candidate.
    m1 = _item("m-1", started_at=_dt(12, 0))
    m2 = _item("m-2", started_at=_dt(11, 0))
    m3 = _item("m-3", started_at=_dt(10, 0))
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(m1, m2, m3)], "puuid_p_b": [_page(m1, m2, m3)]}
    )
    repo = FakeMatchRepository(imported={"m-1", "m-2"}, attached={"m-1"})
    svc = _service(_players(), henrik, match_repo=repo)

    result = await svc.search_two_player(_request())

    by_id = {c.henrik_match_id: c for c in result.candidates}
    assert "m-1" not in by_id  # attached -> never reappears
    assert by_id["m-2"].match_id is not None  # imported, unattached -> still returned
    assert by_id["m-2"].already_imported is True
    assert by_id["m-3"].match_id is None
    assert repo.attached_lookups == [{"m-1", "m-2", "m-3"}]


# -------------------------------------------------------------- settings caps

async def test_page_size_capped_by_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    item = _item("m-1")
    henrik = FakeHistoryHenrik(
        {"puuid_p_a": [_page(item)], "puuid_p_b": [_page(item)]}
    )
    monkeypatch.setattr(
        "app.services.match_discovery_service.get_settings",
        lambda: Settings(match_search_max_page_size=5, match_search_max_pages=1),
    )
    svc = _service(_players(), henrik)

    result = await svc.search_two_player(_request(page_size=10, max_pages=1))

    assert result.search.page_size == 5
    assert all(call["size"] == 5 for call in henrik.calls)


# -------------------------------------------------------- request schema shape

def test_two_player_search_request_accepts_from_alias() -> None:
    parsed = TwoPlayerSearchRequest.model_validate(
        {
            "player_a": {"name": "A", "tag": "T"},
            "player_b": {"name": "B", "tag": "T"},
            "from": "2026-08-12T11:00:00Z",
        }
    )
    assert parsed.from_ == datetime(2026, 8, 12, 11, 0, tzinfo=UTC)
    assert parsed.platform == "pc"


def test_naive_from_to_bounds_normalized_to_utc() -> None:
    parsed = TwoPlayerSearchRequest.model_validate(
        {
            "player_a": {"name": "A", "tag": "T"},
            "player_b": {"name": "B", "tag": "T"},
            "from": "2026-08-12T11:00:00",
            "to": "2026-08-12T13:00:00",
        }
    )
    assert parsed.from_ == datetime(2026, 8, 12, 11, 0, tzinfo=UTC)
    assert parsed.to == datetime(2026, 8, 12, 13, 0, tzinfo=UTC)
