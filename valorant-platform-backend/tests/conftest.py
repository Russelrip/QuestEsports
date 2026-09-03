"""Test harness bootstrap: ensure the project root is importable for `app`."""

import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(autouse=True)
def isolate_settings_cache():
    """Keep environment-backed settings isolated between tests."""
    from app.config import get_settings

    original_freeze_mode = os.environ.get("WRITE_FREEZE_MODE")
    get_settings.cache_clear()
    yield

    if original_freeze_mode is None:
        os.environ.pop("WRITE_FREEZE_MODE", None)
    else:
        os.environ["WRITE_FREEZE_MODE"] = original_freeze_mode
    get_settings.cache_clear()
