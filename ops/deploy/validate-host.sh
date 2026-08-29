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
  [[ -f "$1" && -r "$1" && ! -L "$1" ]] || die 'required host file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$(stat -c '%u' "$1" 2>/dev/null)" == 0 ]] || die 'required host file is not root-owned.'
  fi
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
  [[ "$POSTGRES_TARGET_SENTINEL_COMMAND" == /* && "$POSTGRES_TARGET_SENTINEL_COMMAND" != / && -x "$POSTGRES_TARGET_SENTINEL_COMMAND" && ! -L "$POSTGRES_TARGET_SENTINEL_COMMAND" ]] || die 'PostgreSQL target sentinel is missing or unsafe.'
  sentinel_output="$("$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" || die 'PostgreSQL target sentinel failed.'
  [[ "$sentinel_output" =~ ^target_kind=([a-z0-9_-]+)[[:space:]]+database=([a-z_][a-z0-9_]*)[[:space:]]+host=([^[:space:]]+)[[:space:]]+port=([0-9]+)[[:space:]]+major=([0-9]+)[[:space:]]+data_root=([^[:space:]]+)$ ]] || die 'PostgreSQL target sentinel output is ambiguous.'
  sentinel_kind="${BASH_REMATCH[1]}"; sentinel_database="${BASH_REMATCH[2]}"; sentinel_host="${BASH_REMATCH[3]}"; sentinel_port="${BASH_REMATCH[4]}"; sentinel_major="${BASH_REMATCH[5]}"; sentinel_data_root="${BASH_REMATCH[6]}"
  [[ "$sentinel_kind" == postgresql17 && "$sentinel_database" == "$POSTGRES_TARGET_DATABASE" && "$sentinel_host" == "$POSTGRES_TARGET_HOST" && "$sentinel_port" == "$POSTGRES_TARGET_PORT" && "$sentinel_major" == "$POSTGRES_TARGET_MAJOR" && "$sentinel_data_root" == "$POSTGRES_TARGET_DATA_ROOT" ]] || die 'PostgreSQL target sentinel does not identify the approved target.'
}

validate_database_urls() {
  local variable url authority path database
  for variable in DATABASE_URL DIRECT_URL; do
    url="${!variable:-}"
    [[ -z "$url" ]] && continue
    [[ "$url" != *[[:space:]]* && "$url" =~ ^postgres(ql)?://[^/]+/[^/?#]+([?#].*)?$ ]] || die "$variable is not a valid PostgreSQL target URL."
    authority="${url#*://}"
    path="${authority#*/}"
    database="${path%%[?#]*}"
    [[ "$database" == quest ]] || die "$variable must target the quest database."
  done
}

for setting in RELEASE_ROOT RELEASES_ROOT RELEASE_LOCK_PATH DOCKER_BIN COSIGN_BIN QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP QUEST_COSIGN_OIDC_ISSUER VALORANT_COSIGN_CERTIFICATE_IDENTITY_REGEXP VALORANT_COSIGN_OIDC_ISSUER POSTGRES_COSIGN_CERTIFICATE_IDENTITY_REGEXP POSTGRES_COSIGN_OIDC_ISSUER POSTGRES_IMAGE_APPROVED_REF VALORANT_IMAGE_APPROVED_REF SERVICE_OWNERSHIP_COMMAND; do
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

for setting in VALORANT_CA_FILE POSTGRES_CERT_FILE POSTGRES_KEY_FILE; do
  require_setting "$setting"
  root_file "${!setting}"
done
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
