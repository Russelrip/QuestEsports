from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.api.service_token import parse_secrets_map

# The private application schema the migration runner creates and the backend
# connects against (ADR-001; Task 17 fix round 1). Deliberately NOT an env
# setting: changing it requires coordinated runner (`scripts/apply_migrations.py`)
# and engine (`app/db/session.py`) changes, so it is pinned as a module constant.
APP_DB_SCHEMA = "valorant"


class Settings(BaseSettings):
    app_env: str = "development"  # development | local | test | production
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform"
    direct_url: str | None = None
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

    def production_validation_errors(self) -> tuple[str, ...]:
        """Return non-secret production configuration errors.

        Construction remains permissive for local unit tests and development
        tooling.  ``get_settings`` invokes this method before application
        startup, which makes a real production process fail closed without
        putting credential values in an exception or log message.
        """
        if self.app_env != "production":
            return ()

        errors: list[str] = []

        def required(name: str, value: object) -> None:
            if not isinstance(value, str) or not value.strip():
                errors.append(name)

        for name in (
            "HENRIK_API_KEY",
            "QUEST_SERVICE_SHARED_SECRETS",
            "DISCORD_CLIENT_ID",
            "DISCORD_CLIENT_SECRET",
            "DISCORD_TOKEN_1",
            "DISCORD_TOKEN_2",
            "ADMIN_API_KEY",
        ):
            required(name, getattr(self, name.lower()))

        try:
            secrets = parse_secrets_map(self.quest_service_shared_secrets)
        except ValueError:
            secrets = {}
            errors.append("QUEST_SERVICE_SHARED_SECRETS_FORMAT")
        if not secrets:
            errors.append("QUEST_SERVICE_SHARED_SECRETS")

        if self.discord_guild_id <= 0:
            errors.append("DISCORD_GUILD_ID")
        if not self.quest_service_issuer.strip():
            errors.append("QUEST_SERVICE_ISSUER")
        if not self.quest_service_audience.strip():
            errors.append("QUEST_SERVICE_AUDIENCE")

        try:
            redirect = urlsplit(self.discord_redirect_uri)
            redirect_port = redirect.port
            redirect_hostname = redirect.hostname
        except ValueError:
            redirect = None
            redirect_port = None
            redirect_hostname = None
        if (
            redirect is None
            or redirect.scheme != "https"
            or not redirect_hostname
            or redirect.username
            or redirect.password
            or redirect.query
            or redirect.fragment
            or redirect_port not in (None, 443)
        ):
            errors.append("DISCORD_REDIRECT_URI")

        try:
            henrik_url = urlsplit(self.henrik_base_url)
            henrik_port = henrik_url.port
        except ValueError:
            henrik_url = None
            henrik_port = None
        if (
            henrik_url is None
            or henrik_url.scheme != "https"
            or not henrik_url.hostname
            or henrik_url.username
            or henrik_url.password
            or henrik_url.query
            or henrik_url.fragment
            or henrik_port not in (None, 443)
        ):
            errors.append("HENRIK_BASE_URL")
        if self.henrik_auth_scheme not in {"bare", "Bearer"}:
            errors.append("HENRIK_AUTH_SCHEME")

        if self.valorant_database_ssl_verify != "full":
            errors.append("VALORANT_DATABASE_SSL_VERIFY")
        if self.valorant_database_ssl_server_hostname != "quest-postgres":
            errors.append("VALORANT_DATABASE_SSL_SERVER_HOSTNAME")
        ca_file = self.valorant_database_ssl_ca_file
        if (
            not ca_file
            or not Path(ca_file).is_absolute()
            or not Path(ca_file).is_file()
            or Path(ca_file).is_symlink()
        ):
            errors.append("VALORANT_DATABASE_SSL_CA_FILE")

        for name, value in (("DATABASE_URL", self.database_url), ("DIRECT_URL", self.direct_url)):
            if not value:
                errors.append(name)
                continue
            try:
                parsed = urlsplit(value)
                port = parsed.port
            except ValueError:
                errors.append(name)
                continue
            query = parse_qs(parsed.query, keep_blank_values=True)
            if (
                parsed.scheme != "postgresql+asyncpg"
                or parsed.hostname != "quest-postgres"
                or port != 5432
                or parsed.path != "/quest"
                or parsed.username != "val_runtime"
                or parsed.password is None
                or parsed.password == ""
                or query != {"ssl": ["require"]}
                or parsed.fragment
            ):
                errors.append(name)

        return tuple(dict.fromkeys(errors))

    def validate_production(self) -> None:
        """Raise a secret-free error when production settings are incomplete."""
        errors = self.production_validation_errors()
        if errors:
            raise ValueError("invalid production settings: " + ", ".join(errors))


@lru_cache
def get_settings() -> Settings:
    """Return the module-level cached Settings instance."""
    settings = Settings()
    settings.validate_production()
    return settings
