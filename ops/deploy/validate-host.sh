#!/usr/bin/env bash
set -euo pipefail
umask 077

# This is the host trust boundary. It intentionally emits one non-secret
# success token and fixed failure messages; image names, certificate paths, and
# command output are never included in its output.
die() { printf '%s\n' "host validation failed: $*" >&2; exit 1; }
fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
manifest_path="${RELEASE_MANIFEST:-${1:-}}"
release_sha="${RELEASE_SHA:-}"

[[ "$release_env_file" == /* && "$release_env_file" != / ]] || die 'release environment path is invalid.'
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'host validation must run as root.'
  [[ "$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" == 0\ * ]] || die 'release environment is not root-owned.'
  env_mode="$(stat -c '%a' "$release_env_file" 2>/dev/null)" || die 'release environment mode cannot be inspected.'
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment mode is unsafe.'
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] || die 'release environment path is not canonical.'
fi
# shellcheck disable=SC1090
source "$release_env_file"
runtime_env_file="${QUEST_RUNTIME_ENV_FILE:-/etc/quest-esports/quest.production.env}"
valorant_runtime_env_file="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"
require_setting() { [[ -n "${!1:-}" ]] || die "required host setting is missing: $1."; }
require_setting RELEASE_ENVIRONMENT
require_setting RELEASE_ENVIRONMENT_PROTECTED
[[ "$RELEASE_ENVIRONMENT" == production && "$RELEASE_ENVIRONMENT_PROTECTED" == 1 ]] || die 'release environment is not the protected production environment.'

[[ -n "$manifest_path" && -f "$manifest_path" && -r "$manifest_path" && ! -L "$manifest_path" ]] || die 'release manifest is missing or unsafe.'
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA is missing or is not a full lowercase SHA.'
if [[ "$fixture_mode" != 1 ]]; then
  manifest_stat="$(stat -c '%u %a' "$manifest_path" 2>/dev/null)" || die 'release manifest ownership cannot be inspected.'
  [[ "$manifest_stat" == 0\ * ]] || die 'release manifest is not root-owned.'
  manifest_mode="${manifest_stat##* }"
  [[ "$manifest_mode" == 600 || "$manifest_mode" == 640 ]] || die 'release manifest mode is unsafe.'
  [[ "$manifest_mode" != *2 && "$manifest_mode" != *3 && "$manifest_mode" != *6 && "$manifest_mode" != *7 ]] || die 'release manifest is writable by a non-root actor.'
fi

root_file() {
  local file="$1" enforce_owner="${2:-0}"
  [[ -f "$file" && -r "$file" && ! -L "$file" ]] || die 'required host file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 || "$enforce_owner" == 1 ]]; then
    [[ "$(stat -c '%u' "$file" 2>/dev/null)" == 0 ]] || die 'required host file is not root-owned.'
  fi
}

validate_compose_tls_material() {
  local ca_file cert_file key_file password_file key_mode tls_stat tls_uid tls_gid
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
validate_backup_tls_material() {
  local ca_file cert_file key_file server_cert_file tls_file tls_stat client_tls_dir
  if [[ "$fixture_mode" == 1 ]]; then
    ca_file="${BACKUP_CLIENT_CA_FILE:-}"
    cert_file="${BACKUP_CLIENT_CERT_FILE:-}"
    key_file="${BACKUP_CLIENT_KEY_FILE:-}"
    server_cert_file="${POSTGRES_COMPOSE_CERT_FILE:-}"
    client_tls_dir="${BACKUP_CLIENT_TLS_DIR:-}"
  else
    client_tls_dir=/etc/quest-esports-backup
    ca_file=/etc/quest-esports-backup/backup-client-ca.crt
    cert_file=/etc/quest-esports-backup/backup-client.crt
    key_file=/etc/quest-esports-backup/backup-client.key
    server_cert_file=/etc/quest-esports/tls/quest-postgres.crt
  fi
  [[ "$client_tls_dir" == /* && "$client_tls_dir" != / && -d "$client_tls_dir" && ! -L "$client_tls_dir" ]] || die 'backup PostgreSQL TLS directory is missing or unsafe.'
  [[ "$(stat -c '%a' "$client_tls_dir" 2>/dev/null)" == 750 ]] || die 'backup PostgreSQL TLS directory must be mode 0750.'
  for tls_file in "$ca_file" "$cert_file" "$key_file"; do
    root_file "$tls_file" "${QUEST_DEPLOY_FIXTURE_ENFORCE_BACKUP_TLS_OWNERSHIP:-0}"
    [[ -s "$tls_file" ]] || die 'backup PostgreSQL TLS material is missing or unsafe.'
    [[ "$(stat -c '%a' "$tls_file" 2>/dev/null)" == 640 ]] || die 'backup PostgreSQL TLS material must be mode 0640.'
  done
  if [[ "$fixture_mode" != 1 || "${QUEST_DEPLOY_FIXTURE_ENFORCE_BACKUP_CA_CHAIN:-0}" == 1 ]]; then
    command -v openssl >/dev/null 2>&1 || die 'openssl is required to validate the backup PostgreSQL CA bundle.'
    [[ -f "$server_cert_file" && -r "$server_cert_file" && ! -L "$server_cert_file" ]] || die 'PostgreSQL server certificate is missing or unsafe for backup CA validation.'
    openssl verify -purpose sslserver -CAfile "$ca_file" "$server_cert_file" >/dev/null 2>&1 || die 'backup PostgreSQL CA bundle does not validate the PostgreSQL server certificate issuer.'
  fi
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$client_tls_dir" == /etc/quest-esports-backup &&
       "$ca_file" == /etc/quest-esports-backup/backup-client-ca.crt &&
       "$cert_file" == /etc/quest-esports-backup/backup-client.crt &&
       "$key_file" == /etc/quest-esports-backup/backup-client.key ]] || die 'backup PostgreSQL TLS files are not the canonical client mounts.'
    tls_stat="$(stat -c '%U:%G %a' "$client_tls_dir" 2>/dev/null)" || die 'backup PostgreSQL TLS directory ownership cannot be inspected.'
    [[ "$tls_stat" == 'root:deploy 750' ]] || die 'backup PostgreSQL TLS directory must be root-owned, deploy-group-traversable, mode 0750.'
    tls_stat="$(stat -c '%U:%G %a' "$ca_file" 2>/dev/null)" || die 'backup PostgreSQL CA ownership cannot be inspected.'
    [[ "$tls_stat" == 'root:deploy 640' ]] || die 'backup PostgreSQL CA must be root-owned, deploy-group-readable, mode 0640.'
    tls_stat="$(stat -c '%U:%G %a' "$cert_file" 2>/dev/null)" || die 'backup PostgreSQL certificate ownership cannot be inspected.'
    [[ "$tls_stat" == 'root:deploy 640' ]] || die 'backup PostgreSQL certificate must be root-owned, deploy-group-readable, mode 0640.'
    tls_stat="$(stat -c '%U:%G %a' "$key_file" 2>/dev/null)" || die 'backup PostgreSQL key ownership cannot be inspected.'
    [[ "$tls_stat" == 'root:deploy 640' ]] || die 'backup PostgreSQL key must be root-owned, deploy-group-readable, mode 0640.'
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
if parsed.password is None or parsed.username is None or parsed.path != "/quest" or parsed.fragment:
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
  validate_runtime_url_file "$runtime_env_file" quest_runtime public "${RUNTIME_DATABASE_AUTHORITY:-quest-postgres}" Quest
  valorant_runtime_env_file="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"
  validate_runtime_url_file "$valorant_runtime_env_file" val_runtime valorant "${RUNTIME_DATABASE_AUTHORITY:-quest-postgres}" VALORANT
}

for setting in RELEASE_ROOT RELEASES_ROOT RELEASE_LOCK_PATH DOCKER_BIN COSIGN_BIN QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP QUEST_COSIGN_OIDC_ISSUER VALORANT_COSIGN_CERTIFICATE_IDENTITY_REGEXP VALORANT_COSIGN_OIDC_ISSUER POSTGRES_COSIGN_CERTIFICATE_IDENTITY_REGEXP POSTGRES_COSIGN_OIDC_ISSUER POSTGRES_IMAGE_APPROVED_REF VALORANT_IMAGE_APPROVED_REF SERVICE_OWNERSHIP_COMMAND VALORANT_COMPOSE_SOURCE VALORANT_RUNTIME_COMPOSE_CONTRACT; do
  require_setting "$setting"
done
for setting in POSTGRES_TARGET_HOST POSTGRES_TARGET_PORT POSTGRES_TARGET_DATABASE POSTGRES_TARGET_MAJOR POSTGRES_TARGET_DATA_ROOT POSTGRES_TARGET_SENTINEL_COMMAND; do
  require_setting "$setting"
done
[[ "$POSTGRES_COSIGN_CERTIFICATE_IDENTITY_REGEXP" != "$QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP" ]] || die 'PostgreSQL trust policy must not reuse the Quest signer identity.'
[[ "$VALORANT_COSIGN_CERTIFICATE_IDENTITY_REGEXP" != "$QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP" ]] || die 'VALORANT trust policy must not reuse the Quest signer identity.'
[[ "$POSTGRES_COSIGN_CERTIFICATE_IDENTITY_REGEXP" != "$VALORANT_COSIGN_CERTIFICATE_IDENTITY_REGEXP" ]] || die 'PostgreSQL trust policy must remain independent of VALORANT.'
[[ "$RELEASE_LOCK_PATH" == /* && "$RELEASE_LOCK_PATH" != / && -e "$RELEASE_LOCK_PATH" && ! -L "$RELEASE_LOCK_PATH" ]] || die 'canonical release lock is invalid.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$RELEASE_LOCK_PATH" == /var/lock/quest-esports-release.lock ]] || die 'canonical release lock path cannot be overridden.'
fi
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / && -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'release root is invalid.'
[[ "$RELEASES_ROOT" == /* && "$RELEASES_ROOT" != / && -d "$RELEASES_ROOT" && ! -L "$RELEASES_ROOT" ]] || die 'release storage root is invalid.'
[[ -x "$DOCKER_BIN" && -x "$COSIGN_BIN" && -x "$SERVICE_OWNERSHIP_COMMAND" ]] || die 'required host command is not executable.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(stat -c '%u' "$RELEASE_ROOT" 2>/dev/null)" == 0 && "$(stat -c '%u' "$RELEASES_ROOT" 2>/dev/null)" == 0 ]] || die 'release directories are not root-owned.'
fi
root_file "$manifest_path"

declare -A manifest=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die 'manifest entry is ambiguous.'
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  case "$key" in
    commit_sha|frontend_image|backend_image|migrator_image|postgres_image|valorant_image) ;;
    *) die 'manifest contains an unknown key.' ;;
  esac
  [[ -z "${manifest[$key]+present}" ]] || die 'manifest contains a duplicate key.'
  manifest["$key"]="$value"
done < "$manifest_path"
for key in commit_sha frontend_image backend_image migrator_image postgres_image valorant_image; do
  [[ -n "${manifest[$key]:-}" ]] || die 'manifest is incomplete.'
done
[[ "${manifest[commit_sha]}" == "$release_sha" ]] || die 'manifest commit does not match the requested release SHA.'
[[ "${manifest[commit_sha]}" =~ ^[0-9a-f]{40}$ ]] || die 'manifest commit is not a full lowercase SHA.'
for key in frontend_image backend_image migrator_image valorant_image; do
  [[ "${manifest[$key]}" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die 'manifest contains a mutable or malformed registry image.'
done
[[ "${manifest[postgres_image]}" =~ ^postgres:17-bookworm@sha256:[0-9a-f]{64}$ ]] || die 'manifest PostgreSQL image is not an exact PostgreSQL 17 digest.'
[[ "${POSTGRES_IMAGE_APPROVED_REF}" == "${manifest[postgres_image]}" ]] || die 'approved PostgreSQL image does not match the manifest.'
[[ "${VALORANT_IMAGE_APPROVED_REF}" == "${manifest[valorant_image]}" ]] || die 'approved VALORANT image does not match the manifest.'
for key in frontend_image backend_image migrator_image; do
  case "$key" in
    frontend_image) approved=QUEST_FRONTEND_IMAGE_APPROVED_REF ;;
    backend_image) approved=QUEST_BACKEND_IMAGE_APPROVED_REF ;;
    migrator_image) approved=MIGRATOR_IMAGE_APPROVED_REF ;;
  esac
  require_setting "$approved"
  [[ "${!approved}" == "${manifest[$key]}" ]] || die 'approved image does not match the manifest.'
done

for setting in VALORANT_CA_FILE; do
  require_setting "$setting"
  root_file "${!setting}"
done
validate_compose_tls_material
validate_backup_tls_material
validate_valorant_runtime_compose
validate_postgres_target
validate_database_urls
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(stat -c '%u %a' "$RELEASE_LOCK_PATH" 2>/dev/null)" == '0 660' ]] || die 'canonical release lock ownership or mode is invalid.'
fi

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

"$DOCKER_BIN" info >/dev/null 2>&1 || die 'Docker daemon is unavailable.'
network_output="$("$DOCKER_BIN" network inspect quest-shared --format '{{range .Containers}}{{.Name}}|{{join .Aliases ","}}{{"\n"}}{{end}}' 2>/dev/null)" || die 'shared network is unavailable.'
declare -A seen_aliases=()
while IFS= read -r record; do
  [[ -z "$record" ]] && continue
  aliases="${record#*|}"
  [[ "$aliases" != "$record" ]] || die 'shared network alias output is ambiguous.'
  IFS=',' read -r -a alias_values <<< "$aliases"
  for alias in "${alias_values[@]}"; do
    [[ -z "$alias" ]] && continue
    [[ -z "${seen_aliases[$alias]+present}" ]] || die 'shared network aliases are not unique.'
    seen_aliases["$alias"]=1
  done
done <<< "$network_output"
if [[ "${REQUIRE_SHARED_ALIASES:-0}" == 1 ]]; then
  for alias in quest-backend quest-postgres valorant-platform valorant-updater valorant-discord-bot valorant-name-audit; do
    [[ -n "${seen_aliases[$alias]:-}" ]] || die 'required shared network alias is missing.'
  done
fi

for key in frontend_image backend_image migrator_image postgres_image valorant_image; do
  image="${manifest[$key]}"
  case "$key" in
    frontend_image|backend_image|migrator_image)
      cosign_identity="$QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP"
      cosign_issuer="$QUEST_COSIGN_OIDC_ISSUER"
      ;;
    valorant_image)
      cosign_identity="$VALORANT_COSIGN_CERTIFICATE_IDENTITY_REGEXP"
      cosign_issuer="$VALORANT_COSIGN_OIDC_ISSUER"
      ;;
    postgres_image)
      cosign_identity="$POSTGRES_COSIGN_CERTIFICATE_IDENTITY_REGEXP"
      cosign_issuer="$POSTGRES_COSIGN_OIDC_ISSUER"
      ;;
  esac
  "$COSIGN_BIN" verify \
    --certificate-identity-regexp "$cosign_identity" \
    --certificate-oidc-issuer "$cosign_issuer" "$image" >/dev/null 2>&1 \
    || die 'image signature verification failed.'
done

printf '%s\n' validated
