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
[[ -e "$release_lock_path" ]] || die 'the canonical release lock must be created by root bootstrap before release.'
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release, migration, backup, or name-audit operation is already running.'

fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'release.sh must run as root.'
  lock_stat="$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" || die 'cannot inspect canonical lock ownership.'
  [[ "$lock_stat" == 0\ * ]] || die 'canonical release lock must be root-owned.'
fi

[[ $# -eq 2 ]] || die 'usage: release.sh FULL_COMMIT_SHA RELEASE_MANIFEST'
release_sha="$1"
manifest_path="$2"
[[ "$release_sha" =~ ^[0-9a-fA-F]{40}$ ]] || die 'the release SHA must be one exact full 40-character hexadecimal commit SHA.'
[[ -f "$manifest_path" && -r "$manifest_path" && ! -L "$manifest_path" ]] || die 'release manifest is missing, unreadable, or a symbolic link.'

release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing, unreadable, or a symbolic link.'
if [[ "$fixture_mode" != 1 ]]; then
  env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'cannot inspect release environment ownership.'
  [[ "$env_stat" == 0\ * ]] || die 'release environment must be root-owned.'
  env_mode="${env_stat##* }"
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment must be mode 0600 or 0640.'
fi
# shellcheck disable=SC1090
source "$release_env_file"

require_setting() { [[ -n "${!1:-}" ]] || die "missing release setting: $1"; }
absolute_nonroot() { [[ "$2" == /* && "$2" != / ]] || die "$1 must be an absolute non-root path."; }
command_setting() { require_setting "$1"; [[ -x "${!1}" ]] || die "release command is not executable: $1"; }
root_file() {
  [[ -f "$1" && -r "$1" && ! -L "$1" ]] || die "required file is missing or unsafe: $1"
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$(stat -c '%u' "$1" 2>/dev/null)" == 0 ]] || die "required file is not root-owned: $1"
  fi
}
root_file "$manifest_path"

require_setting RELEASE_ROOT
require_setting QUEST_COMPOSE_TEMPLATE
require_setting VALORANT_COMPOSE_SOURCE
require_setting DOCKER_BIN
absolute_nonroot RELEASE_ROOT "$RELEASE_ROOT"
absolute_nonroot RELEASE_LOCK_PATH "$release_lock_path"
root_file "$QUEST_COMPOSE_TEMPLATE"
root_file "$VALORANT_COMPOSE_SOURCE"
[[ -x "$DOCKER_BIN" ]] || die 'DOCKER_BIN is not executable.'

releases_root="${RELEASES_ROOT:-$RELEASE_ROOT/releases}"
current_link="${CURRENT_LINK:-$RELEASE_ROOT/current}"
absolute_nonroot RELEASES_ROOT "$releases_root"
absolute_nonroot CURRENT_LINK "$current_link"
mkdir -p "$releases_root"
[[ ! -L "$releases_root" ]] || die 'release root must not be a symbolic link.'

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
  [[ "${manifest[$manifest_key]}" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-fA-F]{64}$ ]] || die "$manifest_key must be an exact GHCR digest reference."
done
[[ "${manifest[postgres_image]}" =~ ^postgres:17-bookworm@sha256:[0-9a-fA-F]{64}$ ]] || die 'postgres_image must be the exact PostgreSQL 17 Bookworm digest.'

quest_project="quest-prod"
valorant_project="valorant-prod"
shared_network="quest-shared"
compose_env_file=""
stage_dir=""
previous_release=""
old_valorant_was_active=false
freeze_active=false
writer_admitted=false
commit_recorded=false
pointer_updated=false
old_units_stopped=false

compose() { "$DOCKER_BIN" compose "$@"; }
compose_common_args() { :; }

validate_project() {
  local compose_file="$1" project="$2" env_file="${3:-}" config_output active_output unique_active
  if [[ -n "$env_file" ]]; then
    config_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
    active_output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$project" ps --all --format '{{.Project}}' 2>/dev/null)" || die "could not inspect active Compose project $project."
  else
    config_output="$(compose -f "$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
    active_output="$(compose -f "$compose_file" --project-name "$project" ps --all --format '{{.Project}}' 2>/dev/null)" || die "could not inspect active Compose project $project."
  fi
  [[ "$(printf '%s\n' "$config_output" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project."
  unique_active="$(printf '%s\n' "$active_output" | awk 'NF { print }' | sort -u)"
  [[ "$unique_active" == "$project" ]] || die "active Compose projects for the service group are not exactly one $project project."
}

validate_images() {
  local compose_file="$1" env_file="$2" output image
  output="$(compose --env-file "$env_file" -f "$compose_file" --project-name "$quest_project" config --images 2>/dev/null)" || die 'could not render the staged Quest image set.'
  for image in "${manifest[frontend_image]}" "${manifest[backend_image]}" "${manifest[postgres_image]}"; do
    printf '%s\n' "$output" | grep -Fqx "$image" || die "staged Compose does not use exact digest $image."
  done
  while IFS= read -r image; do
    [[ -z "$image" || "$image" =~ @sha256:[0-9a-fA-F]{64}$ ]] || die 'staged Compose contains a mutable image reference.'
  done <<< "$output"
}

validate_aliases() {
  local alias_output alias record container alias_list item
  declare -A seen_aliases=()
  alias_output="$("$DOCKER_BIN" network inspect "$shared_network" --format '{{range .Containers}}{{.Name}}|{{join .Aliases ","}}{{"\n"}}{{end}}' 2>/dev/null)" || die "could not inspect external network $shared_network."
  [[ -n "$alias_output" ]] || die "external network $shared_network has no inspectable containers."
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    container="${record%%|*}"
    alias_list="${record#*|}"
    [[ -n "$container" && "$alias_list" != "$record" ]] || die 'shared-network alias inspection is ambiguous.'
    IFS=',' read -r -a aliases <<< "$alias_list"
    for alias in "${aliases[@]}"; do
      [[ -n "$alias" ]] || continue
      [[ -z "${seen_aliases[$alias]+seen}" ]] || die "duplicate shared-network alias: $alias"
      seen_aliases["$alias"]="$container"
    done
  done <<< "$alias_output"
  for alias in quest-backend quest-postgres valorant-platform valorant-updater valorant-discord-bot valorant-name-audit; do
    [[ -n "${seen_aliases[$alias]:-}" ]] || die "required shared-network alias is missing: $alias"
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
  local variable="$1" repository="$2" output
  command_setting "$variable"
  output="$(CHECK_REPOSITORY="$repository" RELEASE_SHA="$release_sha" "${!variable}" 2>/dev/null)" || die "$variable failed."
  case "$output" in
    none) return 0 ;;
    pending) return 1 ;;
    *) die "$variable returned an unexpected migration status." ;;
  esac
}

run_hook() {
  local variable="$1" output expected="${2:-}"
  command_setting "$variable"
  output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "${!variable}" 2>/dev/null)" || die "$variable failed."
  if [[ -n "$expected" ]]; then
    [[ "$output" == "$expected" ]] || die "$variable did not acknowledge $expected."
  fi
}

precommit_rollback() {
  local rollback_status=0
  set +e
  say 'pre-commit boundary: restoring the previous application release; Supabase remains authoritative.' >&2
  if [[ -n "$stage_dir" ]]; then
    compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name "$quest_project" down --remove-orphans >/dev/null 2>&1 || rollback_status=1
  fi
  if [[ -n "$previous_release" && -f "$previous_release/compose.production.yml" ]]; then
    compose --env-file "$previous_release/.env" -f "$previous_release/compose.production.yml" --project-name "$quest_project" up -d --no-build >/dev/null 2>&1 || rollback_status=1
  fi
  if [[ "$freeze_active" == true && -n "${FREEZE_DISABLE_COMMAND:-}" ]]; then
    run_hook FREEZE_DISABLE_COMMAND || rollback_status=1
  fi
  if [[ "$old_units_stopped" == true && "$old_valorant_was_active" == true && -n "${OLD_VALORANT_RESTART_COMMAND:-}" ]]; then
    if [[ -n "${OLD_DATABASE_AUTHORITATIVE_COMMAND:-}" ]]; then
      command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
      [[ "$OLD_DATABASE_AUTHORITATIVE_COMMAND" ]] && "$OLD_DATABASE_AUTHORITATIVE_COMMAND" >/dev/null 2>&1 || rollback_status=1
    fi
    run_hook OLD_VALORANT_RESTART_COMMAND || rollback_status=1
  fi
  if (( rollback_status != 0 )); then
    printf '%s\n' 'URGENT: pre-commit rollback was incomplete; do not redirect either service to stale Supabase manually.' >&2
  fi
  return "$rollback_status"
}

postcommit_boundary() {
  local capture_status=0
  set +e
  say 'post-commit boundary: stopping both writer groups and re-enabling coordinated freeze.' >&2
  [[ -z "${WRITER_STOP_COMMAND:-}" ]] || run_hook WRITER_STOP_COMMAND || capture_status=1
  [[ -z "${FREEZE_ENABLE_COMMAND:-}" ]] || run_hook FREEZE_ENABLE_COMMAND || capture_status=1
  if [[ -n "${CURRENT_STATE_CAPTURE_COMMAND:-}" ]]; then
    run_hook CURRENT_STATE_CAPTURE_COMMAND captured || capture_status=1
  else
    printf '%s\n' 'URGENT: no current PostgreSQL 17/uploads capture command was configured.' >&2
    capture_status=1
  fi
  printf '%s\n' 'Expected loss/RPO and incident-owner approval are required before fix-forward or controlled restore.' >&2
  return "$capture_status"
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if (( status != 0 )); then
    if [[ "$writer_admitted" == true || "$commit_recorded" == true ]]; then
      postcommit_boundary || status=1
    else
      precommit_rollback || status=1
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

check_disk
validate_project "$QUEST_COMPOSE_TEMPLATE" "$quest_project"
validate_project "$VALORANT_COMPOSE_SOURCE" "$valorant_project"
command_setting DATABASE_HEALTH_COMMAND
[[ "$(DATABASE_URL="${DATABASE_URL:-fixture://database}" "$DATABASE_HEALTH_COMMAND" 2>/dev/null)" == ready ]] || die 'PostgreSQL health check did not return ready.'
command_setting REGISTRY_CHECK_COMMAND
for image in "${manifest[frontend_image]}" "${manifest[backend_image]}" "${manifest[migrator_image]}" "${manifest[postgres_image]}" "${manifest[valorant_image]}"; do
  RELEASE_IMAGE="$image" "$REGISTRY_CHECK_COMMAND" >/dev/null 2>&1 || die "registry access or digest verification failed for $image."
done
command_setting BACKUP_FRESHNESS_COMMAND
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/9 "$BACKUP_FRESHNESS_COMMAND" >/dev/null 2>&1 || die 'verified multi-remote backup freshness check failed.'

if [[ -e "$current_link" || -L "$current_link" ]]; then
  previous_release="$(realpath "$current_link" 2>/dev/null || true)"
  [[ -n "$previous_release" && "$previous_release" == "$releases_root/"* && -d "$previous_release" ]] || die 'current release pointer is not an immutable release under RELEASES_ROOT.'
  root_file "$previous_release/compose.production.yml"
  root_file "$previous_release/.env"
else
  die 'an existing current release is required for a reversible deployment.'
fi

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
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$quest_project"
  printf 'RELEASE_COMMIT_SHA=%s\n' "$release_sha"
} > "$compose_env_file"
chmod 600 "$compose_env_file" "$stage_dir/compose.production.yml" "$stage_dir/valorant.compose.yml"
validate_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file"
validate_images "$stage_dir/compose.production.yml" "$compose_env_file"
validate_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file"
cat > "$stage_dir/release-metadata.txt" <<EOF
commit_sha=$release_sha
commit_point_utc=not-recorded
writer_admitted=false
current_pointer_updated=false
previous_release=$previous_release
quest_project=$quest_project
valorant_project=$valorant_project
shared_network=$shared_network
EOF
chmod 600 "$stage_dir/release-metadata.txt"

command_setting QUEST_MIGRATION_STATUS_COMMAND
command_setting VALORANT_MIGRATION_STATUS_COMMAND
run_migration_status QUEST_MIGRATION_STATUS_COMMAND quest || quest_migration_pending=true
run_migration_status VALORANT_MIGRATION_STATUS_COMMAND valorant || valorant_migration_pending=true
quest_migration_pending="${quest_migration_pending:-false}"
valorant_migration_pending="${valorant_migration_pending:-false}"

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
  [[ "$(BACKUP_RELEASE_SHA="$release_sha" "$BACKUP_EVIDENCE_COMMAND" 2>/dev/null)" == verified-complete ]] || die 'backup did not produce a remotely verified complete archive/checksum pair.'
fi

command_setting OLD_VALORANT_ACTIVE_CHECK
old_valorant_state="$("$OLD_VALORANT_ACTIVE_CHECK" 2>/dev/null)"
[[ "$old_valorant_state" == active || "$old_valorant_state" == inactive ]] || die 'old VALORANT unit state was ambiguous.'
[[ "$old_valorant_state" == active ]] && old_valorant_was_active=true
command_setting OLD_VALORANT_STOP_COMMAND
run_hook OLD_VALORANT_STOP_COMMAND
old_units_stopped=true

command_setting FREEZE_ENABLE_COMMAND
run_hook FREEZE_ENABLE_COMMAND validation
freeze_active=true
command_setting FREEZE_STATUS_COMMAND
[[ "$("$FREEZE_STATUS_COMMAND" 2>/dev/null)" == acknowledged ]] || die 'Quest/VALORANT coordinated freeze was not acknowledged.'

compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name "$quest_project" pull >/dev/null 2>&1 || die 'staged Quest image pull failed.'
compose --env-file "$compose_env_file" -f "$stage_dir/valorant.compose.yml" --project-name "$valorant_project" pull >/dev/null 2>&1 || die 'staged VALORANT image pull failed.'
compose --env-file "$compose_env_file" -f "$stage_dir/compose.production.yml" --project-name "$quest_project" up -d --no-build >/dev/null 2>&1 || die 'frozen Quest service start failed.'
compose --env-file "$compose_env_file" -f "$stage_dir/valorant.compose.yml" --project-name "$valorant_project" up -d --no-build >/dev/null 2>&1 || die 'frozen VALORANT service start failed.'

if [[ "$quest_migration_pending" == true ]]; then
  command_setting QUEST_MIGRATOR_COMMAND
  run_hook QUEST_MIGRATOR_COMMAND migrated
fi
if [[ "$valorant_migration_pending" == true ]]; then
  command_setting VALORANT_MIGRATOR_COMMAND
  run_hook VALORANT_MIGRATOR_COMMAND migrated
fi

command_setting CURL_BIN
command_setting DATABASE_READINESS_COMMAND
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE; do require_setting "$setting"; done
root_file "$VALORANT_CA_FILE"
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health gate failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health response was not healthy.'
quest_ready="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" 2>/dev/null)" || die 'Quest readiness gate failed.'
[[ "$quest_ready" =~ "ready" || "$quest_ready" =~ "status"[[:space:]]*:[[:space:]]*"ok" ]] || die 'Quest readiness response was not ready.'
valorant_health="$("$CURL_BIN" --fail --silent --show-error --cacert "$VALORANT_CA_FILE" --max-time 10 "$VALORANT_HEALTH_URL" 2>/dev/null)" || die 'VALORANT HTTPS health gate failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$valorant_health" && grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<< "$valorant_health" || die 'VALORANT HTTPS health did not return status ok and db up.'
[[ "$("$DATABASE_READINESS_COMMAND" 2>/dev/null)" == ready ]] || die 'PostgreSQL 17 database readiness gate failed.'
validate_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file"
validate_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file"
validate_aliases

command_setting QUEST_READINESS_ACK_COMMAND
command_setting VALORANT_READINESS_ACK_COMMAND
[[ "$("$QUEST_READINESS_ACK_COMMAND" 2>/dev/null)" == ready ]] || die 'Quest did not acknowledge frozen readiness.'
[[ "$("$VALORANT_READINESS_ACK_COMMAND" 2>/dev/null)" == ready ]] || die 'VALORANT did not acknowledge frozen readiness.'

command_setting WRITER_ENABLE_COMMAND
[[ "$(RELEASE_SHA="$release_sha" "$WRITER_ENABLE_COMMAND" 2>/dev/null)" == admitted ]] || die 'coordinated writer admission failed.'
writer_admitted=true
commit_recorded=true
commit_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cat > "$stage_dir/commit-point.txt" <<EOF
commit_point_utc=$commit_timestamp
commit_sha=$release_sha
writer_admitted=true
previous_release=$previous_release
quest_project=$quest_project
valorant_project=$valorant_project
shared_network=$shared_network
EOF
chmod 600 "$stage_dir/commit-point.txt"

command_setting OLD_VALORANT_MASK_COMMAND
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
EOF
chmod 600 "$stage_dir/release-metadata.txt"
say "Immutable Compose release admitted: $release_sha"
