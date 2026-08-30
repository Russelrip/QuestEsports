#!/usr/bin/env bash
set -euo pipefail
umask 077

# First production cutover only. Unlike release.sh this path starts from
# Supabase authority, freezes the existing writers, and owns the PostgreSQL 17
# restore boundary. It is deliberately not a general release shortcut.
die() { printf 'cutover refused: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
release_lock_path="${RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
[[ "$release_lock_path" == /* && "$release_lock_path" != / ]] || die 'release lock path is invalid.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$release_lock_path" == /var/lock/quest-esports-release.lock ]] || die 'the canonical release lock path cannot be overridden.'
fi
[[ -e "$release_lock_path" ]] || die 'the canonical release lock must be pre-created by host bootstrap.'
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release, migration, backup, or name-audit operation is already running.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'cutover.sh must run as root.'
  [[ "$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" == '0 660' ]] || die 'canonical release lock ownership or mode is invalid.'
fi

[[ $# -eq 2 ]] || die 'usage: cutover.sh FULL_COMMIT_SHA RELEASE_MANIFEST'
release_sha="$1"
manifest_path="$2"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'cutover requires one lowercase full commit SHA.'
release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ "$release_env_file" == /* && "$release_env_file" != / && -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'cannot inspect release environment ownership and mode.'
env_mode="${env_stat##* }"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'cutover.sh must run as root.'
  [[ "$env_stat" == 0\ * ]] || die 'release environment is not root-owned.'
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment mode is unsafe.'
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] || die 'release environment path is not canonical.'
fi
# shellcheck disable=SC1090
source "$release_env_file"
quest_runtime_env_file="${QUEST_RUNTIME_ENV_FILE:-/etc/quest-esports/quest.production.env}"
valorant_runtime_env_file="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"
runtime_env_file="$quest_runtime_env_file"

require_setting() { [[ -n "${!1:-}" ]] || die 'required cutover setting is missing.'; }
command_setting() { require_setting "$1"; [[ -x "${!1}" ]] || die 'required cutover command is not executable.'; }
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
validate_release_environment
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL; do require_setting "$setting"; done
validate_endpoint_identities
root_file() {
  local file="$1" enforce_owner="${2:-0}"
  [[ -f "$file" && -r "$file" && ! -L "$file" ]] || die 'required cutover file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 || "$enforce_owner" == 1 ]]; then
    [[ "$(stat -c '%u' "$file" 2>/dev/null)" == 0 ]] || die 'required cutover file is not root-owned.'
  fi
}
protected_file() {
  root_file "$1"
  if [[ "$fixture_mode" != 1 ]]; then
    protected_mode="$(stat -c '%a' "$1" 2>/dev/null)" || die 'protected runtime file mode cannot be inspected.'
    [[ "$protected_mode" == 600 || "$protected_mode" == 640 ]] || die 'protected runtime file mode is unsafe.'
  fi
}
validate_compose_tls_material() {
  local ca_file cert_file key_file password_file key_mode tls_file tls_stat
  if [[ "$fixture_mode" == 1 ]]; then
    ca_file="${POSTGRES_COMPOSE_CA_FILE:-${POSTGRES_CERT_FILE:-}}"
    cert_file="${POSTGRES_COMPOSE_CERT_FILE:-${POSTGRES_CERT_FILE:-}}"
    key_file="${POSTGRES_COMPOSE_KEY_FILE:-${POSTGRES_KEY_FILE:-}}"
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
    [[ "$tls_stat" == '0:0 644' ]] || die 'canonical PostgreSQL certificate must be root-owned mode 0644.'
    tls_stat="$(stat -c '%u:%g %a' "$key_file" 2>/dev/null)" || die 'canonical PostgreSQL key ownership cannot be inspected.'
    [[ "$tls_stat" == '0:999 640' ]] || die 'canonical PostgreSQL key must be root-owned, group-readable by 999, mode 0640.'
    [[ -f "$password_file" && ! -L "$password_file" && "$(stat -c '%u:%g %a' "$password_file" 2>/dev/null)" == '0:999 640' ]] || die 'canonical PostgreSQL password file must be root-owned, group-readable by 999, mode 0640.'
  fi
}
validate_valorant_runtime_compose() {
  local compose_source="${VALORANT_COMPOSE_SOURCE:-}" contract="${VALORANT_RUNTIME_COMPOSE_CONTRACT:-}"
  [[ -n "$compose_source" && -f "$compose_source" && ! -L "$compose_source" ]] || die 'VALORANT Compose source is missing or unsafe.'
  [[ -n "$contract" && -f "$contract" && ! -L "$contract" ]] || die 'VALORANT runtime Compose contract is missing or unsafe.'
  for required in 'image: ${VALORANT_IMAGE:' 'env_file:' 'VALORANT_DATABASE_SSL_CA_FILE' 'VALORANT_DATABASE_SSL_SERVER_HOSTNAME' 'VALORANT_DATABASE_SSL_VERIFY' '/run/secrets/quest-private-ca.crt:ro' 'quest-shared'; do
    grep -F "$required" "$compose_source" >/dev/null || die 'VALORANT Compose source does not satisfy the asyncpg TLS runtime contract.'
  done
  grep -F 'sslmode=' "$compose_source" >/dev/null && die 'VALORANT Compose source contains libpq-only sslmode settings.' || true
  grep -F 'sslrootcert=' "$compose_source" >/dev/null && die 'VALORANT Compose source contains libpq-only sslrootcert settings.' || true
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
validate_database_urls() {
  local file="${1:-$runtime_env_file}" expected_authority="${2:-any}" label="${3:-Quest}"
  local line variable url expected_role expected_schema
  [[ "$file" == /* && "$file" != / && -f "$file" && -r "$file" && ! -L "$file" ]] || die "protected $label runtime environment is missing or unsafe."
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$(stat -c '%u' "$file" 2>/dev/null)" == 0 ]] || die "protected $label runtime environment is not root-owned."
    runtime_env_mode="$(stat -c '%a' "$file" 2>/dev/null)" || die "protected $label runtime environment mode cannot be inspected."
    [[ "$runtime_env_mode" == 600 || "$runtime_env_mode" == 640 ]] || die "protected $label runtime environment mode is unsafe."
    if [[ "$label" == Quest ]]; then
      [[ "$(realpath "$file" 2>/dev/null)" == /etc/quest-esports/quest.production.env ]] || die 'protected Quest runtime environment path is not canonical.'
    else
      [[ "$(realpath "$file" 2>/dev/null)" == /etc/quest-esports/valorant.production.env ]] || die 'protected VALORANT runtime environment path is not canonical.'
    fi
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
        [[ -z "${runtime_urls[$variable]+present}" && -n "$url" ]] || die 'protected Quest runtime environment contains a duplicate or empty database URL.'
        runtime_urls["$variable"]="$url"
        ;;
    esac
  done < "$file"
  expected_role=quest_runtime; expected_schema=public
  [[ "${label,,}" == valorant ]] && expected_role=val_runtime && expected_schema=valorant
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for runtime database URL validation.'
  if [[ "${label,,}" == valorant && "$expected_authority" == quest-postgres ]]; then
    grep -Fxq 'VALORANT_DATABASE_SSL_CA_FILE=/run/secrets/quest-private-ca.crt' "$file" || die 'VALORANT runtime environment must name the mounted asyncpg CA file.'
    grep -Fxq 'VALORANT_DATABASE_SSL_SERVER_HOSTNAME=quest-postgres' "$file" || die 'VALORANT runtime environment must name the asyncpg TLS server hostname.'
    grep -Fxq 'VALORANT_DATABASE_SSL_VERIFY=full' "$file" || die 'VALORANT runtime environment must require full asyncpg certificate verification.'
  fi
  for variable in DATABASE_URL DIRECT_URL; do
    url="${runtime_urls[$variable]:-}"
    [[ -n "$url" ]] || die "protected $label runtime environment is missing $variable."
    if ! python3 - "$url" "$expected_role" "$expected_schema" "$expected_authority" "$label" <<'PY'
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
if parsed.username is None or parsed.username == "" or parsed.password is None or parsed.password == "" or parsed.path != "/quest" or parsed.fragment:
    raise SystemExit(1)
if authority == "supabase":
    if parsed.hostname == "quest-postgres" or parsed.username != expected_role or query not in ({"schema": [expected_schema]}, {"schema": [expected_schema], "sslmode": ["verify-full"], "sslrootcert": ["/run/secrets/quest-private-ca.crt"]}, {"ssl": ["require"]}):
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
        not parsed.password or parsed.hostname not in ("quest-postgres", "127.0.0.1") or parsed.port != 5432 or
        parsed.path != "/quest" or parsed.query or parsed.fragment):
    raise SystemExit(1)
PY
}

for setting in RELEASE_ROOT RELEASES_ROOT QUEST_COMPOSE_TEMPLATE VALORANT_COMPOSE_SOURCE VALORANT_RUNTIME_COMPOSE_CONTRACT DOCKER_BIN CURRENT_SUPABASE_ENV_FILE VALIDATE_HOST_COMMAND CUTOVER_RESTORE_COMMAND POSTGRES_IMAGE_APPROVED_REF POSTGRES_CERT_FILE POSTGRES_KEY_FILE RECOVERY_ADMIN_URL_FILE; do
  require_setting "$setting"
done
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / && -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'release root is invalid.'
[[ "$RELEASES_ROOT" == /* && "$RELEASES_ROOT" != / && -d "$RELEASES_ROOT" && ! -L "$RELEASES_ROOT" ]] || die 'release storage root is invalid.'
[[ -x "$DOCKER_BIN" ]] || die 'Docker command is not executable.'
root_file "$manifest_path"
protected_file "$CURRENT_SUPABASE_ENV_FILE"
command_setting VALIDATE_HOST_COMMAND
[[ "$(RUNTIME_DATABASE_AUTHORITY=supabase RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" "$VALIDATE_HOST_COMMAND" 2>/dev/null)" == validated ]] || die 'host/artifact validation did not acknowledge the cutover manifest.'
require_setting SERVICE_OWNERSHIP_COMMAND
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
require_setting FIRST_CUTOVER_OWNER_APPROVAL_SHA
[[ "$FIRST_CUTOVER_OWNER_APPROVAL_SHA" == "$release_sha" ]] || die 'first-cutover owner approval is not bound to this SHA.'

command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
previous_database_authority="$("$OLD_DATABASE_AUTHORITATIVE_COMMAND" 2>/dev/null)"
[[ "$previous_database_authority" == supabase ]] || die 'cutover.sh is only valid while Supabase remains authoritative.'
previous_release=supabase

declare -A manifest=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die 'cutover manifest contains an ambiguous entry.'
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  case "$key" in
    commit_sha|frontend_image|backend_image|migrator_image|postgres_image|valorant_image) ;;
    *) die 'cutover manifest contains an unknown key.' ;;
  esac
  [[ -z "${manifest[$key]+present}" ]] || die 'cutover manifest contains a duplicate key.'
  manifest["$key"]="$value"
done < "$manifest_path"
for key in commit_sha frontend_image backend_image migrator_image postgres_image valorant_image; do
  [[ -n "${manifest[$key]:-}" ]] || die 'cutover manifest is incomplete.'
done
[[ "${manifest[commit_sha]:-}" == "$release_sha" ]] || die 'cutover manifest is not bound to the requested SHA.'
for key in frontend_image backend_image migrator_image valorant_image; do
  [[ "${manifest[$key]}" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die 'cutover manifest contains a mutable or malformed registry image.'
done
[[ "${manifest[postgres_image]}" =~ ^postgres:17-bookworm@sha256:[0-9a-f]{64}$ ]] || die 'cutover manifest PostgreSQL image is not an exact PostgreSQL 17 digest.'
[[ "${manifest[postgres_image]}" == "$POSTGRES_IMAGE_APPROVED_REF" ]] || die 'approved PostgreSQL image does not match the cutover manifest.'
root_file "$POSTGRES_CERT_FILE"
root_file "$POSTGRES_KEY_FILE"
root_file "$RECOVERY_ADMIN_URL_FILE"
validate_recovery_admin_url_file "$RECOVERY_ADMIN_URL_FILE"
validate_valorant_runtime_compose
validate_compose_tls_material
validate_postgres_target
validate_database_urls "$quest_runtime_env_file" supabase Quest
validate_database_urls "$valorant_runtime_env_file" supabase VALORANT

quest_project=quest-prod
valorant_project=valorant-prod
shared_network=quest-shared
stage_dir="$RELEASES_ROOT/$release_sha"
[[ ! -e "$stage_dir" && ! -L "$stage_dir" ]] || die 'cutover release directory already exists.'
mkdir -p "$stage_dir"
cp -- "$QUEST_COMPOSE_TEMPLATE" "$stage_dir/compose.production.yml"
cp -- "$VALORANT_COMPOSE_SOURCE" "$stage_dir/valorant.compose.yml"
compose_env_file="$stage_dir/.env"
{
  printf 'QUEST_FRONTEND_IMAGE=%s\n' "${manifest[frontend_image]}"
  printf 'QUEST_BACKEND_IMAGE=%s\n' "${manifest[backend_image]}"
  printf 'MIGRATOR_IMAGE=%s\n' "${manifest[migrator_image]}"
  printf 'POSTGRES_IMAGE=%s\n' "${manifest[postgres_image]}"
  printf 'VALORANT_IMAGE=%s\n' "${manifest[valorant_image]}"
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$quest_project"
  printf 'RELEASE_COMMIT_SHA=%s\n' "$release_sha"
} > "$compose_env_file"
chmod 600 "$compose_env_file"

freeze_active=false
writer_admitted=false
commit_recorded=false
url_switch_started=false
quest_url_switched=false
valorant_url_switched=false
old_units_stopped=false
old_valorant_was_active=false
old_quest_stopped=false
old_valorant_stop_attempted=false
old_quest_stop_attempted=false
old_quest_was_active=false
postcommit_armed=false
writer_admission_started=false

compose() { "$DOCKER_BIN" compose "$@"; }

validate_project() {
  local compose_file="$1" project="$2" env_file="$3" config_output
  config_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
  [[ "$(printf '%s\n' "$config_output" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project."
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

validate_active_project() {
  local compose_file="$1" project="$2" env_file="$3" active_output record service state image record_project
  shift 3
  local expected_count=$#
  declare -A expected_images=() seen_services=()
  for record in "$@"; do
    service="${record%%=*}"
    image="${record#*=}"
    [[ -n "$service" && "$image" != "$record" ]] || die "active Compose topology expectation is invalid for $project."
    expected_images["$service"]="$image"
  done
  active_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" ps --all --format '{{json .}}' 2>/dev/null)" || die "could not inspect active Compose project $project."
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

run_hook() {
  local variable="$1" expected="${2:-}" output
  command_setting "$variable"
  output="$(TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" RELEASE_DIR="$stage_dir" POSTGRES_IMAGE="${manifest[postgres_image]:-}" RECOVERY_ADMIN_URL_FILE="${RECOVERY_ADMIN_URL_FILE:-}" CURRENT_SUPABASE_ENV_FILE="$CURRENT_SUPABASE_ENV_FILE" CURRENT_RUNTIME_ENV_FILE="$quest_runtime_env_file" QUEST_RUNTIME_ENV_FILE="$quest_runtime_env_file" VALORANT_RUNTIME_ENV_FILE="$valorant_runtime_env_file" "${!variable}" 2>/dev/null)" || die "$variable command failed."
  if [[ -n "$expected" ]]; then [[ "$output" == "$expected" ]] || die "$variable command acknowledgement was invalid."; fi
}
run_url_switch() {
  local variable="$1" group="$2" output expected runtime_file
  command_setting "$variable"
  if [[ "$group" == quest ]]; then runtime_file="$quest_runtime_env_file"; else runtime_file="$valorant_runtime_env_file"; fi
  validate_database_urls "$runtime_file" supabase "$group"
  url_switch_started=true
  output="$(DATABASE_URL_SWITCH_GROUP="$group" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" RELEASE_DIR="$stage_dir" CURRENT_SUPABASE_ENV_FILE="$CURRENT_SUPABASE_ENV_FILE" CURRENT_RUNTIME_ENV_FILE="$runtime_file" QUEST_RUNTIME_ENV_FILE="$quest_runtime_env_file" VALORANT_RUNTIME_ENV_FILE="$valorant_runtime_env_file" "${!variable}" 2>/dev/null)" || die "$variable command failed."
  expected="switched target=quest-postgres writer_group=$group"
  [[ "$output" == "$expected" ]] || die "$variable command acknowledgement was invalid."
}
run_url_effective_check() {
  local variable="$1" group="$2" output runtime_file
  command_setting "$variable"
  if [[ "$group" == quest ]]; then runtime_file="$quest_runtime_env_file"; else runtime_file="$valorant_runtime_env_file"; fi
  output="$(DATABASE_URL_SWITCH_GROUP="$group" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres CURRENT_RUNTIME_ENV_FILE="$runtime_file" QUEST_RUNTIME_ENV_FILE="$quest_runtime_env_file" VALORANT_RUNTIME_ENV_FILE="$valorant_runtime_env_file" "${!variable}" 2>/dev/null)" || die "$variable command failed."
  validate_database_urls "$runtime_file" quest-postgres "$group"
  [[ "$output" == "url-state group=$group host=quest-postgres database=quest authority=quest-postgres" ]] || die "$variable returned an invalid post-switch URL state."
}
run_service_restart() {
  local variable="$1" group="$2" project="$3" output expected
  command_setting "$variable"
  output="$(SERVICE_RESTART_GROUP="$group" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "${!variable}" 2>/dev/null)" || die "$variable command failed."
  expected="restarted target=quest-postgres project=$project writer_group=$group"
  [[ "$output" == "$expected" ]] || die "$variable command acknowledgement was invalid."
}
run_migrator() {
  # The migrator acknowledgement is `migrated image=<digest> target=quest-postgres`.
  local variable="$1" repository="$2" target_authority="$3" schema="$4" output expected url_file_setting admin_stat
  command_setting "$variable"
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
  output="$(MIGRATION_REPOSITORY="$repository" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" MIGRATOR_IMAGE="${manifest[migrator_image]}" EXPECTED_MIGRATOR_IMAGE="${manifest[migrator_image]}" MIGRATOR_DATABASE_URL_FILE="${!url_file_setting}" DIRECT_URL_FILE="${!url_file_setting}" "${!variable}" 2>/dev/null)" || die 'migration command failed.'
  expected="migrated image=${manifest[migrator_image]} target=quest-postgres schema=$schema repository=$repository"
  [[ "$output" == "$expected" ]] || die 'migration command did not acknowledge the exact migrator image, target, schema, and repository.'
}
run_migration_status() {
  # Accepted acknowledgements are `pending target=quest-postgres` and `none target=quest-postgres`.
  local variable="$1" repository="$2" target_authority="$3" schema="$4" output
  command_setting "$variable"
  [[ "$target_authority" == quest-postgres ]] || die 'migration target authority is not the fixed Quest PostgreSQL target.'
  [[ "$schema" == public || "$schema" == valorant ]] || die 'migration schema is not an approved service schema.'
  output="$(CHECK_REPOSITORY="$repository" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" "${!variable}" 2>/dev/null)" || die "$variable failed."
  [[ "$output" =~ ^(none|pending)[[:space:]]+target=quest-postgres[[:space:]]+schema=$schema[[:space:]]+repository=$repository$ ]] || die "$variable returned an ambiguous target/schema/status acknowledgement."
  [[ "$output" == none* ]] && return 0
  return 1
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
  local output="$1" units="$2" expected_state="$3" label="$4" line unit state
  declare -A seen=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" =~ ^unit=([A-Za-z0-9_.@-]+)[[:space:]]+state=(active|inactive)[[:space:]]+observed_at=([0-9]{8}T[0-9]{6}Z)$ ]] || die "$label returned an untrusted state observation."
    unit="${BASH_REMATCH[1]}"; state="${BASH_REMATCH[2]}"
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
  local output="$1" units="$2" label="$3" line unit
  declare -A seen=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" =~ ^unit=([A-Za-z0-9_.@-]+)[[:space:]]+state=inactive[[:space:]]+reboot_persistent=true[[:space:]]+observed_at=([0-9]{8}T[0-9]{6}Z)$ ]] || die "$label returned invalid reboot-persistence evidence."
    unit="${BASH_REMATCH[1]}"
    [[ ",$units," == *,"$unit",* ]] || die "$label reported an unexpected unit."
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
    printf 'cutover_type=first-supabase-cutover\n'
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
    printf 'cutover_type=first-supabase-cutover\n'
    printf 'quest_project=%s\nvalorant_project=%s\nshared_network=%s\n' "$quest_project" "$valorant_project" "$shared_network"
  } > "$temporary_file" 2>/dev/null || return 1
  chmod 600 "$temporary_file" 2>/dev/null || return 1
  mv -Tf -- "$temporary_file" "$stage_dir/writer-admission-state.txt" 2>/dev/null || return 1
}

write_release_metadata() {
  local point_utc="$1" admitted="$2" pointer_updated="$3" temporary_file
  temporary_file="$stage_dir/.release-metadata.$$.tmp"
  {
    printf 'commit_sha=%s\n' "$release_sha"
    printf 'commit_point_utc=%s\n' "$point_utc"
    printf 'writer_admitted=%s\n' "$admitted"
    printf 'current_pointer_updated=%s\n' "$pointer_updated"
    printf 'previous_release=%s\n' "$previous_release"
    printf 'quest_project=%s\n' "$quest_project"
    printf 'valorant_project=%s\n' "$valorant_project"
    printf 'shared_network=%s\n' "$shared_network"
    printf 'database_schemas=public,valorant\n'
    printf 'writer_groups=quest,valorant\n'
    printf 'owner_approval_sha=%s\n' "$FIRST_CUTOVER_OWNER_APPROVAL_SHA"
    printf 'cutover_type=first-supabase-cutover\n'
  } > "$temporary_file" 2>/dev/null || return 1
  chmod 600 "$temporary_file" 2>/dev/null || return 1
  mv -Tf -- "$temporary_file" "$stage_dir/release-metadata.txt" 2>/dev/null || return 1
}

precommit_rollback() {
  local status=0
  set +e
  printf '%s\n' 'pre-commit cutover failure: preserving Supabase authority and restoring prior writers.' >&2
  recovery_hook() {
    local variable="$1" expected="${2:-}" command output rc
    command="${!variable:-}"
    if [[ -z "$command" || ! -x "$command" ]]; then
      printf 'URGENT: pre-commit recovery hook %s is missing or not executable.\n' "$variable" >&2
      return 1
    fi
    output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" CURRENT_SUPABASE_ENV_FILE="$CURRENT_SUPABASE_ENV_FILE" CURRENT_RUNTIME_ENV_FILE="$quest_runtime_env_file" QUEST_RUNTIME_ENV_FILE="$quest_runtime_env_file" VALORANT_RUNTIME_ENV_FILE="$valorant_runtime_env_file" "$command" 2>/dev/null)"; rc=$?
    if (( rc != 0 )) || [[ -n "$expected" && "$output" != "$expected" ]]; then
      printf 'URGENT: pre-commit recovery hook %s failed or returned an invalid acknowledgement.\n' "$variable" >&2
      return 1
    fi
    return 0
  }
  if [[ -n "${CUTOVER_ABORT_COMMAND:-}" ]]; then
    recovery_hook CUTOVER_ABORT_COMMAND || status=1
  fi
  if [[ "$url_switch_started" == true ]]; then
    if [[ -z "${CUTOVER_SUPABASE_URL_RESTORE_COMMAND:-}" ]]; then
      printf '%s\n' 'URGENT: database URL switching started but no pre-commit Supabase URL restore contract is configured.' >&2
      status=1
    else
      recovery_hook CUTOVER_SUPABASE_URL_RESTORE_COMMAND restored || status=1
    fi
  fi
  if [[ -f "$stage_dir/compose.production.yml" && -f "$stage_dir/valorant.compose.yml" ]]; then
    compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name quest-prod down --remove-orphans >/dev/null 2>&1 || status=1
    compose --env-file "$compose_env_file" -f "$stage_dir/valorant.compose.yml" --project-name valorant-prod down --remove-orphans >/dev/null 2>&1 || status=1
  fi
  if [[ -n "${PREVIOUS_RELEASE_DIR:-}" && -f "$PREVIOUS_RELEASE_DIR/compose.production.yml" && -f "$PREVIOUS_RELEASE_DIR/valorant.compose.yml" && -f "$PREVIOUS_RELEASE_DIR/.env" ]]; then
    compose --env-file "$PREVIOUS_RELEASE_DIR/.env" -f "$PREVIOUS_RELEASE_DIR/compose.production.yml" --project-name quest-prod up -d --no-build >/dev/null 2>&1 || status=1
    compose --env-file "$PREVIOUS_RELEASE_DIR/.env" -f "$PREVIOUS_RELEASE_DIR/valorant.compose.yml" --project-name valorant-prod up -d --no-build >/dev/null 2>&1 || status=1
  fi
  if [[ "$old_valorant_stop_attempted" == true && "$old_valorant_was_active" == true && -n "${OLD_VALORANT_RESTART_COMMAND:-}" ]]; then
    if [[ -n "${OLD_VALORANT_UNMASKED_CHECK:-}" ]]; then recovery_hook OLD_VALORANT_UNMASKED_CHECK unmasked || status=1; fi
    recovery_hook OLD_VALORANT_RESTART_COMMAND || status=1
  fi
  if [[ "$old_quest_stop_attempted" == true && "$old_quest_was_active" == true ]]; then
    restart_command="${OLD_QUEST_RESTART_COMMAND:-${OLD_APPLICATION_RESTART_COMMAND:-}}"
    if [[ -z "$restart_command" || ! -x "$restart_command" ]]; then
      printf '%s\n' 'URGENT: old Quest/PM2 was partially stopped but no restart contract is configured.' >&2
      status=1
    else
      output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$restart_command" 2>/dev/null)"; restart_rc=$?
      (( restart_rc == 0 )) || status=1
      [[ "$output" == restarted ]] || status=1
    fi
  fi
  if [[ "$freeze_active" == true ]]; then
    for freeze_disable in QUEST_FREEZE_DISABLE_COMMAND VALORANT_FREEZE_DISABLE_COMMAND; do
      recovery_hook "$freeze_disable" || status=1
    done
  fi
  (( status == 0 )) || printf '%s\n' 'URGENT: pre-commit cutover rollback was incomplete.' >&2
  return "$status"
}
postcommit_boundary() {
  local status=0 writer_stop hook hook_rc output
  set +e
  printf '%s\n' 'post-commit cutover failure: stopping writers and capturing current PostgreSQL 17/uploads state.' >&2
  for writer_stop in QUEST_WRITER_STOP_COMMAND VALORANT_WRITER_STOP_COMMAND; do
    hook="${!writer_stop:-}"
    if [[ -z "$hook" || ! -x "$hook" ]]; then
      printf 'URGENT: post-commit hook %s is missing or not executable.\n' "$writer_stop" >&2
      status=1
      continue
    fi
    output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$hook" 2>/dev/null)"
    hook_rc=$?
    if (( hook_rc != 0 )) || [[ "$output" != stopped ]]; then
      printf 'URGENT: post-commit hook %s failed or did not acknowledge stopped.\n' "$writer_stop" >&2
      status=1
    fi
  done
  for freeze_enable in QUEST_FREEZE_ENABLE_COMMAND VALORANT_FREEZE_ENABLE_COMMAND; do
    hook="${!freeze_enable:-}"
    if [[ -z "$hook" || ! -x "$hook" ]]; then
      printf 'URGENT: post-commit freeze-enable hook %s is missing or not executable.\n' "$freeze_enable" >&2
      status=1
    else
      output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$hook" 2>/dev/null)"
      hook_rc=$?
      (( hook_rc == 0 )) || { printf 'URGENT: post-commit freeze-enable hook %s failed.\n' "$freeze_enable" >&2; status=1; }
    fi
  done
  if [[ -n "${CURRENT_STATE_CAPTURE_COMMAND:-}" ]]; then
    hook="$CURRENT_STATE_CAPTURE_COMMAND"
    if [[ ! -x "$hook" ]]; then
      printf '%s\n' 'URGENT: post-commit current-state capture hook is not executable.' >&2
      status=1
    else
      output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$hook" 2>/dev/null)"
      hook_rc=$?
      [[ "$output" == "captured evidence_bundle=$stage_dir" ]] || { printf '%s\n' 'URGENT: post-commit current-state capture did not identify the immutable evidence bundle.' >&2; status=1; }
      (( hook_rc == 0 )) || status=1
    fi
  else
    printf '%s\n' 'URGENT: no current PostgreSQL 17/uploads capture command was configured.' >&2
    status=1
  fi
  if [[ -n "${SUPABASE_URL_ROLLBACK_COMMAND:-}" ]]; then
    printf '%s\n' 'URGENT: blind Supabase URL rollback is prohibited after the first VPS write.' >&2
    status=1
  fi
  if [[ "${SUPABASE_RECONCILIATION_DECISION:-}" != fix-forward && "${SUPABASE_RECONCILIATION_DECISION:-}" != controlled-restore ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires an explicit reconciliation/data-loss decision.' >&2
    status=1
  fi
  if [[ -z "${EXPECTED_LOSS_RPO:-}" ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires an explicit expected-loss/RPO record.' >&2
    status=1
  fi
  if [[ "${INCIDENT_OWNER_APPROVAL:-}" != INCIDENT_OWNER_APPROVAL ]]; then
    printf '%s\n' 'URGENT: post-commit recovery requires incident-owner approval.' >&2
    status=1
  fi
  RECOVERY_ACTION_SELECTED=not-selected
  if [[ -z "${RECOVERY_ACTION_COMMAND:-}" || ! -x "$RECOVERY_ACTION_COMMAND" ]]; then
    printf '%s\n' 'URGENT: recovery action command is missing or not executable.' >&2
    status=1
  elif (( status == 0 )); then
    RECOVERY_ACTION_SELECTED="$($RECOVERY_ACTION_COMMAND 2>/dev/null)"; action_rc=$?
    if (( action_rc != 0 )) || [[ "$RECOVERY_ACTION_SELECTED" != "$SUPABASE_RECONCILIATION_DECISION" ]]; then
      printf '%s\n' 'URGENT: recovery action did not match the explicit reconciliation decision.' >&2
      status=1
    fi
  fi
  return "$status"
}
record_recovery_evidence() {
  local boundary="$1" result="$2" original_status="${3:-not-recorded}" recovery_status="${4:-not-recorded}"
  [[ -n "${stage_dir:-}" && -d "$stage_dir" ]] || return 0
  {
    printf 'boundary=%s\n' "$boundary"
    printf 'result=%s\n' "$result"
    printf 'deployment_exit_status=%s\n' "$original_status"
    printf 'recovery_exit_status=%s\n' "$recovery_status"
    printf 'release_sha=%s\n' "$release_sha"
    printf 'legacy_restart_allowed=%s\n' "$([[ "$boundary" == pre-commit-rollback ]] && printf true || printf false)"
    printf 'writer_admitted=%s\n' "$writer_admitted"
    printf 'url_switch_started=%s\n' "$url_switch_started"
    printf 'quest_url_switched=%s\n' "$quest_url_switched"
    printf 'valorant_url_switched=%s\n' "$valorant_url_switched"
    printf 'supabase_authority_boundary=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf stale-after-first-vps-write || printf preserved-before-first-vps-write)"
    printf 'supabase_url_rollback=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf prohibited || printf allowed-before-writer-admission)"
    printf 'reconciliation_decision=%s\n' "${SUPABASE_RECONCILIATION_DECISION:-not-recorded}"
    printf 'selected_recovery_action=%s\n' "${RECOVERY_ACTION_SELECTED:-not-selected}"
    printf 'expected_loss_rpo=%s\n' "${EXPECTED_LOSS_RPO:-not-recorded}"
    printf 'incident_owner_approval=%s\n' "${INCIDENT_OWNER_APPROVAL:-not-recorded}"
    printf 'supabase_url_rollback_command=%s\n' "$([[ -n "${SUPABASE_URL_ROLLBACK_COMMAND:-}" ]] && printf rejected || printf not-configured)"
  } > "$stage_dir/recovery-evidence.txt" 2>/dev/null || return 1
  chmod 600 "$stage_dir/recovery-evidence.txt" 2>/dev/null || return 1
}
on_exit() {
  local status=$? original_status recovery_status
  original_status="$status"
  trap - EXIT
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

validate_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file"
validate_images "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file" \
  "${manifest[frontend_image]}" "${manifest[backend_image]}" "${manifest[postgres_image]}"
validate_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file"
validate_images "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file" "${manifest[valorant_image]}"

# Freeze and stop old writers before the final archive. Nothing below this
# point can make the old source authoritative again after writer admission.
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
old_state="$("$OLD_VALORANT_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_state" "$OLD_VALORANT_UNITS" any 'old VALORANT state check'
grep -Eq 'state=active([[:space:]]|$)' <<< "$old_state" && old_valorant_was_active=true
old_valorant_stop_attempted=true
run_hook OLD_VALORANT_STOP_COMMAND
old_units_stopped=true
old_state="$("$OLD_VALORANT_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_state" "$OLD_VALORANT_UNITS" inactive 'old VALORANT post-stop state check'
command_setting OLD_QUEST_ACTIVE_CHECK
require_setting OLD_QUEST_UNITS
[[ "$OLD_QUEST_UNITS" == quest-pm2 ]] || die 'old Quest/PM2 unit identity is not the fixed transition unit.'
old_quest_state="$("$OLD_QUEST_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_quest_state" "$OLD_QUEST_UNITS" any 'old Quest/PM2 state check'
grep -Eq 'state=active([[:space:]]|$)' <<< "$old_quest_state" && old_quest_was_active=true
old_quest_stop_attempted=true
command_setting OLD_QUEST_STOP_COMMAND
run_hook OLD_QUEST_STOP_COMMAND
old_quest_stopped=true
old_quest_state="$("$OLD_QUEST_ACTIVE_CHECK" 2>/dev/null)"
validate_legacy_states "$old_quest_state" "$OLD_QUEST_UNITS" inactive 'old Quest/PM2 post-stop state check'

command_setting OLD_VALORANT_REBOOT_PERSISTENCE_CHECK
validate_reboot_persistence "$("$OLD_VALORANT_REBOOT_PERSISTENCE_CHECK" 2>/dev/null)" "$OLD_VALORANT_UNITS" 'old VALORANT reboot-persistence check'
command_setting OLD_QUEST_REBOOT_PERSISTENCE_CHECK
validate_reboot_persistence "$("$OLD_QUEST_REBOOT_PERSISTENCE_CHECK" 2>/dev/null)" "$OLD_QUEST_UNITS" 'old Quest/PM2 reboot-persistence check'

command_setting BACKUP_COMMAND
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/9 "$BACKUP_COMMAND" >/dev/null 2>&1 || die 'final archive creation failed.'
command_setting BACKUP_EVIDENCE_COMMAND
backup_evidence="$(BACKUP_RELEASE_SHA="$release_sha" "$BACKUP_EVIDENCE_COMMAND" 2>/dev/null)" || die 'final archive evidence failed.'
[[ "$backup_evidence" =~ ^verified-complete\ release_sha=${release_sha}\ schemas=verified:public,valorant\ uploads=verified:public,private\ archive=verified\ checksum=verified\ remote=verified$ ]] || die 'final archive evidence was incomplete.'

# Restore and migrate before candidate startup. The candidate cannot observe a
# half-restored database and no writer is enabled while validation runs.
run_hook CUTOVER_RESTORE_COMMAND restored
quest_status=none
valorant_status=none
run_migration_status QUEST_MIGRATION_STATUS_COMMAND quest quest-postgres public || quest_status=pending
run_migration_status VALORANT_MIGRATION_STATUS_COMMAND valorant quest-postgres valorant || valorant_status=pending
if [[ "$quest_status" == pending || "$valorant_status" == pending ]]; then
  [[ "${BACKUP_APPROVAL:-}" == BACKUP_QUEST_PRODUCTION ]] || die 'cutover migration requires explicit backup approval.'
  [[ "$quest_status" != pending || "${QUEST_MIGRATION_OWNER_APPROVAL_SHA:-}" == "$release_sha" ]] || die 'Quest migration approval is not bound to this SHA.'
  [[ "$valorant_status" != pending || "${VALORANT_MIGRATION_OWNER_APPROVAL_SHA:-}" == "$release_sha" ]] || die 'VALORANT migration approval is not bound to this SHA.'
  [[ "$quest_status" != pending ]] || run_migrator QUEST_MIGRATOR_COMMAND quest quest-postgres public
  [[ "$valorant_status" != pending ]] || run_migrator VALORANT_MIGRATOR_COMMAND valorant quest-postgres valorant
  run_migration_status QUEST_MIGRATION_STATUS_COMMAND quest quest-postgres public || die 'Quest migrations remain pending after the cutover migrator.'
  run_migration_status VALORANT_MIGRATION_STATUS_COMMAND valorant quest-postgres valorant || die 'VALORANT migrations remain pending after the cutover migrator.'
fi
run_security_verify
run_database_readiness
validate_compose_tls_material
validate_postgres_target
validate_database_urls "$quest_runtime_env_file" supabase Quest
validate_database_urls "$valorant_runtime_env_file" supabase VALORANT

require_setting CANDIDATE_FREEZE_FLAG
require_setting CANDIDATE_READ_ONLY_FLAG
run_candidate_start() {
  local variable="$1" group="$2" project="$3" output
  command_setting "$variable"
  output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" COMPOSE_ENV_FILE="$compose_env_file" \
    QUEST_COMPOSE_FILE="$stage_dir/compose.production.yml" VALORANT_COMPOSE_FILE="$stage_dir/valorant.compose.yml" \
    CANDIDATE_GROUP="$group" CANDIDATE_PROJECT="$project" WRITE_FREEZE_MODE=validation CANDIDATE_READ_ONLY=1 \
    "${!variable}" --contract frozen-read-only --freeze-flag "$CANDIDATE_FREEZE_FLAG" --read-only-flag "$CANDIDATE_READ_ONLY_FLAG" 2>/dev/null)" \
    || die "$variable command failed."
  [[ "$output" == "started-frozen-read-only group=$group" ]] || die "$variable acknowledgement was invalid."
}
run_candidate_start QUEST_CANDIDATE_FROZEN_START_COMMAND quest quest-prod
run_candidate_start VALORANT_CANDIDATE_FROZEN_START_COMMAND valorant valorant-prod
run_hook QUEST_FROZEN_READ_ONLY_ACK_COMMAND frozen-read-only
run_hook VALORANT_FROZEN_READ_ONLY_ACK_COMMAND frozen-read-only
command_setting CURL_BIN
command_setting VALORANT_CONTAINER_HEALTH_COMMAND
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE; do require_setting "$setting"; done
validate_endpoint_identities
root_file "$VALORANT_CA_FILE"
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health was not healthy.'
quest_ready="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" 2>/dev/null)" || die 'Quest readiness failed.'
verify_quest_readiness_response "$quest_ready"
valorant_health="$(VALORANT_HEALTH_URL="$VALORANT_HEALTH_URL" VALORANT_CA_FILE="$VALORANT_CA_FILE" "$VALORANT_CONTAINER_HEALTH_COMMAND" 2>/dev/null)" || die 'VALORANT HTTPS health failed from the Quest network boundary.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$valorant_health" && grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<< "$valorant_health" || die 'VALORANT health was not status ok/db up.'
validate_active_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file" \
  "frontend=${manifest[frontend_image]}" "backend=${manifest[backend_image]}" "postgres=${manifest[postgres_image]}"
validate_active_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file" \
  "valorant-platform=${manifest[valorant_image]}"
validate_aliases

# The candidates have only been proven frozen/read-only so far. The authority
# switch is two explicit writer-group operations, followed by two explicit
# service restarts. No writer can be admitted while either URL or service is
# still on the pre-switch state.
for setting in QUEST_DATABASE_URL_SWITCH_COMMAND VALORANT_DATABASE_URL_SWITCH_COMMAND QUEST_SERVICE_RESTART_COMMAND VALORANT_SERVICE_RESTART_COMMAND QUEST_READINESS_ACK_COMMAND VALORANT_READINESS_ACK_COMMAND; do
  command_setting "$setting"
done
run_url_switch QUEST_DATABASE_URL_SWITCH_COMMAND quest
quest_url_switched=true
run_url_effective_check QUEST_DATABASE_URL_EFFECTIVE_COMMAND quest
run_url_switch VALORANT_DATABASE_URL_SWITCH_COMMAND valorant
valorant_url_switched=true
run_url_effective_check VALORANT_DATABASE_URL_EFFECTIVE_COMMAND valorant
validate_database_urls "$quest_runtime_env_file" quest-postgres Quest
validate_database_urls "$valorant_runtime_env_file" quest-postgres VALORANT
run_service_restart QUEST_SERVICE_RESTART_COMMAND quest quest-prod
run_service_restart VALORANT_SERVICE_RESTART_COMMAND valorant valorant-prod
validate_postgres_target
run_database_readiness
run_hook QUEST_READINESS_ACK_COMMAND ready
run_hook VALORANT_READINESS_ACK_COMMAND ready

command_setting POST_COMMIT_RECOVERY_ARM_COMMAND
write_release_metadata not-recorded false false || die 'could not record provisional first-cutover metadata.'
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
command_setting OLD_QUEST_MASK_COMMAND
run_hook OLD_QUEST_MASK_COMMAND
command_setting OLD_VALORANT_MASK_COMMAND
run_hook OLD_VALORANT_MASK_COMMAND
temporary_current="$RELEASE_ROOT/.current.$release_sha.$$"
rm -f -- "$temporary_current"
ln -s -- "$stage_dir" "$temporary_current"
mv -Tf -- "$temporary_current" "${CURRENT_LINK:-$RELEASE_ROOT/current}"
write_release_metadata "$commit_timestamp" true true || die 'could not record final first-cutover metadata.'
say "First production cutover admitted: $release_sha"
