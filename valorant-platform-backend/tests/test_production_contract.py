"""Static and disposable-local tests for the production service boundary."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RELEASE_IMAGE = "example.invalid/valorant-platform@sha256:" + "1" * 64


def _production_settings(ca_file: Path, **overrides: object):
    from app.config import Settings

    values: dict[str, object] = {
        "app_env": "production",
        "database_url": "postgresql+asyncpg://val_runtime:placeholder@quest-postgres:5432/quest?ssl=require",
        "direct_url": "postgresql+asyncpg://val_runtime:placeholder@quest-postgres:5432/quest?ssl=require",
        "valorant_database_ssl_verify": "full",
        "valorant_database_ssl_ca_file": str(ca_file),
        "valorant_database_ssl_server_hostname": "quest-postgres",
        "henrik_api_key": "placeholder",
        "quest_service_shared_secrets": "current=placeholder",
        "discord_client_id": "placeholder",
        "discord_client_secret": "placeholder",
        "discord_redirect_uri": "https://questesports.lk/register",
        "discord_token_1": "placeholder",
        "discord_token_2": "placeholder",
        "discord_guild_id": 123,
        "admin_api_key": "placeholder",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.parametrize(
    ("label", "overrides", "expected_errors"),
    [
        (
            "missing Quest service-secret map",
            {"quest_service_shared_secrets": None},
            {"QUEST_SERVICE_SHARED_SECRETS"},
        ),
        (
            "malformed Quest service-secret map",
            {"quest_service_shared_secrets": "malformed"},
            {"QUEST_SERVICE_SHARED_SECRETS", "QUEST_SERVICE_SHARED_SECRETS_FORMAT"},
        ),
        ("missing Quest issuer", {"quest_service_issuer": ""}, {"QUEST_SERVICE_ISSUER"}),
        ("missing Quest audience", {"quest_service_audience": ""}, {"QUEST_SERVICE_AUDIENCE"}),
        ("missing Henrik API key", {"henrik_api_key": ""}, {"HENRIK_API_KEY"}),
        ("invalid Henrik base URL", {"henrik_base_url": "http://api.henrikdev.xyz"}, {"HENRIK_BASE_URL"}),
        ("invalid Henrik auth scheme", {"henrik_auth_scheme": "token"}, {"HENRIK_AUTH_SCHEME"}),
        ("missing Discord OAuth client ID", {"discord_client_id": ""}, {"DISCORD_CLIENT_ID"}),
        ("missing Discord OAuth client secret", {"discord_client_secret": ""}, {"DISCORD_CLIENT_SECRET"}),
        ("missing Discord worker token 1", {"discord_token_1": ""}, {"DISCORD_TOKEN_1"}),
        ("missing Discord worker token 2", {"discord_token_2": ""}, {"DISCORD_TOKEN_2"}),
        ("missing admin API key", {"admin_api_key": ""}, {"ADMIN_API_KEY"}),
        ("missing Discord guild ID", {"discord_guild_id": 0}, {"DISCORD_GUILD_ID"}),
        (
            "invalid OAuth redirect",
            {"discord_redirect_uri": "http://localhost:3000/register"},
            {"DISCORD_REDIRECT_URI"},
        ),
        ("missing database URL", {"database_url": ""}, {"DATABASE_URL"}),
        ("missing direct URL", {"direct_url": None}, {"DIRECT_URL"}),
        (
            "empty database password",
            {"database_url": "postgresql+asyncpg://val_runtime:@quest-postgres:5432/quest?ssl=require"},
            {"DATABASE_URL"},
        ),
        (
            "empty direct URL password",
            {"direct_url": "postgresql+asyncpg://val_runtime:@quest-postgres:5432/quest?ssl=require"},
            {"DIRECT_URL"},
        ),
        (
            "non-strict TLS verification",
            {"valorant_database_ssl_verify": "off"},
            {"VALORANT_DATABASE_SSL_VERIFY"},
        ),
        (
            "missing TLS CA",
            {"valorant_database_ssl_ca_file": "missing-ca.pem"},
            {"VALORANT_DATABASE_SSL_CA_FILE"},
        ),
        (
            "wrong TLS hostname",
            {"valorant_database_ssl_server_hostname": "localhost"},
            {"VALORANT_DATABASE_SSL_SERVER_HOSTNAME"},
        ),
    ],
)
def test_production_settings_fail_closed_by_required_category(
    tmp_path: Path,
    label: str,
    overrides: dict[str, object],
    expected_errors: set[str],
) -> None:
    ca_file = tmp_path / "ca.pem"
    ca_file.write_text("placeholder", encoding="utf-8")
    settings = _production_settings(ca_file, **overrides)

    errors = settings.production_validation_errors()

    assert expected_errors <= set(errors), label
    assert not any("placeholder" in error for error in errors)


def _compose_config() -> dict:
    if shutil.which("docker") is None:
        pytest.skip("docker is unavailable")
    env = os.environ.copy()
    env["VALORANT_IMAGE"] = RELEASE_IMAGE
    source = (ROOT / "docker-compose.production.yml").read_text().replace(
        "/etc/quest-esports/valorant.production.env",
        str(ROOT / ".env.example").replace("\\", "/"),
    )
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yml", dir=ROOT, encoding="utf-8", delete=False
    ) as rendered:
        rendered.write(source)
        rendered_path = Path(rendered.name)
    try:
        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(rendered_path),
                "--project-name",
                "valorant-prod",
                "config",
                "--format",
                "json",
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        rendered_path.unlink(missing_ok=True)
    return json.loads(result.stdout)


def test_compose_rejects_missing_release_digest() -> None:
    if shutil.which("docker") is None:
        pytest.skip("docker is unavailable")
    env = os.environ.copy()
    env.pop("VALORANT_IMAGE", None)
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.production.yml",
            "--project-name",
            "valorant-prod",
            "config",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "VALORANT_IMAGE must be supplied by the release manifest" in result.stderr


def test_release_validation_accepts_only_digest_images() -> None:
    validator = ROOT / "scripts/validate_release_image.py"
    valid_env = os.environ.copy()
    valid_env["VALORANT_PLATFORM_IMAGE"] = RELEASE_IMAGE
    valid = subprocess.run(
        [sys.executable, str(validator), sys.executable, "-c", ""],
        env=valid_env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert valid.returncode == 0

    mutable_env = os.environ.copy()
    mutable_env["VALORANT_PLATFORM_IMAGE"] = "example.invalid/valorant-platform:latest"
    mutable = subprocess.run(
        [sys.executable, str(validator), sys.executable, "-c", ""],
        env=mutable_env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert mutable.returncode == 64
    assert "immutable @sha256:<64 hex>" in mutable.stderr

    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    assert "Release image is not an immutable digest" in cd
    assert "validate_release_image.py true" in cd


def test_cd_signs_and_verifies_the_exact_digest_with_trusted_identity() -> None:
    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    dockerfile = (ROOT / "Dockerfile").read_text()
    assert "id-token: write" in cd
    assert "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6" in cd
    assert "cosign sign --yes --oidc-issuer \"$COSIGN_OIDC_ISSUER\" \"$IMAGE_REF\"" in cd
    assert "cosign verify" in cd
    assert "--certificate-oidc-issuer \"$COSIGN_OIDC_ISSUER\"" in cd
    assert "--certificate-identity \"$COSIGN_CERTIFICATE_IDENTITY\"" in cd
    assert "https://token.actions.githubusercontent.com" in cd
    assert (
        "https://github.com/Russelrip/valorant-platform-backend/.github/workflows/"
        "cd.yml@refs/heads/main"
    ) in cd
    assert "sbom: true" in cd
    assert "provenance: true" in cd
    assert "docker buildx imagetools inspect --raw \"$IMAGE_REF\"" in cd
    assert "expected an SPDX or CycloneDX SBOM predicate" in cd
    assert "expected an SLSA provenance v1 or v0.2 predicate" in cd
    assert "vars.LEGACY_DIRECT_CD_ENABLED == 'true'" in cd
    assert "FROM python:3.12-slim@sha256:" in dockerfile
    assert "COPY --from=ghcr.io/astral-sh/uv:0.8.14@sha256:" in dockerfile
    assert "FROM python:3.12-slim\n" not in dockerfile


def test_compose_has_exact_services_network_and_loopback_ingress() -> None:
    config = _compose_config()
    services = config["services"]
    assert config["name"] == "valorant-prod"
    assert set(services) == {
        "valorant-platform",
        "valorant-updater",
        "valorant-discord-bot",
        "valorant-name-audit",
    }
    assert services["valorant-platform"]["ports"] == [
        {"mode": "ingress", "target": 8000, "published": "8000", "protocol": "tcp", "host_ip": "127.0.0.1"}
    ]
    assert all("ports" not in services[name] for name in services if name != "valorant-platform")
    aliases = services["valorant-platform"]["networks"]["quest-shared"]["aliases"]
    assert sorted(aliases) == [
        "valorant-discord-bot",
        "valorant-name-audit",
        "valorant-platform",
        "valorant-updater",
    ]
    assert config["networks"]["quest-shared"]["name"] == "quest-shared"
    assert config["networks"]["quest-shared"]["external"] is True


def test_compose_enforces_digest_tls_and_lock_mount_boundary() -> None:
    services = _compose_config()["services"]
    for service in services.values():
        assert "@sha256:" in service["image"]
        assert len(service["image"].rsplit(":", 1)[1]) == 64
        assert service["entrypoint"] == ["/app/.venv/bin/python", "-m", "scripts.validate_release_image"]
        assert "build" not in service
        assert all(volume["target"] != "/app" for volume in service.get("volumes", []))

    platform = services["valorant-platform"]
    assert "0.0.0.0" in platform["command"]
    assert "8000" in platform["command"]
    assert "/run/valorant-tls/valorant-platform.crt" in platform["command"]
    assert "/run/valorant-tls/valorant-platform.key" in platform["command"]
    tls_mounts = {volume["target"]: volume for volume in platform["volumes"]}
    assert set(tls_mounts) == {
        "/run/valorant-tls/valorant-platform.crt",
        "/run/valorant-tls/valorant-platform.key",
        "/run/secrets/quest-private-ca.crt",
    }
    assert all(volume["read_only"] is True for volume in tls_mounts.values())
    assert tls_mounts["/run/valorant-tls/valorant-platform.crt"]["source"].endswith(
        "valorant-platform.crt"
    )
    assert tls_mounts["/run/valorant-tls/valorant-platform.key"]["source"].endswith(
        "valorant-platform.key"
    )
    assert tls_mounts["/run/secrets/quest-private-ca.crt"]["source"].endswith(
        "quest-private-ca.crt"
    )
    assert all(volume["target"] != "/var/lock" for volume in platform.get("volumes", []))
    assert all(
        volume["target"] != "/var/lock"
        for volume in services["valorant-updater"].get("volumes", [])
    )
    audit_targets = [volume["target"] for volume in services["valorant-name-audit"]["volumes"]]
    assert set(audit_targets) == {
        "/run/secrets/quest-private-ca.crt",
        "/var/lock/quest-esports-release.lock",
    }
    assert "workers.name_audit" in services["valorant-name-audit"]["command"]

    for service in services.values():
        assert service["environment"]["VALORANT_DATABASE_SSL_VERIFY"] == "full"
        assert service["environment"]["VALORANT_DATABASE_SSL_CA_FILE"] == (
            "/run/secrets/quest-private-ca.crt"
        )
        assert service["environment"]["VALORANT_DATABASE_SSL_SERVER_HOSTNAME"] == (
            "quest-postgres"
        )
        ca_mounts = [
            volume
            for volume in service.get("volumes", [])
            if volume["target"] == "/run/secrets/quest-private-ca.crt"
        ]
        assert len(ca_mounts) == 1
        assert ca_mounts[0]["read_only"] is True


def test_dockerfile_and_timer_enforce_runtime_identity_and_digest_boundary() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()
    timer_service = (ROOT / "ops/systemd/valorant-name-audit.service").read_text()
    timer = (ROOT / "ops/systemd/valorant-name-audit.timer").read_text()
    compose = (ROOT / "docker-compose.production.yml").read_text()
    assert "--uid 10001" in dockerfile
    assert "--gid 10002 valorant-tls" in dockerfile
    assert "USER app" in dockerfile
    assert "COPY" in dockerfile and "COPY tls" not in dockerfile
    assert "VALORANT_IMAGE:?" in compose
    assert "EnvironmentFile=-/etc/quest-esports/valorant-platform.env" in timer_service
    assert "run --rm --no-deps valorant-name-audit" in timer_service
    assert "OnCalendar=Sun *-*-* 02:00:00 Asia/Colombo" in timer


def test_cd_selects_only_long_running_services_and_commits_metadata_last() -> None:
    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    assert "up -d --no-build --remove-orphans $SERVICES" in cd
    assert "pull $SERVICES" in cd
    assert "run --rm" not in cd
    assert "valorant-name-audit" not in cd.split("SERVICES=", 1)[1].splitlines()[0]
    assert "legacy_units=(valorant-platform.service valorant-updater.service valorant-discord-bot.service)" in cd
    assert "systemctl mask" in cd
    assert 'systemctl stop "$unit" || true' not in cd
    assert 'systemctl disable "$unit" || true' not in cd
    assert 'systemctl cat "$unit"' not in cd
    assert 'systemctl show "$unit" --property="$property" --value' in cd
    assert 'legacy_unit_state "$unit" ActiveState' in cd
    assert 'legacy_unit_state "$unit" UnitFileState' in cd
    assert cd.count("stop_and_mask_legacy_writers") >= 3
    assert "mktemp /etc/quest-esports/.valorant-platform.env" in cd
    assert "mv -f \"$TEMP_ENV\" \"$ENV_FILE\"" in cd
    assert "grep -q '" not in cd
    assert "json.load(sys.stdin)" in cd
    assert ".deploy-image" not in cd
    runtime_start = cd.index("trap 'rollback' EXIT")
    export_index = cd.index('export VALORANT_PLATFORM_IMAGE="$DEPLOY_IMAGE"', runtime_start)
    validation_index = cd.index("python3 scripts/validate_release_image.py true", runtime_start)
    assert runtime_start < export_index < validation_index


def test_cd_holds_release_lock_before_validation_can_trigger_rollback() -> None:
    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    runtime_start = cd.index("trap 'rollback' EXIT")
    lock_setup_index = cd.index('exec 9>"$RELEASE_LOCK_PATH"', runtime_start)
    lock_acquired_index = cd.index("flock 9", lock_setup_index)
    validation_index = cd.index("python3 scripts/validate_release_image.py true", runtime_start)

    # The trap is installed before acquiring the lock, and validation runs only
    # after the lock is held.  Do not compare these runtime operations with the
    # rollback function definition, whose body is declared earlier in the file.
    assert runtime_start < lock_setup_index < lock_acquired_index < validation_index
    assert "flock 9" in cd[runtime_start:validation_index]


def test_first_deployment_failure_fixture_stops_new_project_before_previous_checkout() -> None:
    """Static ordering contract for the no-previous-image rollback path."""
    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    rollback_index = cd.index("rollback() {")
    runtime_start = cd.index("trap 'rollback' EXIT", rollback_index)
    checkout_new_index = cd.index('git checkout --detach "$DEPLOY_SHA"', runtime_start)
    lock_index = cd.index('exec 9>"$RELEASE_LOCK_PATH"', runtime_start)
    snapshot_index = cd.index(
        "cp --preserve=mode,timestamps docker-compose.production.yml", runtime_start
    )
    down_index = cd.index(
        'docker compose -f "$ROLLBACK_COMPOSE_FILE" --project-name valorant-prod down',
        rollback_index,
    )
    previous_checkout_index = cd.index('git checkout --detach "$PREVIOUS_SHA"', rollback_index)
    mask_index = cd.index("if ! stop_and_mask_legacy_writers", runtime_start)
    compose_up_index = cd.index(
        "docker compose -f docker-compose.production.yml --project-name valorant-prod up -d",
        runtime_start,
    )

    # The fixture models a first deployment (PREVIOUS_IMAGE is empty) whose
    # health assertion fails after Compose starts. The snapshot-backed `down`
    # is therefore required before the old checkout is restored, and no legacy
    # writer is unmasked or restarted by this branch.
    assert rollback_index < down_index < previous_checkout_index < runtime_start
    assert runtime_start < checkout_new_index < snapshot_index < lock_index
    assert lock_index < mask_index < compose_up_index
    assert down_index < previous_checkout_index
    assert 'echo "No previous image metadata; partial first deployment has been stopped."' in cd
    assert "systemctl unmask" not in cd
    assert "systemctl enable --now" not in cd


def test_first_deployment_failure_fixture_executes_partial_project_cleanup(tmp_path) -> None:
    """Run the remote deployment body with disposable command fixtures.

    The fixture has no previous image metadata, starts a fake partial Compose
    project, then makes the HTTPS health assertion fail. It proves the actual
    rollback body uses its copied new Compose file to stop that project before
    restoring the previous checkout, while legacy writers remain stopped and
    masked.
    """
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("bash is unavailable")

    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    start = cd.index("<<'SCRIPT'") + len("<<'SCRIPT'\n")
    end = cd.index("\n          SCRIPT", start)
    remote_script = textwrap.dedent(cd[start:end])
    app_dir = tmp_path / "valorant-platform-backend"
    fake_bin = tmp_path / "bin"
    app_dir.mkdir()
    fake_bin.mkdir()
    (app_dir / "docker-compose.production.yml").write_text("services: {}\n")
    (app_dir / "scripts").mkdir()

    log = tmp_path / "commands.log"
    checkout_state = tmp_path / "checkout.state"
    compose_state = tmp_path / "compose.state"
    legacy_state_dir = tmp_path / "legacy-state"
    legacy_state_dir.mkdir()

    def executable(name: str, body: str) -> None:
        path = fake_bin / name
        path.write_text("#!/usr/bin/env bash\nset -u\n" + body)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)

    executable(
        "git",
        f'''printf 'git %s\\n' "$*" >> "{log}"
if [[ "$1" == "rev-parse" && "$2" == "HEAD" ]]; then
  if [[ -e "{checkout_state}" ]]; then
    cat "{checkout_state}"
  else
    printf 'previous-sha\\n'
  fi
elif [[ "$1" == "checkout" && "$2" == "--detach" ]]; then
  printf '%s\\n' "$3" > "{checkout_state}"
fi
''',
    )
    executable(
        "docker",
        f'''printf 'docker %s\\n' "$*" >> "{log}"
case " $* " in
  *" up "*) printf 'active\\n' > "{compose_state}" ;;
  *" down "*)
    if [[ ! -e "{compose_state}" ]] || [[ "$(cat "{compose_state}")" != active ]]; then
      exit 1
    fi
    printf 'stopped\\n' > "{compose_state}"
    ;;
  *" exec "*)
    if [[ ! -e "{compose_state}" ]] || [[ "$(cat "{compose_state}")" != active ]]; then
      exit 1
    fi
    exit 1
    ;;
esac
''',
    )
    executable(
        "python3",
        "exit 0\n",
    )
    executable(
        "sleep",
        "exit 0\n",
    )
    executable(
        "systemctl",
        f'''printf 'systemctl %s\\n' "$*" >> "{log}"
if [[ "$1" == "show" ]]; then
  property="${{3#--property=}}"
  case "$property" in
    LoadState) printf 'loaded\\n' ;;
    ActiveState) if [[ -e "{legacy_state_dir}/$2" ]]; then printf 'inactive\\n'; else printf 'active\\n'; fi ;;
    UnitFileState) printf 'enabled\\n' ;;
  esac
elif [[ "$1" == "stop" ]]; then
  touch "{legacy_state_dir}/$2"
fi
''',
    )
    executable(
        "sudo",
        f'''printf 'sudo %s\\n' "$*" >> "{log}"
case "$1" in
  test) shift; test "$@" ;;
  systemctl) shift; exec systemctl "$@" ;;
  *) exit 0 ;;
esac
''',
    )

    env = os.environ.copy()
    env.update(
        {
            "PATH": str(fake_bin) + os.pathsep + env["PATH"],
            "APP_DIR": str(app_dir),
            "CANONICAL_CHECKOUT_PATH": str(app_dir),
            "DEPLOY_SHA": "new-sha",
            "DEPLOY_IMAGE": "example.invalid/valorant-platform@sha256:" + "2" * 64,
            "VALORANT_ENV_FILE": str(tmp_path / "missing.env"),
            "VALORANT_RELEASE_LOCK_PATH": str(tmp_path / "release.lock"),
        }
    )
    result = subprocess.run(
        [bash, "-c", remote_script],
        cwd=app_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if not log.exists():
        pytest.skip(f"bash executable could not run the fixture: {result.stderr.strip()}")
    assert result.returncode == 1
    commands = log.read_text().splitlines()
    partial_up = next(i for i, line in enumerate(commands) if "docker compose" in line and " up " in line)
    partial_down = next(i for i, line in enumerate(commands) if "docker compose" in line and " down " in line)
    previous_checkout = next(
        i for i, line in enumerate(commands) if "git checkout --detach previous-sha" in line
    )
    assert partial_up < partial_down < previous_checkout
    assert commands[partial_up] == (
        "docker compose -f docker-compose.production.yml --project-name valorant-prod "
        "up -d --no-build --remove-orphans valorant-platform valorant-updater valorant-discord-bot"
    )
    assert commands[partial_down].startswith("docker compose -f ")
    assert commands[partial_down].endswith(
        "--project-name valorant-prod down --remove-orphans"
    )
    assert commands[previous_checkout] == "git checkout --detach previous-sha"
    health_checks = [line for line in commands if "docker compose" in line and " exec " in line]
    assert len(health_checks) == 10
    assert checkout_state.read_text().strip() == "previous-sha"
    assert compose_state.read_text().strip() == "stopped"
    assert "valorant-prod-rollback" in commands[partial_down]
    assert result.stderr.splitlines() == [
        "Deploy failed; restoring previous-sha and Compose writers.",
        "No previous image metadata; partial first deployment has been stopped.",
    ]
    assert all((legacy_state_dir / unit).exists() for unit in (
        "valorant-platform.service",
        "valorant-updater.service",
        "valorant-discord-bot.service",
    ))
    assert sum(line.startswith("systemctl mask") for line in commands) == 3
    assert sum(line.startswith("systemctl stop") for line in commands) == 3
    assert not any("systemctl unmask" in line or "systemctl enable --now" in line for line in commands)


def test_cd_and_systemd_timer_reject_mismatched_checkout_paths() -> None:
    cd = (ROOT / ".github/workflows/cd.yml").read_text()
    service = (ROOT / "ops/systemd/valorant-name-audit.service").read_text()
    canonical = "/opt/quest-esports/valorant-platform-backend"
    assert f"CANONICAL_CHECKOUT_PATH: {canonical}" in cd
    assert '"$APP_DIR" != "$CANONICAL_CHECKOUT_PATH"' in cd
    assert f"WorkingDirectory={canonical}" in service
    assert f"VALORANT_CHECKOUT_PATH:-{canonical}" in service
    assert f'test "$$checkout_path" = "{canonical}"' in service


def test_runbook_uses_fail_closed_legacy_writer_sequence() -> None:
    docs = (ROOT / "docs/containerised-deployment.md").read_text()
    assert "set -euo pipefail" in docs
    assert 'systemctl cat "$unit"' not in docs
    assert 'systemctl stop "$unit" || true' not in docs
    assert 'systemctl disable "$unit" || true' not in docs
    assert 'systemctl show "$unit" --property=LoadState --value' in docs
    assert 'systemctl show "$unit" --property=ActiveState --value' in docs
    assert '[[ "$active_state" == inactive ]]' in docs
    assert 'LEGACY_UNIT=<one-reviewed-legacy-unit>' in docs
    assert 'systemctl unmask "$LEGACY_UNIT"' in docs


def test_name_audit_lock_contention_retries_but_real_lock_errors_fail(tmp_path, monkeypatch) -> None:
    from types import SimpleNamespace

    from workers import name_audit

    settings = SimpleNamespace(
        release_lock_path=str(tmp_path / "release.lock"),
        name_audit_lock_retries=2,
        name_audit_lock_retry_seconds=0,
    )
    attempts = []

    def contend(_path):
        attempts.append(True)

    monkeypatch.setattr(name_audit, "_try_acquire_release_lock", contend)

    async def exercise_contention() -> tuple[bool, object]:
        write_path_entered = False
        async with name_audit._release_lock(settings) as lock_file:
            observed_lock = lock_file
            if lock_file is not None:
                write_path_entered = True
        return write_path_entered, observed_lock

    import asyncio

    write_path_entered, observed_lock = asyncio.run(exercise_contention())
    assert write_path_entered is False
    assert observed_lock is None
    assert len(attempts) == settings.name_audit_lock_retries + 1

    parent = tmp_path / "not-a-directory"
    parent.write_text("not a directory")
    settings.release_lock_path = str(parent / "release.lock")

    async def exercise_invalid_mount() -> None:
        async with name_audit._release_lock(settings):
            pass

    with pytest.raises(name_audit.ReleaseLockError):
        asyncio.run(exercise_invalid_mount())


def test_name_audit_lock_settings_reject_negative_retry_values() -> None:
    try:
        from app.config import Settings
    except ImportError as exc:
        pytest.skip(f"settings dependencies unavailable: {exc}")

    with pytest.raises(ValueError):
        Settings(name_audit_lock_retries=-1)
    with pytest.raises(ValueError):
        Settings(name_audit_lock_retry_seconds=-0.1)


def test_release_lock_success_yields_a_live_non_null_handle(tmp_path) -> None:
    import asyncio
    from types import SimpleNamespace

    from workers import name_audit

    settings = SimpleNamespace(
        release_lock_path=str(tmp_path / "release.lock"),
        name_audit_lock_retries=0,
        name_audit_lock_retry_seconds=0,
    )

    async def exercise():
        async with name_audit._release_lock(settings) as lock_file:
            assert lock_file is not None
            assert not lock_file.closed
            return lock_file

    lock_file = asyncio.run(exercise())
    assert lock_file.closed


def test_worker_admission_is_closed_in_validation_mode() -> None:
    from app.config import Settings
    from app.middleware.write_freeze import refuse_writer_start, writer_admitted

    assert writer_admitted(Settings(write_freeze_mode="off"))
    assert not writer_admitted(Settings(write_freeze_mode="validation"))
    assert not refuse_writer_start("contract-test", Settings(write_freeze_mode="validation"))


def test_each_writer_exits_before_constructing_clients_in_validation_mode(monkeypatch) -> None:
    import asyncio

    from app.config import Settings
    from workers import discord_bot
    try:
        from workers import name_audit
    except ImportError as exc:
        pytest.skip(f"worker dependencies unavailable: {exc}")
    from workers import updater

    settings = Settings(write_freeze_mode="validation")

    def unexpected_constructor(*_args, **_kwargs):
        raise AssertionError("validation-mode writer constructed a client")

    monkeypatch.setattr(updater, "HenrikClient", unexpected_constructor)
    monkeypatch.setattr(name_audit, "HenrikClient", unexpected_constructor)
    monkeypatch.setattr(name_audit, "get_settings", lambda: settings)
    assert asyncio.run(updater._cli_once(settings)) == 0
    assert asyncio.run(name_audit.run_name_audit()) == 0
    assert asyncio.run(discord_bot._run_bots(settings)) is None
