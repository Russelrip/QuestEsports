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

from app.api.dependencies import get_leaderboard_service, get_server_check_service
from app.api.errors import AppError
from app.config import Settings
from app.main import create_app
from app.schemas.leaderboard import (
    LeaderboardEntry,
    LeaderboardPage,
    LeaderboardRegistration,
    LeaderboardRegistrationPage,
    LeaderboardRemoval,
    LeaderboardRemovalPage,
    LeaderboardRemovedRegistration,
    LeaderboardRestoredRegistration,
    LeaderboardStats,
)
from app.schemas.server_checks import (
    LeaderboardServerCheckEntry,
    LeaderboardServerCheckPage,
    ServerCheckRule,
    ServerCheckSummary,
    ServerMatchCount,
)


class _FakeLeaderboardService:
    """Stub service returning whatever page/top/search/stats it was built with."""

    def __init__(
        self,
        *,
        page: LeaderboardPage | None = None,
        top: list[LeaderboardEntry] | None = None,
        search_result: LeaderboardEntry | None = None,
        stats: LeaderboardStats | None = None,
        registrations: LeaderboardRegistrationPage | None = None,
        removed: LeaderboardRemovedRegistration | None = None,
        removals: LeaderboardRemovalPage | None = None,
        restored: LeaderboardRestoredRegistration | AppError | None = None,
    ) -> None:
        self._page = page
        self._top = top
        self._search_result = search_result
        self._stats = stats
        self._registrations = registrations
        self._removed = removed
        self._removals = removals
        self._restored = restored
        self.calls: list[tuple] = []

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

    async def registrations(self, query: str, page: int, per_page: int) -> LeaderboardRegistrationPage:
        assert self._registrations is not None, "registrations() not stubbed"
        self.calls.append(("registrations", query, page, per_page))
        return self._registrations

    async def remove(self, puuid: str, actor_id: str | None = None) -> LeaderboardRemovedRegistration:
        self.calls.append(("remove", puuid, actor_id))
        if self._removed is None:
            raise AppError("LEADERBOARD_PLAYER_NOT_FOUND", 404, "leaderboard player not found")
        return self._removed

    async def removals(self, query: str, page: int, per_page: int) -> LeaderboardRemovalPage:
        assert self._removals is not None, "removals() not stubbed"
        self.calls.append(("removals", query, page, per_page))
        return self._removals

    async def restore(self, removal_id: str, actor_id: str | None = None) -> LeaderboardRestoredRegistration:
        self.calls.append(("restore", removal_id, actor_id))
        if isinstance(self._restored, AppError):
            raise self._restored
        assert self._restored is not None, "restore() not stubbed"
        return self._restored


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


REGISTRATION = LeaderboardRegistration(
    puuid="p1",
    name="Player One",
    tag="ONE",
    discord_username="playerone",
    current_tier="Gold 3",
    elo=1128,
    last_played_match=None,
    update_source="migration",
    updated_at="2026-08-15T14:09:35+00:00",
    on_leaderboard=False,
)


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


def test_registrations_route_passes_query_and_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    page = LeaderboardRegistrationPage(entries=[REGISTRATION], total=1, page=2, per_page=25, total_pages=1)
    fake = _FakeLeaderboardService(registrations=page)
    client = TestClient(_app(monkeypatch, fake))
    resp = client.get("/api/v1/leaderboard/players", params={"q": "chamsy", "page": 2, "per_page": 25})
    assert resp.status_code == 200
    assert resp.json() == page.model_dump()
    assert fake.calls == [("registrations", "chamsy", 2, 25)]


REMOVED = LeaderboardRemovedRegistration(**REGISTRATION.model_dump(), removal_id="0b5c9a8e-2f4d-4b7e-9c1a-3d5e7f9a1b2c")

REMOVAL = LeaderboardRemoval(
    removal_id=REMOVED.removal_id,
    puuid="p1",
    name="Player One",
    tag="ONE",
    discord_username="playerone",
    current_tier="Gold 3",
    elo=1128,
    last_played_match=None,
    removed_at="2026-09-14T07:33:25+00:00",
    removed_by="actor-1",
    registered_again=False,
    superseded=False,
    restorable=True,
)


def test_remove_route_returns_the_removed_registration_and_actor(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeLeaderboardService(removed=REMOVED)
    client = TestClient(_app(monkeypatch, fake))
    resp = client.delete("/api/v1/leaderboard/players/p1", headers={"X-Quest-Actor-Id": "actor-1"})
    assert resp.status_code == 200
    assert resp.json() == REMOVED.model_dump()
    assert fake.calls == [("remove", "p1", "actor-1")]


def test_removals_route_passes_query_and_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    page = LeaderboardRemovalPage(entries=[REMOVAL], total=1, page=1, per_page=20, total_pages=1)
    fake = _FakeLeaderboardService(removals=page)
    client = TestClient(_app(monkeypatch, fake))
    resp = client.get("/api/v1/leaderboard/removals", params={"q": "one"})
    assert resp.status_code == 200
    assert resp.json() == page.model_dump()
    assert fake.calls == [("removals", "one", 1, 20)]


def test_restore_route_returns_the_restored_registration(monkeypatch: pytest.MonkeyPatch) -> None:
    restored = LeaderboardRestoredRegistration(
        **REGISTRATION.model_dump(),
        removal_id=REMOVED.removal_id,
        removed_at="2026-09-14T07:33:25+00:00",
        removed_by="actor-1",
    )
    fake = _FakeLeaderboardService(restored=restored)
    client = TestClient(_app(monkeypatch, fake))
    resp = client.post(
        f"/api/v1/leaderboard/removals/{REMOVED.removal_id}/restore",
        headers={"X-Quest-Actor-Id": "actor-2"},
    )
    assert resp.status_code == 200
    assert resp.json() == restored.model_dump()
    assert fake.calls == [("restore", REMOVED.removal_id, "actor-2")]


def test_restore_route_surfaces_a_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    refusal = AppError("LEADERBOARD_PLAYER_ALREADY_REGISTERED", 409, "registered again")
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService(restored=refusal)))
    resp = client.post(f"/api/v1/leaderboard/removals/{REMOVED.removal_id}/restore")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LEADERBOARD_PLAYER_ALREADY_REGISTERED"


def test_remove_route_404s_for_an_unknown_player(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeLeaderboardService()))
    resp = client.delete("/api/v1/leaderboard/players/ghost")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "LEADERBOARD_PLAYER_NOT_FOUND"


def test_admin_player_routes_require_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeLeaderboardService(
        registrations=LeaderboardRegistrationPage(entries=[], total=0, page=1, per_page=50, total_pages=1),
        removed=REMOVED,
        removals=LeaderboardRemovalPage(entries=[], total=0, page=1, per_page=20, total_pages=1),
    )
    app = _app(
        monkeypatch,
        fake,
        settings=Settings(app_env="production", quest_service_shared_secrets="kid=secret"),
    )
    client = TestClient(app)
    assert client.get("/api/v1/leaderboard/players").status_code == 401
    assert client.delete("/api/v1/leaderboard/players/p1").status_code == 401
    assert client.get("/api/v1/leaderboard/removals").status_code == 401
    assert client.post(f"/api/v1/leaderboard/removals/{REMOVED.removal_id}/restore").status_code == 401
    assert fake.calls == []


# ------------------------------------------------------------ server check (0018)

SERVER_CHECK_ENTRY = LeaderboardServerCheckEntry(
    puuid="p1",
    name="PlayerA",
    tag="A",
    discord_username="playera",
    current_tier="Gold 1",
    elo=1200,
    last_played_match="2026-09-13T20:11:00+00:00",
    on_leaderboard=True,
    account_region="ap",
    status="flagged",
    reasons=["away_servers"],
    matches=25,
    known_matches=25,
    away_matches=24,
    away_share=0.96,
    servers=[
        ServerMatchCount(cluster="Sydney", matches=24, home=False),
        ServerMatchCount(cluster="Mumbai", matches=1, home=True),
    ],
    since="2026-08-15T00:00:00+00:00",
    checked_at="2026-09-14T10:00:00+00:00",
)


class _FakeServerCheckService:
    def __init__(self, *, outcome: LeaderboardServerCheckEntry | AppError = SERVER_CHECK_ENTRY) -> None:
        self._outcome = outcome
        self.calls: list[tuple] = []

    async def list_checks(
        self, status: str, query: str, page: int, per_page: int, server: str = ""
    ) -> LeaderboardServerCheckPage:
        self.calls.append(("list", status, query, page, per_page, server))
        return LeaderboardServerCheckPage(
            entries=[SERVER_CHECK_ENTRY],
            total=1,
            page=page,
            per_page=per_page,
            total_pages=1,
            summary=ServerCheckSummary(registered=491, checked=12, flagged=1, cleared=0),
            rule=ServerCheckRule(
                home_clusters=["Singapore", "Mumbai"], home_shard="ap", window_days=30, min_matches=5, away_share=0.5
            ),
        )

    async def clear(self, puuid: str, actor_id: str | None = None) -> LeaderboardServerCheckEntry:
        self.calls.append(("clear", puuid, actor_id))
        if isinstance(self._outcome, AppError):
            raise self._outcome
        return self._outcome

    async def reopen(self, puuid: str) -> LeaderboardServerCheckEntry:
        self.calls.append(("reopen", puuid))
        if isinstance(self._outcome, AppError):
            raise self._outcome
        return self._outcome


def _server_check_app(
    monkeypatch: pytest.MonkeyPatch, fake: _FakeServerCheckService, settings: Settings | None = None
) -> FastAPI:
    app = _app(monkeypatch, _FakeLeaderboardService(), settings)

    async def _stub():
        yield fake

    app.dependency_overrides[get_server_check_service] = _stub
    return app


def test_server_checks_route_defaults_to_flagged(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService()
    client = TestClient(_server_check_app(monkeypatch, fake))
    resp = client.get("/api/v1/leaderboard/server-checks")
    assert resp.status_code == 200
    body = resp.json()
    assert body["entries"] == [SERVER_CHECK_ENTRY.model_dump()]
    assert body["summary"]["flagged"] == 1
    assert body["rule"]["home_clusters"] == ["Singapore", "Mumbai"]
    assert fake.calls == [("list", "flagged", "", 1, 20, "")]


def test_server_checks_route_passes_status_query_and_paging(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService()
    client = TestClient(_server_check_app(monkeypatch, fake))
    resp = client.get(
        "/api/v1/leaderboard/server-checks", params={"status": "cleared", "q": "playa", "page": 2, "per_page": 10}
    )
    assert resp.status_code == 200
    assert fake.calls == [("list", "cleared", "playa", 2, 10, "")]
    assert client.get("/api/v1/leaderboard/server-checks", params={"status": "clear"}).status_code == 422


def test_server_checks_route_lists_everyone_on_one_server(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService()
    client = TestClient(_server_check_app(monkeypatch, fake))
    resp = client.get("/api/v1/leaderboard/server-checks", params={"status": "all", "server": "Sydney"})
    assert resp.status_code == 200
    assert fake.calls == [("list", "all", "", 1, 20, "Sydney")]
    assert client.get("/api/v1/leaderboard/server-checks", params={"server": "x" * 51}).status_code == 422


def test_clear_route_records_the_actor(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService()
    client = TestClient(_server_check_app(monkeypatch, fake))
    resp = client.post("/api/v1/leaderboard/server-checks/p1/clear", headers={"X-Quest-Actor-Id": "actor-1"})
    assert resp.status_code == 200
    assert resp.json() == SERVER_CHECK_ENTRY.model_dump()
    assert fake.calls == [("clear", "p1", "actor-1")]


def test_clear_and_reopen_surface_refusals(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService(outcome=AppError("LEADERBOARD_SERVER_CHECK_NOT_FLAGGED", 409, "not flagged"))
    client = TestClient(_server_check_app(monkeypatch, fake))
    resp = client.post("/api/v1/leaderboard/server-checks/p1/clear")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LEADERBOARD_SERVER_CHECK_NOT_FLAGGED"
    assert client.delete("/api/v1/leaderboard/server-checks/p1/clear").status_code == 409
    assert fake.calls == [("clear", "p1", None), ("reopen", "p1")]


def test_server_check_routes_require_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeServerCheckService()
    client = TestClient(
        _server_check_app(
            monkeypatch, fake, Settings(app_env="production", quest_service_shared_secrets="kid=secret")
        )
    )
    assert client.get("/api/v1/leaderboard/server-checks").status_code == 401
    assert client.post("/api/v1/leaderboard/server-checks/p1/clear").status_code == 401
    assert client.delete("/api/v1/leaderboard/server-checks/p1/clear").status_code == 401
    assert fake.calls == []
