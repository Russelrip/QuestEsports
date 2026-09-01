#!/usr/bin/env bash
set -euo pipefail
umask 077

# This file is installed root:root and is invoked through a narrow sudoers rule.
# It deliberately accepts no source checkout as a release artifact: the only
# runtime inputs are a full commit SHA and a signed/operator-supplied manifest.

die() { printf 'release refused: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

release_lock_path="${RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
[[ "$release_lock_path" == /* && "$release_lock_path" != / ]] || die 'RELEASE_LOCK_PATH must be an absolute non-root path.'
if [[ "${QUEST_DEPLOY_FIXTURE:-0}" != 1 ]]; then
  [[ "$release_lock_path" == /var/lock/quest-esports-release.lock ]] || die 'the canonical release lock path cannot be overridden.'
fi
[[ -e "$release_lock_path" ]] || die 'the canonical release lock must be created by root bootstrap before release.'
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release, migration, backup, or name-audit operation is already running.'

fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'release.sh must run as root.'
  lock_stat="$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" || die 'cannot inspect canonical lock ownership.'
  [[ "$lock_stat" == '0 660' ]] || die 'canonical release lock must be root-owned with mode 0660.'
fi

[[ $# -eq 2 ]] || die 'usage: release.sh FULL_COMMIT_SHA RELEASE_MANIFEST'
release_sha="$1"
manifest_path="$2"
[[ "$release_sha" =~ ^[0-9a-fA-F]{40}$ ]] || die 'the release SHA must be one exact full 40-character hexadecimal commit SHA.'
[[ -f "$manifest_path" && -r "$manifest_path" && ! -L "$manifest_path" ]] || die 'release manifest is missing, unreadable, or a symbolic link.'

release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ "$release_env_file" == /* && "$release_env_file" != / ]] || die 'release environment must be an absolute non-root path.'
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing, unreadable, or a symbolic link.'
if [[ "$fixture_mode" != 1 ]]; then
  env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'cannot inspect release environment ownership.'
  [[ "$env_stat" == 0\ * ]] || die 'release environment must be root-owned.'
  env_mode="${env_stat##* }"
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment must be mode 0600 or 0640.'
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] || die 'release environment must use the canonical host path.'
fi
# shellcheck disable=SC1090
source "$release_env_file"
runtime_env_file="${QUEST_RUNTIME_ENV_FILE:-/etc/quest-esports/quest.production.env}"
valorant_runtime_env_file="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"

require_setting() { [[ -n "${!1:-}" ]] || die "missing release setting: $1"; }
absolute_nonroot() { [[ "$2" == /* && "$2" != / ]] || die "$1 must be an absolute non-root path."; }
command_setting() { require_setting "$1"; [[ -x "${!1}" ]] || die "release command is not executable: $1"; }
validate_release_environment() {
  require_setting RELEASE_ENVIRONMENT
  require_setting RELEASE_ENVIRONMENT_PROTECTED
  [[ "$RELEASE_ENVIRONMENT" == production ]] || die 'release environment must be production.'
  [[ "$RELEASE_ENVIRONMENT_PROTECTED" == 1 ]] || die 'release environment must be protected.'
}
validate_endpoint_identities() {
  [[ "${QUEST_HEALTH_URL:-}" == http://127.0.0.1:5001/api/health/live ]] || die 'Quest liveness endpoint identity is not the fixed loopback endpoint.'
  [[ "${QUEST_READINESS_URL:-}" == http://127.0.0.1:5001/api/health/ready ]] || die 'Quest readiness endpoint identity is not the fixed loopback endpoint.'
  [[ "${VALORANT_HEALTH_URL:-}" == https://valorant-platform:8000/api/v1/health ]] || die 'VALORANT health endpoint identity is not the fixed HTTPS service endpoint.'
}
root_file() {
  local file="$1" enforce_owner="${2:-0}"
  [[ -f "$file" && -r "$file" && ! -L "$file" ]] || die "required file is missing or unsafe: $file"
  if [[ "$fixture_mode" != 1 || "$enforce_owner" == 1 ]]; then
    [[ "$(stat -c '%u' "$file" 2>/dev/null)" == 0 ]] || die "required file is not root-owned: $file"
  fi
}
validate_compose_tls_material() {
  local ca_file cert_file key_file password_file key_mode tls_file tls_stat
  if [[ "$fixture_mode" == 1 ]]; then
    ca_file="${POSTGRES_COMPOSE_CA_FILE:-}"
    cert_file="${POSTGRES_COMPOSE_CERT_FILE:-}"
    key_file="${POSTGRES_COMPOSE_KEY_FILE:-}"
  else
    password_file=/etc/quest-esports/secrets/postgres-admin-password
    ca_file=/etc/quest-esports/tls/quest-private-ca.crt
    cert_file=/etc/quest-esports/tls/quest-postgres.crt
    key_file=/etc/quest-esports/tls/quest-postgres.key
  fi
  for tls_file in "$ca_file" "$cert_file" "$key_file"; do
    root_file "$tls_file" "${QUEST_DEPLOY_FIXTURE_ENFORCE_TLS_OWNERSHIP:-0}"
    [[ -s "$tls_file" ]] || die 'Compose-mounted PostgreSQL TLS material is missing or unsafe.'
  done
  key_mode="$(stat -c '%a' "$key_file" 2>/dev/null)" || die 'Compose-mounted PostgreSQL key mode cannot be inspected.'
  if [[ "$fixture_mode" == 1 ]]; then
    [[ "$key_mode" == 600 || "$key_mode" == 640 ]] || die 'Compose-mounted PostgreSQL key mode is unsafe.'
  else
    [[ "$ca_file" == /etc/quest-esports/tls/quest-private-ca.crt &&
       "$cert_file" == /etc/quest-esports/tls/quest-postgres.crt &&
       "$key_file" == /etc/quest-esports/tls/quest-postgres.key ]] || die 'Compose PostgreSQL TLS files are not the canonical server mounts.'
    tls_stat="$(stat -c '%u:%g %a' "$ca_file" 2>/dev/null)" || die 'canonical PostgreSQL CA ownership cannot be inspected.'
    [[ "$tls_stat" == '0:0 644' ]] || die 'canonical PostgreSQL CA must be root-owned mode 0644.'
    tls_stat="$(stat -c '%u:%g %a' "$cert_file" 2>/dev/null)" || die 'canonical PostgreSQL certificate ownership cannot be inspected.'
    [[ "$tls_stat" == '0:999 640' ]] || die 'canonical PostgreSQL certificate must be root-owned, group-readable by 999, mode 0640.'
    tls_stat="$(stat -c '%u:%g %a' "$key_file" 2>/dev/null)" || die 'canonical PostgreSQL key ownership cannot be inspected.'
    [[ "$tls_stat" == '0:999 640' ]] || die 'canonical PostgreSQL key must be root-owned, group-readable by 999, mode 0640.'
    [[ -f "$password_file" && ! -L "$password_file" && "$(stat -c '%u:%g %a' "$password_file" 2>/dev/null)" == '0:999 640' ]] || die 'canonical PostgreSQL password file must be root-owned, group-readable by 999, mode 0640.'
  fi
}
validate_valorant_runtime_compose() {
  local compose_source="${VALORANT_COMPOSE_SOURCE:-}" contract="${VALORANT_RUNTIME_COMPOSE_CONTRACT:-}" render_env rendered contract_rendered expected_image
  [[ -n "$compose_source" && -f "$compose_source" && ! -L "$compose_source" ]] || die 'VALORANT Compose source is missing or unsafe.'
  [[ -n "$contract" && -f "$contract" && ! -L "$contract" ]] || die 'VALORANT runtime Compose contract is missing or unsafe.'
  expected_image="${manifest[valorant_image]:-${VALORANT_IMAGE_APPROVED_REF:-}}"
  [[ "$expected_image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die 'VALORANT image is not an exact approved digest.'
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for rendered VALORANT Compose validation.'
  render_env="$(mktemp)" || die 'could not create the VALORANT Compose render environment.'
  printf 'VALORANT_IMAGE=%s\n' "$expected_image" > "$render_env"
  chmod 600 "$render_env"
  source_json_file="$(mktemp)" || die 'could not create the rendered VALORANT Compose source file.'
  contract_json_file="$(mktemp)" || { rm -f "$source_json_file"; die 'could not create the rendered VALORANT Compose contract file.'; }
  chmod 600 "$source_json_file" "$contract_json_file"
  "$DOCKER_BIN" compose --env-file "$render_env" -f "$compose_source" --project-name valorant-prod config --no-env-resolution --format json >"$source_json_file" 2>/dev/null || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose source is invalid.'; }
  "$DOCKER_BIN" compose --env-file "$render_env" -f "$contract" --project-name valorant-prod config --no-env-resolution --format json >"$contract_json_file" 2>/dev/null || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose contract is invalid.'; }
  python3 - "$source_json_file" "$contract_json_file" "$expected_image" <<'PY' 2>/dev/null || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose source does not satisfy the asyncpg TLS runtime contract.'; }
import json, sys
def contract(raw, expected_image):
    with open(raw, encoding="utf-8") as rendered:
        doc = json.load(rendered)
    if doc.get("name") != "valorant-prod": raise SystemExit(1)
    service = doc.get("services", {}).get("valorant-platform")
    if not isinstance(service, dict) or service.get("image") != expected_image: raise SystemExit(1)
    if service.get("environment", {}).get("VALORANT_DATABASE_SSL_CA_FILE") != "/run/secrets/quest-private-ca.crt": raise SystemExit(1)
    if service.get("environment", {}).get("VALORANT_DATABASE_SSL_SERVER_HOSTNAME") != "quest-postgres": raise SystemExit(1)
    if service.get("environment", {}).get("VALORANT_DATABASE_SSL_VERIFY") != "full": raise SystemExit(1)
    if set(service.get("networks", {})) != {"quest-shared"}: raise SystemExit(1)
    network_entry = service.get("networks", {}).get("quest-shared")
    expected_aliases = ("valorant-discord-bot", "valorant-name-audit", "valorant-platform", "valorant-updater")
    if not isinstance(network_entry, dict): raise SystemExit(1)
    aliases = network_entry.get("aliases")
    if not isinstance(aliases, list) or tuple(sorted(aliases)) != expected_aliases: raise SystemExit(1)
    network = doc.get("networks", {}).get("quest-shared", {})
    if network.get("name") != "quest-shared" or network.get("external") is not True: raise SystemExit(1)
    env_files = service.get("env_file", [])
    if len(env_files) != 1: raise SystemExit(1)
    env_file = env_files[0] if isinstance(env_files[0], dict) else {"path": env_files[0], "required": True}
    if env_file.get("path") != "/etc/quest-esports/valorant.production.env" or env_file.get("required") is not True: raise SystemExit(1)
    mounts = service.get("volumes", [])
    if not any(isinstance(m, dict) and m.get("source") == "/etc/quest-esports/tls/quest-private-ca.crt" and m.get("target") == "/run/secrets/quest-private-ca.crt" and m.get("read_only") is True for m in mounts): raise SystemExit(1)
    return (service["image"], tuple(sorted(service["environment"].items())), tuple(sorted(env_file.items())), tuple(sorted((m.get("source"), m.get("target"), m.get("read_only")) for m in mounts if isinstance(m, dict))), tuple(sorted(service["networks"])), tuple(sorted(aliases)))
if contract(sys.argv[1], sys.argv[3]) != contract(sys.argv[2], sys.argv[3]): raise SystemExit(1)
PY
  rm -f "$source_json_file" "$contract_json_file"
  rm -f "$render_env"
}
validate_postgres_target() {
  local sentinel_output sentinel_kind sentinel_database sentinel_host sentinel_port sentinel_major sentinel_data_root
  require_setting POSTGRES_TARGET_HOST; require_setting POSTGRES_TARGET_PORT; require_setting POSTGRES_TARGET_DATABASE
  require_setting POSTGRES_TARGET_MAJOR; require_setting POSTGRES_TARGET_DATA_ROOT; require_setting POSTGRES_TARGET_SENTINEL_COMMAND
  [[ "$POSTGRES_TARGET_HOST" == 127.0.0.1 ]] || die 'PostgreSQL target host must be the fixed loopback address.'
  [[ "$POSTGRES_TARGET_PORT" == 55432 ]] || die 'PostgreSQL target port must be the dedicated loopback port.'
  [[ "$POSTGRES_TARGET_DATABASE" == quest ]] || die 'PostgreSQL target database must be quest.'
  [[ "$POSTGRES_TARGET_MAJOR" == 17 ]] || die 'PostgreSQL target must be PostgreSQL 17.'
  [[ "$POSTGRES_TARGET_DATA_ROOT" == /* && "$POSTGRES_TARGET_DATA_ROOT" != / && -d "$POSTGRES_TARGET_DATA_ROOT" && ! -L "$POSTGRES_TARGET_DATA_ROOT" ]] || die 'PostgreSQL durable data root is missing or unsafe.'
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$POSTGRES_TARGET_DATA_ROOT" == /srv/quest-esports/postgres/17/data ]] || die 'PostgreSQL durable data root is not canonical.'
    [[ "$(realpath "$POSTGRES_TARGET_DATA_ROOT" 2>/dev/null)" == "$POSTGRES_TARGET_DATA_ROOT" ]] || die 'PostgreSQL durable data root must not contain a symlink.'
    [[ "$POSTGRES_TARGET_SENTINEL_COMMAND" == /usr/local/sbin/quest-release-postgres-target ]] || die 'PostgreSQL target sentinel path is not canonical.'
    [[ ! -L "$POSTGRES_TARGET_SENTINEL_COMMAND" && "$(stat -c '%u' "$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" == 0 ]] || die 'PostgreSQL target sentinel must be root-owned and non-symlinked.'
  fi
  sentinel_mode="$(stat -c '%a' "$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" || die 'PostgreSQL target sentinel mode cannot be inspected.'
  [[ "$sentinel_mode" =~ ^[0-7]{3,4}$ ]] || die 'PostgreSQL target sentinel mode is invalid.'
  case "$sentinel_mode" in *[2367][0-7]|*[0-7][2367]) die 'PostgreSQL target sentinel is writable by a group or other actor.' ;; esac
  [[ "$POSTGRES_TARGET_SENTINEL_COMMAND" == /* && "$POSTGRES_TARGET_SENTINEL_COMMAND" != / && -x "$POSTGRES_TARGET_SENTINEL_COMMAND" && ! -L "$POSTGRES_TARGET_SENTINEL_COMMAND" ]] || die 'PostgreSQL target sentinel is missing or unsafe.'
  sentinel_output="$("$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" || die 'PostgreSQL target sentinel failed.'
  [[ "$sentinel_output" =~ ^target_kind=([a-z0-9_-]+)[[:space:]]+database=([a-z_][a-z0-9_]*)[[:space:]]+host=([^[:space:]]+)[[:space:]]+port=([0-9]+)[[:space:]]+major=([0-9]+)[[:space:]]+data_root=([^[:space:]]+)$ ]] || die 'PostgreSQL target sentinel output is ambiguous.'
  sentinel_kind="${BASH_REMATCH[1]}"; sentinel_database="${BASH_REMATCH[2]}"; sentinel_host="${BASH_REMATCH[3]}"; sentinel_port="${BASH_REMATCH[4]}"; sentinel_major="${BASH_REMATCH[5]}"; sentinel_data_root="${BASH_REMATCH[6]}"
  [[ "$sentinel_kind" == postgresql17 && "$sentinel_database" == "$POSTGRES_TARGET_DATABASE" && "$sentinel_host" == "$POSTGRES_TARGET_HOST" && "$sentinel_port" == "$POSTGRES_TARGET_PORT" && "$sentinel_major" == "$POSTGRES_TARGET_MAJOR" && "$sentinel_data_root" == "$POSTGRES_TARGET_DATA_ROOT" ]] || die 'PostgreSQL target sentinel does not identify the approved target.'
}
validate_runtime_url_file() {
  local file="$1" expected_role="$2" expected_schema="$3" authority_mode="$4" label="$5"
  local line variable url
  [[ "$file" == /* && "$file" != / && -f "$file" && -r "$file" && ! -L "$file" ]] || die "protected $label runtime environment is missing or unsafe."
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$(stat -c '%u' "$file" 2>/dev/null)" == 0 ]] || die "protected $label runtime environment is not root-owned."
    runtime_env_mode="$(stat -c '%a' "$file" 2>/dev/null)" || die "protected $label runtime environment mode cannot be inspected."
    [[ "$runtime_env_mode" == 600 || "$runtime_env_mode" == 640 ]] || die "protected $label runtime environment mode is unsafe."
    case "$label" in
      Quest) [[ "$(realpath "$file" 2>/dev/null)" == /etc/quest-esports/quest.production.env ]] || die 'protected Quest runtime environment path is not canonical.' ;;
      VALORANT) [[ "$(realpath "$file" 2>/dev/null)" == /etc/quest-esports/valorant.production.env ]] || die 'protected VALORANT runtime environment path is not canonical.' ;;
    esac
  fi
  declare -A runtime_urls=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      variable="${BASH_REMATCH[1]}"
      [[ "$variable" != *MIGRATOR* && "$variable" != *RECOVERY* && "$variable" != *ADMIN_URL* ]] || die "protected $label runtime environment contains a privileged database setting."
    fi
    case "$line" in
      DATABASE_URL=*|DIRECT_URL=*)
        variable="${line%%=*}"; url="${line#*=}"
        [[ -z "${runtime_urls[$variable]+present}" && -n "$url" ]] || die "protected $label runtime environment contains a duplicate or empty database URL."
        runtime_urls["$variable"]="$url"
        ;;
    esac
  done < "$file"
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for runtime database URL validation.'
  if [[ "${label,,}" == valorant ]]; then
    [[ "$(grep -Fxc 'VALORANT_DATABASE_SSL_CA_FILE=/run/secrets/quest-private-ca.crt' "$file" || true)" == 1 ]] || die 'VALORANT runtime environment must name the mounted asyncpg CA file exactly once.'
    [[ "$(grep -Fxc 'VALORANT_DATABASE_SSL_SERVER_HOSTNAME=quest-postgres' "$file" || true)" == 1 ]] || die 'VALORANT runtime environment must name the asyncpg TLS server hostname exactly once.'
    [[ "$(grep -Fxc 'VALORANT_DATABASE_SSL_VERIFY=full' "$file" || true)" == 1 ]] || die 'VALORANT runtime environment must require full asyncpg certificate verification exactly once.'
  fi
  for variable in DATABASE_URL DIRECT_URL; do
    url="${runtime_urls[$variable]:-}"
    [[ -n "$url" ]] || die "protected $label runtime environment is missing $variable."
    if ! python3 - "$url" "$expected_role" "$expected_schema" "$authority_mode" "$label" <<'PY'
from urllib.parse import parse_qs, urlsplit
import sys
url, expected_role, expected_schema, authority, label = sys.argv[1:]
try:
    parsed = urlsplit(url)
    query = parse_qs(parsed.query, strict_parsing=True)
except ValueError:
    raise SystemExit(1)
if parsed.scheme not in ("postgres", "postgresql", "postgresql+asyncpg") or parsed.hostname is None:
    raise SystemExit(1)
if parsed.password is None or parsed.password == "" or parsed.username is None or parsed.username == "" or parsed.path != "/quest" or parsed.fragment:
    raise SystemExit(1)
if authority == "supabase":
    if parsed.hostname == "quest-postgres" or parsed.username != expected_role:
        raise SystemExit(1)
    if label.lower() == "valorant":
        if parsed.scheme != "postgresql+asyncpg" or query != {"ssl": ["require"]}:
            raise SystemExit(1)
    elif query not in ({"schema": [expected_schema]}, {"schema": [expected_schema], "sslmode": ["verify-full"], "sslrootcert": ["/run/secrets/quest-private-ca.crt"]}, {"ssl": ["require"]}):
        raise SystemExit(1)
    raise SystemExit(0)
if authority != "quest-postgres" or parsed.hostname != "quest-postgres" or parsed.port != 5432:
    raise SystemExit(1)
if parsed.username != expected_role:
    raise SystemExit(1)
if label.lower() == "valorant":
    if parsed.scheme != "postgresql+asyncpg" or query != {"ssl": ["require"]}:
        raise SystemExit(1)
elif query != {"schema": [expected_schema], "sslmode": ["verify-full"], "sslrootcert": ["/run/secrets/quest-private-ca.crt"]}:
    raise SystemExit(1)
PY
    then die "$label $variable does not satisfy the runtime PostgreSQL endpoint contract."; fi
  done
}
validate_database_urls() {
  validate_runtime_url_file "$runtime_env_file" quest_runtime public "${RUNTIME_DATABASE_AUTHORITY:-${DATABASE_AUTHORITY:-quest-postgres}}" Quest
  valorant_runtime_env_file="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"
  validate_runtime_url_file "$valorant_runtime_env_file" val_runtime valorant "${RUNTIME_DATABASE_AUTHORITY:-${DATABASE_AUTHORITY:-quest-postgres}}" VALORANT
}
validate_recovery_admin_url_file() {
  local file="$1" recovery_url
  [[ "$file" == /* && "$file" != / && -f "$file" && -r "$file" && ! -L "$file" ]] || die 'recovery administrator URL file is missing or unsafe.'
  recovery_url="$(< "$file")"
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for recovery administrator URL validation.'
  python3 - "$recovery_url" <<'PY' || die 'recovery administrator URL is not the dedicated Quest PostgreSQL recovery credential.'
from urllib.parse import urlsplit
import sys
try:
    parsed = urlsplit(sys.argv[1])
except ValueError:
    raise SystemExit(1)
if (parsed.scheme not in ("postgres", "postgresql") or parsed.username != "quest_recovery_admin" or
        not parsed.password or
        not ((parsed.hostname == "quest-postgres" and parsed.port == 5432) or
             (parsed.hostname == "127.0.0.1" and parsed.port == 55432)) or
        parsed.path != "/quest" or parsed.fragment):
    raise SystemExit(1)
query = parsed.query.split("&") if parsed.query else []
expected_ca = "/run/secrets/quest-private-ca.crt" if parsed.hostname == "quest-postgres" else "/etc/quest-esports/tls/quest-private-ca.crt"
if query != ["sslmode=verify-full", f"sslrootcert={expected_ca}"]:
    raise SystemExit(1)
PY
}
validate_release_environment
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL; do require_setting "$setting"; done
validate_endpoint_identities
root_file "$manifest_path"
if [[ "$fixture_mode" != 1 ]]; then
  manifest_stat="$(stat -c '%u %a' "$manifest_path" 2>/dev/null)" || die 'cannot inspect release manifest ownership.'
  [[ "$manifest_stat" == 0\ 600 || "$manifest_stat" == 0\ 640 ]] || die 'release manifest must be root-owned and mode 0600 or 0640.'
fi

require_setting RELEASE_ROOT
require_setting QUEST_COMPOSE_TEMPLATE
require_setting VALORANT_COMPOSE_SOURCE
require_setting DOCKER_BIN
require_setting POSTGRES_IMAGE_APPROVED_REF
require_setting RECOVERY_ADMIN_URL_FILE
require_setting VALORANT_RUNTIME_COMPOSE_CONTRACT
absolute_nonroot RELEASE_ROOT "$RELEASE_ROOT"
absolute_nonroot RELEASE_LOCK_PATH "$release_lock_path"
root_file "$QUEST_COMPOSE_TEMPLATE"
root_file "$VALORANT_COMPOSE_SOURCE"
[[ -x "$DOCKER_BIN" ]] || die 'DOCKER_BIN is not executable.'

releases_root="${RELEASES_ROOT:-$RELEASE_ROOT/releases}"
current_link="${CURRENT_LINK:-$RELEASE_ROOT/current}"
absolute_nonroot RELEASES_ROOT "$releases_root"
absolute_nonroot CURRENT_LINK "$current_link"
[[ -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'release root must be an existing non-symlink directory.'
mkdir -p "$releases_root"
[[ -d "$releases_root" && ! -L "$releases_root" ]] || die 'release roots must be existing non-symlink directories.'
canonical_releases_root="$(realpath "$releases_root" 2>/dev/null)" || die 'release root cannot be canonicalized.'
[[ "$canonical_releases_root" == "$releases_root" ]] || die 'release root must not contain a symlink.'

declare -A manifest=()
while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
  [[ -z "$manifest_line" ]] && continue
  [[ "$manifest_line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die 'release manifest contains an ambiguous entry.'
  manifest_key="${BASH_REMATCH[1]}"
  manifest_value="${BASH_REMATCH[2]}"
  case "$manifest_key" in
    commit_sha|frontend_image|backend_image|migrator_image|postgres_image|valorant_image) ;;
    *) die "release manifest contains an unknown key: $manifest_key" ;;
  esac
  [[ -z "${manifest[$manifest_key]+present}" ]] || die "release manifest contains a duplicate key: $manifest_key"
  manifest["$manifest_key"]="$manifest_value"
done < "$manifest_path"

for manifest_key in commit_sha frontend_image backend_image migrator_image postgres_image valorant_image; do
  [[ -n "${manifest[$manifest_key]:-}" ]] || die "release manifest is missing $manifest_key."
done
[[ "${manifest[commit_sha],,}" == "${release_sha,,}" ]] || die 'manifest commit_sha does not equal the requested full SHA.'
for manifest_key in frontend_image backend_image migrator_image valorant_image; do
  [[ "${manifest[$manifest_key]}" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die "$manifest_key must be an exact GHCR digest reference."
done
approved_postgres_ref='postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
[[ "${manifest[postgres_image]}" == "$approved_postgres_ref" ]] || die 'postgres_image must be the approved PostgreSQL 17 Bookworm reference.'
[[ "$POSTGRES_IMAGE_APPROVED_REF" == "$approved_postgres_ref" ]] || die 'approved PostgreSQL image is not the approved reference.'
root_file "$RECOVERY_ADMIN_URL_FILE"
validate_recovery_admin_url_file "$RECOVERY_ADMIN_URL_FILE"
validate_compose_tls_material
validate_valorant_runtime_compose
validate_postgres_target
validate_database_urls

quest_project="quest-prod"
valorant_project="valorant-prod"
shared_network="quest-shared"
compose_env_file=""
stage_dir=""
previous_release=""
old_valorant_was_active=false
old_quest_was_active=false
old_quest_stop_attempted=false
freeze_active=false
writer_admitted=false
commit_recorded=false
pointer_updated=false
old_units_stopped=false
old_valorant_stop_attempted=false
postcommit_armed=false
writer_admission_started=false

compose() { "$DOCKER_BIN" compose "$@"; }
compose_common_args() { :; }

validate_project() {
  local compose_file="$1" project="$2" env_file="${3:-}" config_output
  if [[ -n "$env_file" ]]; then
    config_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
  else
    config_output="$(compose -f "$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
  fi
  [[ "$(printf '%s\n' "$config_output" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project."
}

validate_active_project() {
  local compose_file="$1" project="$2" env_file="${3:-}" active_output record service state image record_project
  shift 3
  local expected_count=$#
  declare -A expected_images=() seen_services=()
  for record in "$@"; do
    service="${record%%=*}"
    image="${record#*=}"
    [[ -n "$service" && "$image" != "$record" ]] || die "active Compose topology expectation is invalid for $project."
    expected_images["$service"]="$image"
  done
  if [[ -n "$env_file" ]]; then
    active_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" ps --all --format '{{json .}}' 2>/dev/null)" || die "could not inspect active Compose project $project."
  else
    active_output="$(compose -f "$compose_file" --project-name "$project" ps --all --format '{{json .}}' 2>/dev/null)" || die "could not inspect active Compose project $project."
  fi
  while IFS= read -r record; do
    [[ -n "$record" ]] || continue
    [[ "$record" == \{*\} ]] || die "active Compose topology for $project is not structured JSON."
    service="$(printf '%s\n' "$record" | sed -nE 's/.*"Service"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$service" ]] || die "active Compose topology for $project lacks Service."
    state="$(printf '%s\n' "$record" | sed -nE 's/.*"State"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$state" ]] || die "active Compose topology for $project lacks State."
    image="$(printf '%s\n' "$record" | sed -nE 's/.*"Image"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$image" ]] || die "active Compose topology for $project lacks Image."
    record_project="$(printf '%s\n' "$record" | sed -nE 's/.*"Project"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$record_project" ]] || die "active Compose topology for $project lacks Project."
    [[ "$record_project" == "$project" ]] || die 'active Compose topology contains an unexpected project.'
    [[ "$state" == running ]] || die "active Compose service $service is not running."
    [[ -n "${expected_images[$service]+present}" ]] || die "active Compose topology contains unexpected service $service."
    [[ -z "${seen_services[$service]+present}" ]] || die "active Compose topology contains duplicate service $service."
    [[ "$image" == "${expected_images[$service]}" ]] || die "active Compose service $service has an unexpected image."
    seen_services["$service"]=1
  done <<< "$active_output"
  [[ "${#seen_services[@]}" -eq "$expected_count" ]] || die "active Compose topology is missing an expected service."
  for service in "${!expected_images[@]}"; do
    [[ -n "${seen_services[$service]+present}" ]] || die "active Compose topology is missing service $service."
  done
}

validate_images() {
  local compose_file="$1" project="$2" env_file="$3" output image
  shift 3
  output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" config --images 2>/dev/null)" || die "could not render the staged $project image set."
  for image in "$@"; do
    printf '%s\n' "$output" | grep -Fqx "$image" || die "staged $project Compose does not use exact digest $image."
  done
  while IFS= read -r image; do
    [[ -z "$image" || "$image" =~ @sha256:[0-9a-f]{64}$ ]] || die "staged $project Compose contains a mutable image reference."
  done <<< "$output"
}

validate_aliases() {
  local alias_output alias record container project service image alias_list expected metadata
  declare -A seen_aliases=() expected_projects=() expected_services=() expected_images=()
  expected_projects[quest-backend]=quest-prod; expected_services[quest-backend]=backend; expected_images[quest-backend]="${manifest[backend_image]}"
  expected_projects[quest-postgres]=quest-prod; expected_services[quest-postgres]=postgres; expected_images[quest-postgres]="${manifest[postgres_image]}"
  for alias in valorant-platform valorant-updater valorant-discord-bot valorant-name-audit; do
    expected_projects[$alias]=valorant-prod; expected_services[$alias]=valorant-platform; expected_images[$alias]="${manifest[valorant_image]}"
  done
  alias_output="$("$DOCKER_BIN" network inspect "$shared_network" --format '{{range .Containers}}{{.Name}}|{{join .Aliases ","}}{{"\n"}}{{end}}' 2>/dev/null)" || die "could not inspect external network $shared_network."
  [[ -n "$alias_output" ]] || die "external network $shared_network has no inspectable containers."
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    IFS='|' read -r container alias_list <<< "$record"
    metadata="$("$DOCKER_BIN" inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}' 2>/dev/null)" || die 'shared-network container metadata inspection failed.'
    IFS='|' read -r project service image <<< "$metadata"
    [[ -n "$container" && -n "$project" && -n "$service" && -n "$image" && -n "$alias_list" ]] || die 'shared-network alias inspection is ambiguous.'
    IFS=',' read -r -a aliases <<< "$alias_list"
    for alias in "${aliases[@]}"; do
      [[ -n "$alias" ]] || continue
      [[ -z "${seen_aliases[$alias]+seen}" ]] || die "duplicate shared-network alias: $alias"
      seen_aliases["$alias"]="$project|$service|$image|$container"
    done
  done <<< "$alias_output"
  for alias in quest-backend quest-postgres valorant-platform valorant-updater valorant-discord-bot valorant-name-audit; do
    expected="${seen_aliases[$alias]:-}"
    [[ -n "$expected" ]] || die "required shared-network alias is missing: $alias"
    IFS='|' read -r project service image container <<< "$expected"
    [[ "$project" == "${expected_projects[$alias]}" && "$service" == "${expected_services[$alias]}" && "$image" == "${expected_images[$alias]}" ]] || die "shared-network alias $alias is bound to an unexpected project, service, or image."
  done
}

check_disk() {
  local line available minimum="${RELEASE_MIN_FREE_KB:-1048576}"
  [[ "$minimum" =~ ^[1-9][0-9]*$ ]] || die 'RELEASE_MIN_FREE_KB must be a positive integer.'
  line="$(df -Pk "$RELEASE_ROOT" 2>/dev/null | awk 'NF { last=$0 } END { print last }')" || die 'disk-space check failed.'
  available="$(awk '{ print $4 }' <<< "$line")"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$minimum" ]] || die 'insufficient disk space for an immutable release.'
}

run_migration_status() {
  # Accepted acknowledgements are `pending target=quest-postgres` and `none target=quest-postgres`.
  local variable="$1" repository="$2" target_authority="$3" schema="$4" output
  command_setting "$variable"
  [[ "$target_authority" == quest-postgres ]] || die 'migration target authority is not the fixed Quest PostgreSQL target.'
  [[ "$schema" == public || "$schema" == valorant ]] || die 'migration schema is not an approved service schema.'
  output="$(CHECK_REPOSITORY="$repository" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" "${!variable}" 2>/dev/null)" || die "$variable failed."
  [[ "$output" =~ ^(none|pending)[[:space:]]+target=quest-postgres[[:space:]]+schema=${schema}[[:space:]]+repository=$repository$ ]] || die "$variable returned an ambiguous target/schema/status acknowledgement."
  [[ "$output" == none* ]] && return 0
  return 1
}

run_hook() {
  local variable="$1" output expected="${2:-}"
  command_setting "$variable"
  output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "${!variable}" 2>/dev/null)" || die "$variable failed."
  if [[ -n "$expected" ]]; then
    [[ "$output" == "$expected" ]] || die "$variable did not acknowledge $expected."
  fi
}

run_migrator() {
  # The migrator acknowledgement is `migrated image=<digest> target=quest-postgres`.
  local variable="$1" repository="$2" target_authority="$3" schema="$4" output command expected url_file_setting admin_stat
  command_setting "$variable"
  command="${!variable}"
  [[ "$target_authority" == quest-postgres ]] || die 'migrator target authority is not the fixed Quest PostgreSQL target.'
  [[ "$schema" == public || "$schema" == valorant ]] || die 'migrator schema is not an approved service schema.'
  url_file_setting=QUEST_MIGRATOR_DATABASE_URL_FILE
  [[ "$repository" == valorant ]] && url_file_setting=VALORANT_MIGRATOR_DATABASE_URL_FILE
  require_setting "$url_file_setting"
  [[ "${!url_file_setting}" == /* && -f "${!url_file_setting}" && ! -L "${!url_file_setting}" ]] || die 'migrator URL file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 ]]; then
    admin_stat="$(stat -c '%u %a' "${!url_file_setting}" 2>/dev/null)" || die 'migrator URL file ownership cannot be inspected.'
    [[ "$admin_stat" == '0 600' || "$admin_stat" == '0 640' ]] || die 'migrator URL file must be root-owned and private.'
  fi
  output="$(MIGRATION_REPOSITORY="$repository" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" MIGRATOR_IMAGE="${manifest[migrator_image]}" EXPECTED_MIGRATOR_IMAGE="${manifest[migrator_image]}" MIGRATOR_DATABASE_URL_FILE="${!url_file_setting}" DIRECT_URL_FILE="${!url_file_setting}" "$command" 2>/dev/null)" || die "$variable failed."
  expected="migrated image=${manifest[migrator_image]} target=quest-postgres schema=$schema repository=$repository"
  [[ "$output" == "$expected" ]] || die "$variable did not acknowledge the exact migrator image, target, schema, and repository."
}

run_database_readiness() {
  local output
  command_setting DATABASE_READINESS_COMMAND
  output="$(TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" "$DATABASE_READINESS_COMMAND" 2>/dev/null)" || die 'PostgreSQL 17 database readiness command failed.'
  [[ "$output" =~ ^ready[[:space:]]+target=quest-postgres[[:space:]]+schemas=public,valorant([[:space:]]|$) ]] || die 'PostgreSQL 17 database readiness did not identify both target schemas.'
}

verify_quest_readiness_response() {
  local response="$1"
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for exact Quest readiness validation.'
  python3 - "$response" <<'PY' || die 'Quest readiness response was malformed or not the exact supported success shape.'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except (TypeError, ValueError):
    raise SystemExit(1)
if not isinstance(payload, dict) or set(payload) != {"success", "message", "timestamp", "readiness"} or payload.get("success") is not True:
    raise SystemExit(1)
if payload.get("message") != "Quest E-sports API is healthy." or not isinstance(payload.get("timestamp"), str):
    raise SystemExit(1)
readiness = payload.get("readiness")
if not isinstance(readiness, dict) or set(readiness) not in ({"database", "storage"}, {"database", "storage", "realtime"}) or readiness.get("database") != "ready" or readiness.get("storage") != "ready":
    raise SystemExit(1)
if "realtime" in readiness and readiness["realtime"] != "ready":
    raise SystemExit(1)
if not __import__("re").fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", payload["timestamp"]):
    raise SystemExit(1)
PY
}

run_security_verify() {
  local output admin_stat
  command_setting SECURITY_VERIFY_COMMAND
  require_setting RECOVERY_ADMIN_URL_FILE
  [[ "$RECOVERY_ADMIN_URL_FILE" == /* && "$RECOVERY_ADMIN_URL_FILE" != / && -f "$RECOVERY_ADMIN_URL_FILE" && ! -L "$RECOVERY_ADMIN_URL_FILE" ]] || die 'recovery administrator URL file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 ]]; then
    admin_stat="$(stat -c '%u %a' "$RECOVERY_ADMIN_URL_FILE" 2>/dev/null)" || die 'recovery administrator URL file ownership cannot be inspected.'
    [[ "$admin_stat" == '0 600' || "$admin_stat" == '0 640' ]] || die 'recovery administrator URL file must be root-owned and private.'
  fi
  output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" SECURITY_VERIFY_TARGET=quest-postgres TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres TARGET_DATABASE_PORT=5432 TARGET_DATABASE_NAME=quest TARGET_POSTGRES_MAJOR=17 RECOVERY_ADMIN_URL_FILE="$RECOVERY_ADMIN_URL_FILE" SECURITY_VERIFY_DATABASE_URL_FILE="$RECOVERY_ADMIN_URL_FILE" DATABASE_URL_FILE="$RECOVERY_ADMIN_URL_FILE" "$SECURITY_VERIFY_COMMAND" 2>/dev/null)" || die 'post-restore role, privilege, schema, or migration security verification failed.'
  [[ "$output" == security-verified ]] || die 'security verifier returned an invalid acknowledgement.'
}

validate_legacy_states() {
  local output="$1" units="$2" expected_state="$3" label="$4" line unit state observed
  declare -A seen=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" =~ ^unit=([A-Za-z0-9_.@-]+)[[:space:]]+state=(active|inactive)[[:space:]]+observed_at=([0-9]{8}T[0-9]{6}Z)$ ]] || die "$label returned an untrusted state observation."
    unit="${BASH_REMATCH[1]}"; state="${BASH_REMATCH[2]}"; observed="${BASH_REMATCH[3]}"
    [[ -n "$observed" ]] || die "$label omitted its observation time."
    [[ ",$units," == *,"$unit",* ]] || die "$label reported an unexpected unit."
    [[ -z "${seen[$unit]+present}" ]] || die "$label reported a duplicate unit."
    [[ "$expected_state" == any || "$state" == "$expected_state" ]] || die "$label reported unit $unit as $state, expected $expected_state."
    seen["$unit"]=1
  done <<< "$output"
  local expected
  IFS=',' read -r -a expected_units <<< "$units"
  for expected in "${expected_units[@]}"; do
    [[ -n "${seen[$expected]+present}" ]] || die "$label omitted expected unit $expected."
  done
}

validate_reboot_persistence() {
  local output="$1" units="$2" label="$3" line unit observed
  declare -A seen=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" =~ ^unit=([A-Za-z0-9_.@-]+)[[:space:]]+state=inactive[[:space:]]+reboot_persistent=true[[:space:]]+observed_at=([0-9]{8}T[0-9]{6}Z)$ ]] || die "$label returned invalid reboot-persistence evidence."
    unit="${BASH_REMATCH[1]}"; observed="${BASH_REMATCH[2]}"
    [[ -n "$observed" && ",$units," == *,"$unit",* ]] || die "$label reported an unexpected unit."
    [[ -z "${seen[$unit]+present}" ]] || die "$label reported a duplicate unit."
    seen["$unit"]=1
  done <<< "$output"
  local expected
  IFS=',' read -r -a expected_units <<< "$units"
  for expected in "${expected_units[@]}"; do
    [[ -n "${seen[$expected]+present}" ]] || die "$label omitted expected reboot-persistence evidence for $expected."
  done
}

record_commit_point() {
  local quest_started="$1" quest_admitted="$2" quest_timestamp="$3" valorant_started="$4" valorant_admitted="$5" valorant_timestamp="$6" temporary_file
  [[ -z "${TEST_LOG:-}" ]] || printf 'commit-point\n' >> "$TEST_LOG"
  temporary_file="$stage_dir/.commit-point.$$.tmp"
  {
    printf 'writer_admission_starting=true\n'
    printf 'commit_sha=%s\n' "$release_sha"
    printf 'commit_point_utc=%s\n' "${commit_timestamp:-not-recorded}"
    printf 'quest_writer_admission_started=%s\n' "$quest_started"
    printf 'quest_writer_admitted=%s\n' "$quest_admitted"
    printf 'quest_writer_ack_utc=%s\n' "${quest_timestamp:-not-recorded}"
    printf 'valorant_writer_admission_started=%s\n' "$valorant_started"
    printf 'valorant_writer_admitted=%s\n' "$valorant_admitted"
    printf 'valorant_writer_ack_utc=%s\n' "${valorant_timestamp:-not-recorded}"
    printf 'writer_admitted=%s\n' "$writer_admitted"
    printf 'previous_release=%s\n' "$previous_release"
    printf 'cutover_type=steady-state\n'
    printf 'quest_project=%s\nvalorant_project=%s\nshared_network=%s\n' "$quest_project" "$valorant_project" "$shared_network"
  } > "$temporary_file" 2>/dev/null || return 1
  chmod 600 "$temporary_file" 2>/dev/null || return 1
  mv -Tf -- "$temporary_file" "$stage_dir/commit-point.txt" 2>/dev/null || return 1
}

record_admission_state() {
  local quest_started="$1" quest_admitted="$2" quest_timestamp="$3" valorant_started="$4" valorant_admitted="$5" valorant_timestamp="$6" temporary_file
  temporary_file="$stage_dir/.writer-admission-state.$$.tmp"
  {
    printf 'writer_admission_starting=true\n'
    printf 'commit_sha=%s\n' "$release_sha"
    printf 'commit_point_utc=not-recorded\n'
    printf 'quest_writer_admission_started=%s\n' "$quest_started"
    printf 'quest_writer_admitted=%s\n' "$quest_admitted"
    printf 'quest_writer_ack_utc=%s\n' "${quest_timestamp:-not-recorded}"
    printf 'valorant_writer_admission_started=%s\n' "$valorant_started"
    printf 'valorant_writer_admitted=%s\n' "$valorant_admitted"
    printf 'valorant_writer_ack_utc=%s\n' "${valorant_timestamp:-not-recorded}"
    printf 'writer_admitted=%s\n' "$writer_admitted"
    printf 'previous_release=%s\n' "$previous_release"
    printf 'cutover_type=steady-state\n'
    printf 'quest_project=%s\nvalorant_project=%s\nshared_network=%s\n' "$quest_project" "$valorant_project" "$shared_network"
  } > "$temporary_file" 2>/dev/null || return 1
  chmod 600 "$temporary_file" 2>/dev/null || return 1
  mv -Tf -- "$temporary_file" "$stage_dir/writer-admission-state.txt" 2>/dev/null || return 1
}

precommit_rollback() {
  local rollback_status=0
  set +e
  say 'pre-commit boundary: restoring the previous application release without changing database authority.' >&2
  recovery_hook() {
    local variable="$1" expected="${2:-}" command output rc
    command="${!variable:-}"
    if [[ -z "$command" || ! -x "$command" ]]; then
      printf 'URGENT: pre-commit recovery hook %s is missing or not executable.\n' "$variable" >&2
      return 1
    fi
    output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="${stage_dir:-}" "$command" 2>/dev/null)"; rc=$?
    if (( rc != 0 )) || [[ -n "$expected" && "$output" != "$expected" ]]; then
      printf 'URGENT: pre-commit recovery hook %s failed or returned an invalid acknowledgement.\n' "$variable" >&2
      return 1
    fi
    return 0
  }
  if [[ -n "$stage_dir" ]]; then
    compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name "$quest_project" down --remove-orphans >/dev/null 2>&1 || rollback_status=1
    compose --env-file "$compose_env_file" -f "$stage_dir/valorant.compose.yml" --project-name "$valorant_project" down --remove-orphans >/dev/null 2>&1 || rollback_status=1
  fi
  if [[ "${previous_database_authority:-}" == quest-postgres ]]; then
    if [[ -n "$previous_release" && -f "$previous_release/compose.production.yml" ]]; then
      compose --env-file "$previous_release/.env" -f "$previous_release/compose.production.yml" --project-name "$quest_project" up -d --no-build >/dev/null 2>&1 || rollback_status=1
      compose --env-file "$previous_release/.env" -f "$previous_release/valorant.compose.yml" --project-name "$valorant_project" up -d --no-build >/dev/null 2>&1 || rollback_status=1
    fi
  elif [[ "${previous_database_authority:-}" == supabase ]]; then
    if [[ -n "${OLD_APPLICATION_RESTART_COMMAND:-}" ]]; then
      recovery_hook OLD_APPLICATION_RESTART_COMMAND restarted || rollback_status=1
    else
      printf '%s\n' 'URGENT: legacy Supabase authority was detected but no old application restart contract was configured.' >&2
      rollback_status=1
    fi
  else
    printf '%s\n' 'URGENT: previous database authority was not established; refusing a split-brain rollback.' >&2
    rollback_status=1
  fi
  if [[ "$freeze_active" == true ]]; then
    for freeze_disable in QUEST_FREEZE_DISABLE_COMMAND VALORANT_FREEZE_DISABLE_COMMAND; do
      recovery_hook "$freeze_disable" || rollback_status=1
    done
  fi
  if [[ "$old_valorant_stop_attempted" == true && "$old_valorant_was_active" == true && -n "${OLD_VALORANT_RESTART_COMMAND:-}" ]]; then
    if [[ -n "${OLD_DATABASE_AUTHORITATIVE_COMMAND:-}" ]]; then
      command="${OLD_DATABASE_AUTHORITATIVE_COMMAND:-}"
      [[ -x "$command" ]] && "$command" >/dev/null 2>&1 || rollback_status=1
    fi
    if [[ -n "${OLD_VALORANT_UNMASKED_CHECK:-}" ]]; then
      recovery_hook OLD_VALORANT_UNMASKED_CHECK unmasked || rollback_status=1
    fi
    recovery_hook OLD_VALORANT_RESTART_COMMAND restarted || rollback_status=1
  fi
  if [[ "$old_quest_stop_attempted" == true && "$old_quest_was_active" == true ]]; then
    if [[ -n "${OLD_QUEST_RESTART_COMMAND:-}" ]]; then recovery_hook OLD_QUEST_RESTART_COMMAND restarted || rollback_status=1; else rollback_status=1; fi
  fi
  if (( rollback_status != 0 )); then
    printf '%s\n' 'URGENT: pre-commit rollback was incomplete; do not redirect either service to stale Supabase manually.' >&2
  fi
  return "$rollback_status"
}

postcommit_boundary() {
  local capture_status=0 writer_stop hook hook_rc output
  set +e
  say 'post-commit boundary: stopping both writer groups and re-enabling coordinated freeze.' >&2
  for writer_stop in QUEST_WRITER_STOP_COMMAND VALORANT_WRITER_STOP_COMMAND; do
    hook="${!writer_stop:-}"
    if [[ -z "$hook" || ! -x "$hook" ]]; then
      printf 'URGENT: post-commit hook %s is missing or not executable.\n' "$writer_stop" >&2
      capture_status=1
      continue
    fi
    output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="${stage_dir:-}" "$hook" 2>/dev/null)"
    hook_rc=$?
    if (( hook_rc != 0 )) || [[ "$output" != stopped ]]; then
      printf 'URGENT: post-commit hook %s failed or did not acknowledge stopped.\n' "$writer_stop" >&2
      capture_status=1
    fi
  done
  for freeze_enable in QUEST_FREEZE_ENABLE_COMMAND VALORANT_FREEZE_ENABLE_COMMAND; do
    hook="${!freeze_enable:-}"
    if [[ -z "$hook" || ! -x "$hook" ]]; then
      printf 'URGENT: post-commit freeze-enable hook %s is missing or not executable.\n' "$freeze_enable" >&2
      capture_status=1
    else
      output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="${stage_dir:-}" "$hook" 2>/dev/null)"
      hook_rc=$?
      (( hook_rc == 0 )) || { printf 'URGENT: post-commit freeze-enable hook %s failed.\n' "$freeze_enable" >&2; capture_status=1; }
    fi
  done
  if [[ -n "${CURRENT_STATE_CAPTURE_COMMAND:-}" ]]; then
    hook="$CURRENT_STATE_CAPTURE_COMMAND"
    if [[ ! -x "$hook" ]]; then
      printf '%s\n' 'URGENT: post-commit current-state capture hook is not executable.' >&2
      capture_status=1
    else
      output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="${stage_dir:-}" "$hook" 2>/dev/null)"
      hook_rc=$?
      [[ "$output" == "captured evidence_bundle=$stage_dir" ]] || { printf '%s\n' 'URGENT: post-commit current-state capture did not identify the immutable evidence bundle.' >&2; capture_status=1; }
      (( hook_rc == 0 )) || capture_status=1
    fi
  else
    printf '%s\n' 'URGENT: no current PostgreSQL 17/uploads capture command was configured.' >&2
    capture_status=1
  fi
  if [[ -n "${SUPABASE_URL_ROLLBACK_COMMAND:-}" ]]; then
    printf '%s\n' 'URGENT: blind Supabase URL rollback is prohibited after the first VPS write.' >&2
    capture_status=1
  fi
  if [[ "${SUPABASE_RECONCILIATION_DECISION:-}" != fix-forward && "${SUPABASE_RECONCILIATION_DECISION:-}" != controlled-restore ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires an explicit reconciliation/data-loss decision.' >&2
    capture_status=1
  fi
  if [[ -z "${EXPECTED_LOSS_RPO:-}" ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires an explicit expected-loss/RPO record.' >&2
    capture_status=1
  fi
  if [[ "${INCIDENT_OWNER_APPROVAL:-}" != INCIDENT_OWNER_APPROVAL ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires incident-owner approval.' >&2
    capture_status=1
  fi
  RECOVERY_ACTION_SELECTED=not-selected
  if [[ -z "${RECOVERY_ACTION_COMMAND:-}" || ! -x "$RECOVERY_ACTION_COMMAND" ]]; then
    printf '%s\n' 'URGENT: recovery action command is missing or not executable.' >&2
    capture_status=1
  elif (( capture_status == 0 )); then
    RECOVERY_ACTION_SELECTED="$($RECOVERY_ACTION_COMMAND 2>/dev/null)"; action_rc=$?
    if (( action_rc != 0 )) || [[ "$RECOVERY_ACTION_SELECTED" != "$SUPABASE_RECONCILIATION_DECISION" ]]; then
      printf '%s\n' 'URGENT: recovery action did not match the explicit reconciliation decision.' >&2
      capture_status=1
    fi
  fi
  return "$capture_status"
}

record_recovery_evidence() {
  local boundary="$1" result="$2" original_status="${3:-not-recorded}" recovery_status="${4:-not-recorded}" evidence_file
  [[ -n "${stage_dir:-}" && -d "$stage_dir" ]] || return 0
  evidence_file="$stage_dir/recovery-evidence.txt"
  {
    printf 'boundary=%s\n' "$boundary"
    printf 'result=%s\n' "$result"
    printf 'deployment_exit_status=%s\n' "$original_status"
    printf 'recovery_exit_status=%s\n' "$recovery_status"
    printf 'release_sha=%s\n' "$release_sha"
    printf 'legacy_restart_allowed=%s\n' "$([[ "$boundary" == pre-commit-rollback ]] && printf true || printf false)"
    printf 'writer_admitted=%s\n' "$writer_admitted"
    printf 'supabase_authority_boundary=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf stale-after-first-vps-write || printf preserved-before-first-vps-write)"
    printf 'supabase_url_rollback=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf prohibited || printf allowed-before-writer-admission)"
    printf 'reconciliation_decision=%s\n' "${SUPABASE_RECONCILIATION_DECISION:-not-recorded}"
    printf 'selected_recovery_action=%s\n' "${RECOVERY_ACTION_SELECTED:-not-selected}"
    printf 'expected_loss_rpo=%s\n' "${EXPECTED_LOSS_RPO:-not-recorded}"
    printf 'incident_owner_approval=%s\n' "${INCIDENT_OWNER_APPROVAL:-not-recorded}"
    printf 'supabase_url_rollback_command=%s\n' "$([[ -n "${SUPABASE_URL_ROLLBACK_COMMAND:-}" ]] && printf rejected || printf not-configured)"
  } > "$evidence_file" 2>/dev/null || return 1
  chmod 600 "$evidence_file" 2>/dev/null || return 1
}

on_exit() {
  local status=$? original_status recovery_status
  original_status="$status"
  trap - EXIT
  set +e
  if (( status != 0 )); then
    if [[ "$writer_admission_started" == true || "$writer_admitted" == true ]]; then
      record_recovery_evidence post-commit-recovery started "$original_status" running || true
      postcommit_boundary; recovery_status=$?
      record_recovery_evidence post-commit-recovery "$([[ "$recovery_status" == 0 ]] && printf completed || printf incomplete)" "$original_status" "$recovery_status" || recovery_status=1
      (( recovery_status == 0 )) || status=1
    else
      record_recovery_evidence pre-commit-rollback started "$original_status" running || true
      precommit_rollback; recovery_status=$?
      record_recovery_evidence pre-commit-rollback "$([[ "$recovery_status" == 0 ]] && printf completed || printf incomplete)" "$original_status" "$recovery_status" || recovery_status=1
      (( recovery_status == 0 )) || status=1
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

check_disk
validate_project "$QUEST_COMPOSE_TEMPLATE" "$quest_project"
validate_project "$VALORANT_COMPOSE_SOURCE" "$valorant_project"
command_setting DATABASE_HEALTH_COMMAND
database_health_output="$(DATABASE_URL="${DATABASE_URL:-fixture://database}" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres "$DATABASE_HEALTH_COMMAND" 2>/dev/null)" || die 'PostgreSQL health check failed.'
[[ "$database_health_output" == 'ready target=quest-postgres schemas=public,valorant' ]] || die 'PostgreSQL health check did not identify both target schemas.'
command_setting VALIDATE_HOST_COMMAND
[[ "$(RUNTIME_DATABASE_AUTHORITY="${DATABASE_AUTHORITY:-quest-postgres}" RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" "$VALIDATE_HOST_COMMAND" 2>/dev/null)" == validated ]] || die 'host/artifact validation did not acknowledge the exact release manifest.'
command_setting SERVICE_OWNERSHIP_COMMAND
validate_service_ownership() {
  local output line file service owner mode observed
  declare -A seen=()
  output="$("$SERVICE_OWNERSHIP_COMMAND" 2>/dev/null)" || die 'service ownership evidence command failed.'
  while IFS= read -r line; do
    [[ "$line" =~ ^file=([^[:space:]]+)[[:space:]]+service=([a-z0-9.-]+)[[:space:]]+owner=([^[:space:]]+)[[:space:]]+mode=(0600|0640)[[:space:]]+observed_at=([0-9]{8}T[0-9]{6}Z)$ ]] || die 'service ownership evidence is ambiguous.'
    file="${BASH_REMATCH[1]}"; service="${BASH_REMATCH[2]}"; owner="${BASH_REMATCH[3]}"; mode="${BASH_REMATCH[4]}"; observed="${BASH_REMATCH[5]}"
    [[ "$file" == /etc/quest-esports/release.env && "$owner" == root && -n "$observed" ]] || die 'service ownership evidence does not identify the expected release file, root owner, or observation.'
    [[ "$service" == quest-prod || "$service" == valorant-prod ]] || die 'service ownership evidence identifies an unexpected service.'
    [[ -z "${seen[$service]+present}" ]] || die 'service ownership evidence contains a duplicate service.'
    seen["$service"]="$mode"
  done <<< "$output"
  [[ -n "${seen[quest-prod]:-}" && -n "${seen[valorant-prod]:-}" ]] || die 'service ownership evidence omitted Quest or VALORANT.'
}
validate_service_ownership
command_setting REGISTRY_CHECK_COMMAND
for image in "${manifest[frontend_image]}" "${manifest[backend_image]}" "${manifest[migrator_image]}" "${manifest[postgres_image]}" "${manifest[valorant_image]}"; do
  RELEASE_IMAGE="$image" "$REGISTRY_CHECK_COMMAND" >/dev/null 2>&1 || die "registry access or digest verification failed for $image."
done
command_setting BACKUP_FRESHNESS_COMMAND
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/9 "$BACKUP_FRESHNESS_COMMAND" >/dev/null 2>&1 || die 'verified multi-remote backup freshness check failed.'

if [[ -e "$current_link" || -L "$current_link" ]]; then
  previous_release="$(realpath "$current_link" 2>/dev/null || true)"
  [[ -n "$previous_release" && "$previous_release" == "$canonical_releases_root/"* && -d "$previous_release" && ! -L "$previous_release" ]] || die 'current release pointer is not an immutable release under RELEASES_ROOT.'
  [[ "$(basename "$previous_release")" =~ ^[0-9a-fA-F]{40}$ ]] || die 'current release pointer does not identify a full-SHA release bundle.'
  root_file "$previous_release/compose.production.yml"
  root_file "$previous_release/valorant.compose.yml"
  root_file "$previous_release/.env"
  validate_project "$previous_release/compose.production.yml" "$quest_project" "$previous_release/.env"
  validate_project "$previous_release/valorant.compose.yml" "$valorant_project" "$previous_release/.env"
else
  die 'an existing current release is required for a reversible deployment.'
fi

command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
previous_database_authority="$("$OLD_DATABASE_AUTHORITATIVE_COMMAND" 2>/dev/null)"
[[ "$previous_database_authority" == supabase || "$previous_database_authority" == quest-postgres ]] || die 'previous database authority was ambiguous.'
[[ "$previous_database_authority" != supabase ]] || die 'first cutover requires cutover.sh; release.sh is for steady-state releases only.'

stage_dir="$releases_root/$release_sha"
[[ ! -e "$stage_dir" && ! -L "$stage_dir" ]] || die 'the release directory already exists; release directories are immutable.'
mkdir -p "$stage_dir"
cp -- "$QUEST_COMPOSE_TEMPLATE" "$stage_dir/compose.production.yml"
cp -- "$VALORANT_COMPOSE_SOURCE" "$stage_dir/valorant.compose.yml"
compose_env_file="$stage_dir/.env"
{
  printf 'QUEST_FRONTEND_IMAGE=%s\n' "${manifest[frontend_image]}"
  printf 'QUEST_BACKEND_IMAGE=%s\n' "${manifest[backend_image]}"
  printf 'POSTGRES_IMAGE=%s\n' "${manifest[postgres_image]}"
  printf 'VALORANT_IMAGE=%s\n' "${manifest[valorant_image]}"
  printf 'MIGRATOR_IMAGE=%s\n' "${manifest[migrator_image]}"
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$quest_project"
  printf 'RELEASE_COMMIT_SHA=%s\n' "$release_sha"
} > "$compose_env_file"
chmod 600 "$compose_env_file" "$stage_dir/compose.production.yml" "$stage_dir/valorant.compose.yml"
validate_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file"
validate_images "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file" \
  "${manifest[frontend_image]}" "${manifest[backend_image]}" "${manifest[postgres_image]}"
validate_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file"
validate_images "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file" "${manifest[valorant_image]}"
cat > "$stage_dir/release-metadata.txt" <<EOF
commit_sha=$release_sha
commit_point_utc=not-recorded
writer_admitted=false
current_pointer_updated=false
previous_release=$previous_release
quest_project=$quest_project
valorant_project=$valorant_project
shared_network=$shared_network
database_schemas=public,valorant
writer_groups=quest,valorant
cutover_type=steady-state
EOF
chmod 600 "$stage_dir/release-metadata.txt"

command_setting QUEST_MIGRATION_STATUS_COMMAND
command_setting VALORANT_MIGRATION_STATUS_COMMAND
quest_migration_pending=false
valorant_migration_pending=false
run_migration_status QUEST_MIGRATION_STATUS_COMMAND quest quest-postgres public || quest_migration_pending=true
run_migration_status VALORANT_MIGRATION_STATUS_COMMAND valorant quest-postgres valorant || valorant_migration_pending=true

if [[ "$quest_migration_pending" == true || "$valorant_migration_pending" == true ]]; then
  [[ "${BACKUP_APPROVAL:-}" == BACKUP_QUEST_PRODUCTION ]] || die 'migration requires BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION.'
  if [[ "$quest_migration_pending" == true ]]; then
    [[ "${QUEST_MIGRATION_OWNER_APPROVAL_SHA:-}" == "$release_sha" ]] || die 'Quest migration owner approval does not name this exact SHA.'
  fi
  if [[ "$valorant_migration_pending" == true ]]; then
    [[ "${VALORANT_MIGRATION_OWNER_APPROVAL_SHA:-}" == "$release_sha" ]] || die 'VALORANT migration owner approval does not name this exact SHA.'
  fi
  command_setting BACKUP_COMMAND
  BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/9 "$BACKUP_COMMAND" >/dev/null 2>&1 || die 'backup before migration failed.'
  command_setting BACKUP_EVIDENCE_COMMAND
  backup_evidence="$(BACKUP_RELEASE_SHA="$release_sha" "$BACKUP_EVIDENCE_COMMAND" 2>/dev/null)" || die 'backup evidence command failed.'
  [[ "$backup_evidence" =~ ^verified-complete\ release_sha=${release_sha}\ schemas=verified:public,valorant\ uploads=verified:public,private\ archive=verified\ checksum=verified\ remote=verified$ ]] || die 'backup evidence did not prove the exact release-bound archive, checksum, schemas, uploads, and remote verification contract.'
fi

freeze_active=true
for freeze_group in quest valorant; do
  freeze_enable="${freeze_group^^}_FREEZE_ENABLE_COMMAND"
  freeze_status="${freeze_group^^}_FREEZE_STATUS_COMMAND"
  run_hook "$freeze_enable" validation
  run_hook "$freeze_status" acknowledged
done

command_setting OLD_VALORANT_ACTIVE_CHECK
require_setting OLD_VALORANT_UNITS
[[ "$OLD_VALORANT_UNITS" == valorant-platform,valorant-updater,valorant-discord-bot ]] || die 'old VALORANT unit identity is not the fixed three-unit transition set.'
old_valorant_state="$("$OLD_VALORANT_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_valorant_state" "$OLD_VALORANT_UNITS" any 'old VALORANT state check'
grep -Eq 'state=active([[:space:]]|$)' <<< "$old_valorant_state" && old_valorant_was_active=true
command_setting OLD_VALORANT_STOP_COMMAND
old_valorant_stop_attempted=true
run_hook OLD_VALORANT_STOP_COMMAND
old_units_stopped=true
old_valorant_state="$("$OLD_VALORANT_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_valorant_state" "$OLD_VALORANT_UNITS" inactive 'old VALORANT post-stop state check'
command_setting OLD_QUEST_ACTIVE_CHECK
require_setting OLD_QUEST_UNITS
[[ "$OLD_QUEST_UNITS" == quest-pm2 ]] || die 'old Quest/PM2 unit identity is not the fixed transition unit.'
old_quest_state="$("$OLD_QUEST_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_quest_state" "$OLD_QUEST_UNITS" any 'old Quest/PM2 state check'
grep -Eq 'state=active([[:space:]]|$)' <<< "$old_quest_state" && old_quest_was_active=true
command_setting OLD_QUEST_STOP_COMMAND
old_quest_stop_attempted=true
run_hook OLD_QUEST_STOP_COMMAND
old_quest_state="$("$OLD_QUEST_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_quest_state" "$OLD_QUEST_UNITS" inactive 'old Quest/PM2 post-stop state check'

compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name "$quest_project" pull >/dev/null 2>&1 || die 'staged Quest image pull failed.'
compose --env-file "$compose_env_file" -f "$stage_dir/valorant.compose.yml" --project-name "$valorant_project" pull >/dev/null 2>&1 || die 'staged VALORANT image pull failed.'

if [[ "$quest_migration_pending" == true ]]; then
  run_migrator QUEST_MIGRATOR_COMMAND quest quest-postgres public
fi
if [[ "$valorant_migration_pending" == true ]]; then
  run_migrator VALORANT_MIGRATOR_COMMAND valorant quest-postgres valorant
fi
if [[ "$quest_migration_pending" == true || "$valorant_migration_pending" == true ]]; then
  run_migration_status QUEST_MIGRATION_STATUS_COMMAND quest quest-postgres public || die 'Quest migrations remain pending after the migrator.'
  run_migration_status VALORANT_MIGRATION_STATUS_COMMAND valorant quest-postgres valorant || die 'VALORANT migrations remain pending after the migrator.'
fi

# Verify the final schema on every release, even when migration status was
# already clean. The privileged URL is provided only to this one-shot command.
run_security_verify

validate_compose_tls_material
validate_postgres_target
validate_database_urls
require_setting CANDIDATE_START_CONTRACT
require_setting CANDIDATE_FREEZE_FLAG
require_setting CANDIDATE_READ_ONLY_FLAG
[[ "$CANDIDATE_START_CONTRACT" == frozen-read-only ]] || die 'candidate start contract must be frozen-read-only.'
run_candidate_start() {
  local variable="$1" group="$2" project="$3" output
  command_setting "$variable"
  output="$(
    RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" COMPOSE_ENV_FILE="$compose_env_file" \
    QUEST_COMPOSE_FILE="$stage_dir/compose.production.yml" VALORANT_COMPOSE_FILE="$stage_dir/valorant.compose.yml" \
    CANDIDATE_GROUP="$group" CANDIDATE_PROJECT="$project" WRITE_FREEZE_MODE=validation CANDIDATE_READ_ONLY=1 \
    "${!variable}" --contract "$CANDIDATE_START_CONTRACT" --freeze-flag "$CANDIDATE_FREEZE_FLAG" \
      --read-only-flag "$CANDIDATE_READ_ONLY_FLAG" 2>/dev/null
  )" || die "$variable command failed."
  [[ "$output" == "started-frozen-read-only group=$group" ]] || die "$variable acknowledgement was invalid."
}
run_candidate_start QUEST_CANDIDATE_FROZEN_START_COMMAND quest "$quest_project"
run_candidate_start VALORANT_CANDIDATE_FROZEN_START_COMMAND valorant "$valorant_project"

command_setting CURL_BIN
command_setting VALORANT_CONTAINER_HEALTH_COMMAND
command_setting DATABASE_READINESS_COMMAND
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE; do require_setting "$setting"; done
validate_endpoint_identities
root_file "$VALORANT_CA_FILE"
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health gate failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health response was not healthy.'
quest_ready="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" 2>/dev/null)" || die 'Quest readiness gate failed.'
verify_quest_readiness_response "$quest_ready"
valorant_health="$(VALORANT_HEALTH_URL="$VALORANT_HEALTH_URL" VALORANT_CA_FILE="$VALORANT_CA_FILE" "$VALORANT_CONTAINER_HEALTH_COMMAND" 2>/dev/null)" || die 'VALORANT HTTPS health gate failed from the Quest network boundary.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$valorant_health" && grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<< "$valorant_health" || die 'VALORANT HTTPS health did not return status ok and db up.'
run_database_readiness
validate_active_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file" \
  "frontend=${manifest[frontend_image]}" "backend=${manifest[backend_image]}" "postgres=${manifest[postgres_image]}"
validate_active_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file" \
  "valorant-platform=${manifest[valorant_image]}"
validate_aliases

run_hook QUEST_FROZEN_READ_ONLY_ACK_COMMAND frozen-read-only
run_hook VALORANT_FROZEN_READ_ONLY_ACK_COMMAND frozen-read-only

command_setting POST_COMMIT_RECOVERY_ARM_COMMAND
validate_compose_tls_material
validate_postgres_target
validate_database_urls
run_hook POST_COMMIT_RECOVERY_ARM_COMMAND armed
postcommit_armed=true
commit_timestamp=not-recorded
record_admission_state false false not-recorded false false not-recorded || die 'could not record the armed writer-admission boundary.'
command_setting QUEST_WRITER_ENABLE_COMMAND
record_admission_state true false not-recorded false false not-recorded || die 'could not record the Quest writer-admission start boundary.'
writer_admission_started=true
[[ "$(RELEASE_SHA="$release_sha" "$QUEST_WRITER_ENABLE_COMMAND" 2>/dev/null)" == admitted ]] || die 'Quest writer admission failed.'
writer_admitted=true
commit_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
quest_writer_ack_timestamp="$commit_timestamp"
record_admission_state true true "$quest_writer_ack_timestamp" false false not-recorded || die 'could not record the Quest writer admission boundary.'
command_setting VALORANT_WRITER_ENABLE_COMMAND
record_admission_state true true "$quest_writer_ack_timestamp" true false not-recorded || die 'could not record the VALORANT writer-admission start boundary.'
writer_admission_started=true
[[ "$(RELEASE_SHA="$release_sha" "$VALORANT_WRITER_ENABLE_COMMAND" 2>/dev/null)" == admitted ]] || die 'VALORANT writer admission failed.'
valorant_writer_ack_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
record_commit_point true true "$quest_writer_ack_timestamp" true true "$valorant_writer_ack_timestamp" || die 'could not record the final writer-admission commit point.'
commit_recorded=true

command_setting OLD_VALORANT_REBOOT_PERSISTENCE_CHECK
old_valorant_persistence="$("$OLD_VALORANT_REBOOT_PERSISTENCE_CHECK" 2>/dev/null)"
validate_reboot_persistence "$old_valorant_persistence" "$OLD_VALORANT_UNITS" 'old VALORANT reboot-persistence check'
command_setting OLD_QUEST_REBOOT_PERSISTENCE_CHECK
validate_reboot_persistence "$("$OLD_QUEST_REBOOT_PERSISTENCE_CHECK" 2>/dev/null)" "$OLD_QUEST_UNITS" 'old Quest/PM2 reboot-persistence check'
command_setting OLD_VALORANT_MASK_COMMAND
command_setting OLD_QUEST_MASK_COMMAND
run_hook OLD_QUEST_MASK_COMMAND
run_hook OLD_VALORANT_MASK_COMMAND
temporary_current="$RELEASE_ROOT/.current.$release_sha.$$"
rm -f -- "$temporary_current"
ln -s -- "$stage_dir" "$temporary_current"
mv -Tf -- "$temporary_current" "$current_link"
pointer_updated=true
cat > "$stage_dir/release-metadata.txt" <<EOF
commit_sha=$release_sha
commit_point_utc=$commit_timestamp
writer_admitted=true
current_pointer_updated=true
previous_release=$previous_release
quest_project=$quest_project
valorant_project=$valorant_project
shared_network=$shared_network
database_schemas=public,valorant
writer_groups=quest,valorant
cutover_type=steady-state
EOF
chmod 600 "$stage_dir/release-metadata.txt"
say "Immutable Compose release admitted: $release_sha"
