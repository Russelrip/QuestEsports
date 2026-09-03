from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The private application schema the migration runner creates and the backend
# connects against (ADR-001; Task 17 fix round 1). Deliberately NOT an env
# setting: changing it requires coordinated runner (`scripts/apply_migrations.py`)
# and engine (`app/db/session.py`) changes, so it is pinned as a module constant.
APP_DB_SCHEMA = "valorant"


class Settings(BaseSettings):
    app_env: str = "development"  # development | local | test | production
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform"
    valorant_database_ssl_verify: Literal["off", "full"] = "off"
    valorant_database_ssl_ca_file: str | None = None
    valorant_database_ssl_server_hostname: str | None = None
    henrik_api_key: str | None = None
    henrik_base_url: str = "https://api.henrikdev.xyz"
    henrik_auth_scheme: str = "bare"  # bare | Bearer (pinned by Wave 0)
    henrik_timeout_seconds: float = 15.0
    henrik_max_retries: int = 2
    henrik_retry_after_cap_seconds: float = 30.0
    default_platform: str = "pc"
    default_affinity: str = "eu"
    # Leaderboard registration affinity/platform (R12): mirror valorantsl-new's
    # ``riot_region``/``riot_platform`` ("ap"/"pc") and are distinct from the
    # match-engine ``default_affinity`` above.
    leaderboard_affinity: str = "ap"
    leaderboard_platform: str = "pc"
    # Updater worker settings (R29; mirrors valorantsl-new's
    # ``update_interval_minutes`` / ``rate_limit_delay``).
    updater_interval_minutes: int = 30
    updater_rate_limit_delay: float = 2.5
    # Name-audit worker (R34; mirrors valorantsl-new's ``name_audit_delay``):
    # seconds slept between players during the weekly name/tag drift audit.
    name_audit_delay: float = 0.75
    default_initial_elo: Decimal = Decimal(1000)
    admin_api_key: str | None = None
    # VAL DML runtime role (four-role model; deployment). The migration runner
    # grants schema/table/sequence access and per-table RLS policies to this
    # role; the running app should connect as it in production. When empty the
    # runner leaves the current owner-only posture (development/test default).
    database_runtime_role: str | None = None
    # Quest service-token (HMAC bearer) verification (delta D1; spec §6.3).
    # Format: "kid1=secret1,kid2=secret2" (dual-key rotation window).
    quest_service_shared_secrets: str | None = None
    quest_service_issuer: str = "quest-esports"
    quest_service_audience: str = "valorant-platform"
    service_token_max_skew_seconds: int = 30
    log_level: str = "INFO"
    match_search_max_page_size: int = 50
    # Henrik caps a page near 10 regardless of the requested size, so this is a
    # ceiling of roughly 10 x this many matches per player. At 5 that reached
    # about 50 matches — under three weeks for an active player, which is not
    # far enough to find a tournament played earlier in the same month. Each
    # page costs two Henrik requests (one per player), so 10 is a ceiling of 20
    # requests for the deepest search a caller can ask for; callers still choose
    # their own `max_pages` below it.
    match_search_max_pages: int = 10
    raw_payload_in_responses: bool = False
    # Discord OAuth (R21): minimal httpx exchange; mirrors valorantsl-new's
    # ``discord_client_id``/``discord_client_secret``/``discord_redirect_uri``.
    # Empty defaults keep local/test runs inert until an operator sets them.
    discord_client_id: str = ""
    discord_client_secret: str = ""
    discord_redirect_uri: str = "http://localhost:3000/register"
    # Discord bot worker (R38; D7 reuses valorantsl-new's Discord app). Empty
    # defaults keep the app importable without tokens; the worker exits non-zero
    # if an operator starts it unconfigured.
    discord_token_1: str = ""
    discord_token_2: str = ""
    discord_guild_id: int = 0
    # Release validation gate.  Literal validation is intentional: a typo must
    # fail closed at settings construction rather than silently disabling the
    # freeze.
    write_freeze_mode: Literal["off", "validation"] = "off"
    write_freeze_retry_after_seconds: int = 60
    release_lock_path: str = "/var/lock/quest-esports-release.lock"
    name_audit_lock_retries: int = Field(default=5, ge=0)
    name_audit_lock_retry_seconds: float = Field(default=60, ge=0)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    """Return the module-level cached Settings instance."""
    return Settings()
