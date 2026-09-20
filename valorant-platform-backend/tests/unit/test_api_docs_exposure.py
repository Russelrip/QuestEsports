"""api.valorantsl.com is public, so production must not serve the route map."""

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from tests.token_helpers import production_settings

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


@pytest.mark.parametrize("path", DOC_PATHS)
def test_production_hides_api_docs(monkeypatch: pytest.MonkeyPatch, path: str) -> None:
    monkeypatch.setattr(main, "get_settings", lambda: production_settings())
    client = TestClient(main.create_app())
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("path", DOC_PATHS)
def test_non_production_keeps_api_docs(monkeypatch: pytest.MonkeyPatch, path: str) -> None:
    monkeypatch.setattr(main, "get_settings", lambda: Settings(app_env="test"))
    client = TestClient(main.create_app())
    assert client.get(path).status_code == 200
