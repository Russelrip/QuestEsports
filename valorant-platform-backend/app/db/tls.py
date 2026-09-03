"""Fail-closed asyncpg TLS configuration shared by runtime and migrators."""

from __future__ import annotations

import ssl
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import Settings


def database_connect_args(
    settings: Settings,
    *,
    search_path: str | None = None,
) -> dict[str, object]:
    """Build asyncpg connection arguments without placing TLS in the URL."""
    connect_args: dict[str, object] = {}
    if search_path is not None:
        connect_args["server_settings"] = {"search_path": search_path}

    verify = settings.valorant_database_ssl_verify
    if verify == "off":
        if settings.app_env == "production":
            raise ValueError("production PostgreSQL connections require full TLS verification")
        return connect_args

    ca_file = settings.valorant_database_ssl_ca_file
    expected_hostname = settings.valorant_database_ssl_server_hostname
    if not ca_file or not expected_hostname:
        raise ValueError("full PostgreSQL TLS verification requires a CA file and server hostname")

    ca_path = Path(ca_file)
    if not ca_path.is_absolute() or not ca_path.is_file() or ca_path.is_symlink():
        raise ValueError("PostgreSQL TLS CA file must be an absolute, regular, non-symlink file")

    actual_hostname = make_url(settings.database_url).host
    if actual_hostname != expected_hostname:
        raise ValueError("PostgreSQL URL host does not match the approved TLS server hostname")

    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=str(ca_path))
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    connect_args["ssl"] = context
    return connect_args
