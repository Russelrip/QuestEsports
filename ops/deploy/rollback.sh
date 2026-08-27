#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'rollback refused: %s\n' "$*" >&2; exit 1; }

release_lock_path="${RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
[[ "$release_lock_path" == /* && "$release_lock_path" != / && -e "$release_lock_path" ]] || die 'the canonical release lock must be a pre-created absolute path.'
if [[ "${QUEST_DEPLOY_FIXTURE:-0}" != 1 ]]; then
  [[ "$release_lock_path" == /var/lock/quest-esports-release.lock ]] || die 'the canonical release lock path cannot be overridden.'
fi
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release, migration, backup, or name-audit operation is already running.'

fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'rollback.sh must run as root.'
  [[ "$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" == '0 660' ]] || die 'canonical release lock must be root-owned with mode 0660.'
fi

release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ "$release_env_file" == /* && "$release_env_file" != / ]] || die 'release environment must be an absolute non-root path.'
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
if [[ "$fixture_mode" != 1 ]]; then
  env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'cannot inspect release environment ownership.'
  [[ "$env_stat" == 0\ * ]] || die 'release environment must be root-owned.'
  env_mode="${env_stat##* }"
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment must be mode 0600 or 0640.'
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] || die 'release environment must use the canonical host path.'
fi
# shellcheck disable=SC1090
source "$release_env_file"
require_setting() { [[ -n "${!1:-}" ]] || die "missing release setting: $1"; }
command_setting() { require_setting "$1"; [[ -x "${!1}" ]] || die "release command is not executable: $1"; }
require_setting RELEASE_ROOT
require_setting DOCKER_BIN
releases_root="${RELEASES_ROOT:-$RELEASE_ROOT/releases}"
current_link="${CURRENT_LINK:-$RELEASE_ROOT/current}"
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / ]] || die 'RELEASE_ROOT must be absolute and non-root.'
[[ "$releases_root" == /* && "$releases_root" != / ]] || die 'RELEASES_ROOT must be absolute and non-root.'
[[ -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'RELEASE_ROOT must be an existing non-symlink directory.'
[[ -d "$releases_root" && ! -L "$releases_root" ]] || die 'RELEASES_ROOT must be an existing non-symlink directory.'
canonical_releases_root="$(realpath "$releases_root" 2>/dev/null)" || die 'RELEASES_ROOT cannot be canonicalized.'
[[ "$canonical_releases_root" == "$releases_root" ]] || die 'RELEASES_ROOT must not contain a symlink.'
[[ -x "$DOCKER_BIN" ]] || die 'DOCKER_BIN is not executable.'

mode="${1:-pre-commit}"
[[ "$mode" == pre-commit || "$mode" == post-commit ]] || die 'usage: rollback.sh pre-commit|post-commit'
compose() { "$DOCKER_BIN" compose "$@"; }

validate_project_config() {
  local bundle="$1" project="$2" output compose_file="compose.production.yml"
  [[ "$project" == valorant-prod ]] && compose_file="valorant.compose.yml"
  output="$(compose --env-file "$bundle/.env" -f "$bundle/$compose_file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project in $bundle."
  [[ "$(printf '%s\n' "$output" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project in $bundle."
}

validate_bundle_images() {
  local bundle="$1" require_migrator="${2:-false}" key value
  local -a image_keys=(QUEST_FRONTEND_IMAGE QUEST_BACKEND_IMAGE POSTGRES_IMAGE VALORANT_IMAGE)
  [[ "$require_migrator" == true ]] && image_keys+=(MIGRATOR_IMAGE)
  for key in "${image_keys[@]}"; do
    value="$(awk -F= -v k="$key" '$1 == k { print substr($0, index($0,"=")+1); found=1 } END { if (!found) exit 1 }' "$bundle/.env")" || die "$bundle/.env is missing $key."
    case "$key" in
      POSTGRES_IMAGE) [[ "$value" =~ ^postgres:17-bookworm@sha256:[0-9a-fA-F]{64}$ ]] || die "$bundle/.env has an unsafe PostgreSQL image." ;;
      *) [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-fA-F]{64}$ ]] || die "$bundle/.env has an unsafe $key." ;;
    esac
  done
}

safe_bundle() {
  local bundle="$1" label="$2" resolved stat mode file
  [[ "$bundle" == "$canonical_releases_root/"[0-9a-fA-F][0-9a-fA-F]* ]] || die "$label must be a canonical release directory."
  resolved="$(realpath "$bundle" 2>/dev/null)" || die "$label cannot be canonicalized."
  [[ "$resolved" == "$bundle" && "$resolved" == "$canonical_releases_root/"* && ! -L "$bundle" && -d "$bundle" ]] || die "$label is outside RELEASES_ROOT or is a symbolic link."
  [[ "$(basename "$bundle")" =~ ^[0-9a-fA-F]{40}$ ]] || die "$label must be named by a full release SHA."
  for file in compose.production.yml valorant.compose.yml .env release-metadata.txt; do
    [[ -f "$bundle/$file" && ! -L "$bundle/$file" && -r "$bundle/$file" ]] || die "$label is missing a safe $file."
    if [[ "$fixture_mode" != 1 ]]; then
      stat="$(stat -c '%u %a' "$bundle/$file" 2>/dev/null)" || die "cannot inspect $label/$file."
      [[ "$stat" == 0\ * ]] || die "$label/$file must be root-owned."
      mode="${stat##* }"
      [[ "$mode" == 600 || "$mode" == 640 ]] || die "$label/$file has an unsafe mode."
    fi
  done
  metadata_commit_sha="$(awk -F= '$1 == "commit_sha" { print $2; count++ } END { if (count != 1) exit 1 }' "$bundle/release-metadata.txt")" || die "$label metadata has an invalid commit_sha."
  [[ "$metadata_commit_sha" =~ ^[0-9a-fA-F]{40}$ && "${metadata_commit_sha,,}" == "$(basename "$bundle" | tr '[:upper:]' '[:lower:]')" ]] || die "$label metadata is not bound to its directory."
  metadata_writer_state="$(awk -F= '$1 == "writer_admitted" { print $2; count++ } END { if (count != 1) exit 1 }' "$bundle/release-metadata.txt")" || die "$label metadata has an invalid writer_admitted value."
  [[ "$metadata_writer_state" == true || "$metadata_writer_state" == false ]] || die "$label metadata has an invalid writer_admitted value."
  while IFS= read -r metadata_line || [[ -n "$metadata_line" ]]; do
    [[ "$metadata_line" =~ ^[a-z][a-z0-9_]*=[^[:space:]]+$ ]] || die "$label metadata contains an ambiguous entry."
    metadata_key="${metadata_line%%=*}"
    case "$metadata_key" in
      commit_sha|commit_point_utc|writer_admitted|current_pointer_updated|previous_release|quest_project|valorant_project|shared_network) ;;
      *) die "$label metadata contains an unknown entry." ;;
    esac
  done < "$bundle/release-metadata.txt"
}

if [[ "$mode" == pre-commit ]]; then
  rollback_release="${ROLLBACK_RELEASE_DIR:-${2:-}}"
  [[ -n "$rollback_release" ]] || die 'pre-commit rollback requires an immutable failed release directory.'
  safe_bundle "$rollback_release" 'failed release bundle'
  metadata_file="$rollback_release/release-metadata.txt"
  previous_release="$(awk -F= '$1 == "previous_release" { print substr($0, index($0,"=")+1); exit }' "$metadata_file")"
  safe_bundle "$previous_release" 'previous release bundle'
  writer_state="$(awk -F= '$1 == "writer_admitted" { print $2; exit }' "$metadata_file")"
  [[ "$writer_state" == false ]] || die 'a release past writer admission requires the post-commit recovery boundary.'
  validate_project_config "$rollback_release" quest-prod
  validate_project_config "$previous_release" quest-prod
  validate_project_config "$previous_release" valorant-prod
  validate_bundle_images "$rollback_release" true
  validate_bundle_images "$previous_release"

  command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
  previous_database_authority="$("$OLD_DATABASE_AUTHORITATIVE_COMMAND" 2>/dev/null)"
  [[ "$previous_database_authority" == supabase || "$previous_database_authority" == quest-postgres ]] || die 'previous database authority is ambiguous; refusing a split-brain rollback.'
  compose --env-file "$rollback_release/.env" -f "$rollback_release/compose.production.yml" --project-name quest-prod down --remove-orphans >/dev/null 2>&1 || die 'failed to stop the candidate Compose project.'
  if [[ "$previous_database_authority" == quest-postgres ]]; then
    compose --env-file "$previous_release/.env" -f "$previous_release/compose.production.yml" --project-name quest-prod up -d --no-build >/dev/null 2>&1 || die 'failed to restore the previous application digest.'
  else
    command_setting OLD_APPLICATION_RESTART_COMMAND
    RELEASE_DIR="$previous_release" "$OLD_APPLICATION_RESTART_COMMAND" >/dev/null 2>&1 || die 'failed to restore the legacy PM2 application.'
  fi

  if [[ "${OLD_VALORANT_WAS_STOPPED:-0}" == 1 ]]; then
    command_setting OLD_VALORANT_UNMASKED_CHECK
    [[ "$("$OLD_VALORANT_UNMASKED_CHECK" 2>/dev/null)" == unmasked ]] || die 'refusing to restart a masked old VALORANT unit.'
    command_setting OLD_VALORANT_RESTART_COMMAND
    "$OLD_VALORANT_RESTART_COMMAND" >/dev/null 2>&1 || die 'failed to restart the previously stopped old VALORANT units.'
  fi
  printf '%s\n' 'Pre-commit rollback completed: previous application release restored; no database URL was redirected.'
  exit 0
fi

# Post-commit recovery is not an application rollback. It never restarts old
# writers and never points either service at stale Supabase.
command_setting WRITER_STOP_COMMAND
command_setting FREEZE_ENABLE_COMMAND
command_setting CURRENT_STATE_CAPTURE_COMMAND
"$WRITER_STOP_COMMAND" >/dev/null 2>&1 || die 'failed to stop both writer groups.'
RELEASE_DIR="${ROLLBACK_RELEASE_DIR:-}" "$FREEZE_ENABLE_COMMAND" >/dev/null 2>&1 || die 'failed to re-enable coordinated write freeze.'
RELEASE_DIR="${ROLLBACK_RELEASE_DIR:-}" "$CURRENT_STATE_CAPTURE_COMMAND" >/dev/null 2>&1 || die 'failed to capture/checksum current PostgreSQL 17 and uploads.'
[[ -n "${EXPECTED_LOSS_RPO:-}" ]] || die 'post-commit recovery requires an explicit expected-loss/RPO record.'
[[ "${INCIDENT_OWNER_APPROVAL:-}" == INCIDENT_OWNER_APPROVAL ]] || die 'post-commit recovery requires incident-owner approval.'
command_setting RECOVERY_ACTION_COMMAND
action="$("$RECOVERY_ACTION_COMMAND" 2>/dev/null)"
[[ "$action" == fix-forward || "$action" == controlled-restore ]] || die 'recovery action must be fix-forward or controlled-restore.'
printf 'Post-commit recovery boundary recorded: action=%s expected_loss_rpo=%s\n' "$action" "$EXPECTED_LOSS_RPO"
