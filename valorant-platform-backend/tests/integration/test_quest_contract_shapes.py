"""FastAPI side of the cross-repo contract (design §11.2): assert the exact
request shapes Quest sends are accepted and the documented responses return.
Runs on the migrated-schema harness like the other integration tests.

Dependencies: delta D2 (quest_saved_team_id), D3 (external_quest_series_id),
D4 (unrated), D6 (anchors), D9 (absolute order endpoint) — plan P3.
"""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.main import create_app

pytestmark = [pytest.mark.asyncio, pytest.mark.live]


def _app(monkeypatch: pytest.MonkeyPatch, app_env: str = "test"):
    """Same seam as the other integration tests: patch the settings reader in
    ``app.api.dependencies`` so ``app_env="test"`` bypasses auth."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env=app_env, admin_api_key="s3cret-key"),
    )
    return create_app()


async def test_series_create_contract_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    # The assertion is that the schema accepts the documented Quest shape (no
    # 422 on the external key / anchor fields) and that the missing-prerequisite
    # error is the documented TEAM_NOT_FOUND.
    app = _app(monkeypatch)
    async with (
        httpx.ASGITransport(app=app) as transport,
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
    ):
        resp = await client.post(
            "/api/v1/series",
            json={
                "team_a_id": "00000000-0000-0000-0000-00000000000a",
                "team_b_id": "00000000-0000-0000-0000-00000000000b",
                "format": "bo3",
                "importance": "regular",
                "played_at": "2026-08-02T18:00:00Z",
                "external_quest_series_id": "quest-0000-0000-0000-0000-000000000000",
                "anchor_player_a": {"name": "PlayerA", "tag": "TAG"},
                "anchor_player_b": {"name": "PlayerB", "tag": "TAG"},
            },
        )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "TEAM_NOT_FOUND"
