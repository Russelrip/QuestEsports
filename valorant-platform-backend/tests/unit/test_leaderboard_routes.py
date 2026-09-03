"""Leaderboard route tests (SDD 2026-08-14 leaderboard standardization, task 4).

``TestClient(create_app())`` with ``app.dependency_overrides[get_leaderboard_service]``
pointing at a fake service (no DB) proves the four routes' exact JSON shapes,
the ``LEADERBOARD_PAGE_NOT_FOUND`` 404 for an out-of-range page, the
search-miss 200 ``null`` body, and — with ``app_env="production"`` — the
service-token gate (401 with no or garbage bearer header). The settings
reader is monkeypatched inside ``app.api.dependencies`` (the same seam the
integration tests use; see ``test_quest_contract_shapes._app``).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_leaderboard_service
from app.config import Settings
from app.main import create_app
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats


class _FakeLeaderboardService:
    """Stub service returning whatever page/top/search/stats it was built with."""

    def __init__(
        self,
        *,
        page: LeaderboardPage | None = None,
        top: list[LeaderboardEntry] | None = None,
        search_result: LeaderboardEntry | None = None,
        stats: LeaderboardStats | None = None,
    ) -> None:
        self._page = page
        self._top = top
        self._search_result = search_result
        self._stats = stats

    async def leaderboard(self, page: int, per_page: int) -> LeaderboardPage:
        assert self._page is not None, "leaderboard() not stubbed"
        return self._page

    async def top(self, count: int) -> list[LeaderboardEntry]:
        assert self._top is not None, "top() not stubbed"
        return self._top

    async def search(self, discord_username: str) -> LeaderboardEntry | None:
        return self._search_result

    async def stats(self) -> LeaderboardStats:
        assert self._stats is not None, "stats() not stubbed"
        return self._stats


ENTRY_DICT = {
    "puuid": "p1",
    "name": "Player One",
    "tag": "ONE",
    "discord_username": "playerone",
    "current_tier": "Gold 1",
    "elo": 1200,
    "rank_in_tier": 42,
    "peak_rank": "Platinum 1",
    "peak_season": "e9a3",
    "last_played_match": "2026-01-02T03:04:05+00:00",
}


def _entry(**overrides: object) -> LeaderboardEntry:
    return LeaderboardEntry(**{**ENTRY_DICT, **overrides})


def _app(
    monkeypatch: pytest.MonkeyPatch,
    fake: _FakeLeaderboardService,
    settings: Settings | None = None,
) -> FastAPI:
    """App with the settings reader patched (auth bypass seam) and the
    leaderboard service dependency overridden with the fake."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: settings if settings is not None else Settings(app_env="test"),
    )
    app = create_app()

    async def _stub_leaderboard_service():
        yield fake

    app.dependency_overrides[get_leaderboard_service] = _stub_leaderboard_service
    return app


def test_leaderboard_route_returns_page_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    page = LeaderboardPage(entries=[_entry()], total=1, page=1, per_page=50, total_pages=1)
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(page=page)))
    resp = client.get("/api/v1/leaderboard", params={"page": 1, "per_page": 50})
    assert resp.status_code == 200
    assert resp.json() == page.model_dump()


def test_top_route_returns_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    entries = [_entry(), _entry(puuid="p2", name="Player Two", tag="TWO", discord_username="playertwo")]
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(top=entries)))
    resp = client.get("/api/v1/leaderboard/top/2")
    assert resp.status_code == 200
    assert resp.json() == [e.model_dump() for e in entries]


def test_search_route_returns_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    entry = _entry()
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(search_result=entry)))
    resp = client.get("/api/v1/leaderboard/search/playerone")
    assert resp.status_code == 200
    assert resp.json() == entry.model_dump()


def test_search_route_returns_null_on_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(search_result=None)))
    resp = client.get("/api/v1/leaderboard/search/ghost")
    assert resp.status_code == 200
    assert resp.json() is None


def test_stats_route_returns_stats_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    stats = LeaderboardStats(
        total_users=10,
        highest_elo=1800,
        lowest_elo=300,
        average_elo=1050.5,
        rank_distribution={"Gold 1": 6, "Silver 2": 4},
    )
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(stats=stats)))
    resp = client.get("/api/v1/leaderboard/stats")
    assert resp.status_code == 200
    assert resp.json() == stats.model_dump()


def test_leaderboard_route_out_of_range_page_404(monkeypatch: pytest.MonkeyPatch) -> None:
    page = LeaderboardPage(entries=[], total=0, page=2, per_page=50, total_pages=1)
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(page=page)))
    resp = client.get("/api/v1/leaderboard", params={"page": 2})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "LEADERBOARD_PAGE_NOT_FOUND"


def test_leaderboard_route_requires_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeLeaderboardService(
        page=LeaderboardPage(entries=[], total=0, page=1, per_page=50, total_pages=1)
    )
    app = _app(
        monkeypatch,
        fake,
        settings=Settings(app_env="production", quest_service_shared_secrets="kid=secret"),
    )
    client = TestClient(app)
    no_header = client.get("/api/v1/leaderboard")
    assert no_header.status_code == 401
    assert no_header.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    garbage = client.get("/api/v1/leaderboard", headers={"Authorization": "Bearer garbage"})
    assert garbage.status_code == 401
    assert garbage.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
