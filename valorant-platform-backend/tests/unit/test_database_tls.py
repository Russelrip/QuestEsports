from __future__ import annotations

import shutil
import ssl

import pytest

from app.config import Settings
from app.db.tls import database_connect_args


def _ca_file(tmp_path):
    system_ca = ssl.get_default_verify_paths().cafile
    if not system_ca:
        pytest.skip("system CA bundle is unavailable")
    target = tmp_path / "postgres-ca.pem"
    shutil.copyfile(system_ca, target)
    return target


def test_full_verification_builds_asyncpg_ssl_context(tmp_path) -> None:
    ca_file = _ca_file(tmp_path)
    settings = Settings(
        app_env="production",
        database_url="postgresql+asyncpg://runtime:secret@quest-postgres:5432/quest",
        valorant_database_ssl_verify="full",
        valorant_database_ssl_ca_file=str(ca_file),
        valorant_database_ssl_server_hostname="quest-postgres",
    )

    connect_args = database_connect_args(settings, search_path="valorant")

    context = connect_args["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert connect_args["server_settings"] == {"search_path": "valorant"}


def test_full_verification_rejects_url_hostname_mismatch(tmp_path) -> None:
    settings = Settings(
        database_url="postgresql+asyncpg://runtime:secret@127.0.0.1:5432/quest",
        valorant_database_ssl_verify="full",
        valorant_database_ssl_ca_file=str(_ca_file(tmp_path)),
        valorant_database_ssl_server_hostname="quest-postgres",
    )

    with pytest.raises(ValueError, match="does not match"):
        database_connect_args(settings)


def test_production_refuses_unverified_database_connection() -> None:
    settings = Settings(
        app_env="production",
        database_url="postgresql+asyncpg://runtime:secret@quest-postgres:5432/quest",
    )

    with pytest.raises(ValueError, match="require full TLS"):
        database_connect_args(settings)
