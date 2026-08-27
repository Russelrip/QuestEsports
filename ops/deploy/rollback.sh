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
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
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
[[ -x "$DOCKER_BIN" ]] || die 'DOCKER_BIN is not executable.'

mode="${1:-pre-commit}"
[[ "$mode" == pre-commit || "$mode" == post-commit ]] || die 'usage: rollback.sh pre-commit|post-commit'
compose() { "$DOCKER_BIN" compose "$@"; }

if [[ "$mode" == pre-commit ]]; then
  rollback_release="${ROLLBACK_RELEASE_DIR:-${2:-}}"
  [[ -n "$rollback_release" && -d "$rollback_release" && ! -L "$rollback_release" ]] || die 'pre-commit rollback requires an immutable failed release directory.'
  metadata_file="$rollback_release/release-metadata.txt"
  [[ -r "$metadata_file" ]] || die 'failed release metadata is missing.'
  previous_release="$(awk -F= '$1 == "previous_release" { print substr($0, index($0,"=")+1); exit }' "$metadata_file")"
  [[ "$previous_release" == "$releases_root/"* && -d "$previous_release" ]] || die 'previous release is not under RELEASES_ROOT.'
  [[ -f "$rollback_release/compose.production.yml" && -f "$rollback_release/.env" ]] || die 'failed release bundle is incomplete.'
  [[ -f "$previous_release/compose.production.yml" && -f "$previous_release/.env" ]] || die 'previous release bundle is incomplete.'
  writer_state="$(awk -F= '$1 == "writer_admitted" { print $2; exit }' "$metadata_file")"
  [[ "$writer_state" != true ]] || die 'a release past writer admission requires the post-commit recovery boundary.'

  command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
  [[ "$("$OLD_DATABASE_AUTHORITATIVE_COMMAND" 2>/dev/null)" == supabase ]] || die 'pre-commit rollback requires the previous Supabase database to remain authoritative.'
  compose --env-file "$rollback_release/.env" -f "$rollback_release/compose.production.yml" --project-name quest-prod down --remove-orphans >/dev/null 2>&1 || die 'failed to stop the candidate Compose project.'
  compose --env-file "$previous_release/.env" -f "$previous_release/compose.production.yml" --project-name quest-prod up -d --no-build >/dev/null 2>&1 || die 'failed to restore the previous application digest.'

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
