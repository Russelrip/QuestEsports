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
require_setting RELEASE_ENVIRONMENT
require_setting RELEASE_ENVIRONMENT_PROTECTED
[[ "$RELEASE_ENVIRONMENT" == production && "$RELEASE_ENVIRONMENT_PROTECTED" == 1 ]] || die 'release environment is not the protected production environment.'
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
recovery_command() {
  local command="$1" expected="${2:-}" output rc
  if [[ ! -x "$command" ]]; then
    printf '%s\n' 'URGENT: recovery command is missing or not executable.' >&2
    return 1
  fi
  if output="$("$command" 2>/dev/null)"; then rc=0; else rc=$?; fi
  (( rc == 0 )) || return 1
  [[ -z "$expected" || "$output" == "$expected" ]]
}
record_recovery_evidence() {
  local bundle="$1" boundary="$2" result="$3"
  [[ -n "$bundle" && -d "$bundle" ]] || return 0
  {
    printf 'boundary=%s\n' "$boundary"
    printf 'result=%s\n' "$result"
    printf 'legacy_restart_allowed=%s\n' "$([[ "$boundary" == pre-commit-rollback ]] && printf true || printf false)"
    printf 'supabase_authority_boundary=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf stale-after-first-vps-write || printf preserved-before-first-vps-write)"
    printf 'supabase_url_rollback=%s\n' "$([[ "$boundary" == post-commit-recovery ]] && printf prohibited || printf allowed-before-writer-admission)"
    printf 'reconciliation_decision=%s\n' "${SUPABASE_RECONCILIATION_DECISION:-not-required}"
  } > "$bundle/recovery-evidence.txt" 2>/dev/null || return 1
  chmod 600 "$bundle/recovery-evidence.txt" 2>/dev/null || return 1
}

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
      POSTGRES_IMAGE) [[ "$value" =~ ^postgres:17-bookworm@sha256:[0-9a-f]{64}$ ]] || die "$bundle/.env has an unsafe PostgreSQL image." ;;
      *) [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die "$bundle/.env has an unsafe $key." ;;
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
  validate_release_metadata "$bundle" "$label"
}

validate_release_metadata() {
  local bundle="$1" label="$2" line key
  declare -A metadata=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die "$label metadata contains an ambiguous entry."
    key="${BASH_REMATCH[1]}"
    case "$key" in
      commit_sha|commit_point_utc|writer_admitted|current_pointer_updated|previous_release|quest_project|valorant_project|shared_network|database_schemas|writer_groups|owner_approval_sha|cutover_type) ;;
      *) die "$label metadata contains an unknown entry: $key" ;;
    esac
    [[ -z "${metadata[$key]+present}" ]] || die "$label metadata contains a duplicate entry: $key"
    metadata["$key"]="${BASH_REMATCH[2]}"
  done < "$bundle/release-metadata.txt"
  for key in commit_sha writer_admitted previous_release cutover_type; do
    [[ -n "${metadata[$key]:-}" ]] || die "$label metadata is missing $key."
  done
  metadata_commit_sha="${metadata[commit_sha]}"
  [[ "$metadata_commit_sha" =~ ^[0-9a-fA-F]{40}$ && "${metadata_commit_sha,,}" == "$(basename "$bundle" | tr '[:upper:]' '[:lower:]')" ]] || die "$label metadata is not bound to its directory."
  metadata_writer_state="${metadata[writer_admitted]}"
  [[ "$metadata_writer_state" == true || "$metadata_writer_state" == false ]] || die "$label metadata has an invalid writer_admitted value."
  metadata_previous_release="${metadata[previous_release]}"
  metadata_cutover_type="${metadata[cutover_type]}"
}

validate_predecessor_metadata() {
  local label="$1"
  [[ "$metadata_previous_release" == "$commit_point_previous_release" ]] || die "$label metadata previous_release does not match the durable commit-point record."
  [[ "$metadata_cutover_type" == "$commit_point_cutover_type" ]] || die "$label metadata cutover_type does not match the durable commit-point record."
  if [[ "$commit_point_previous_release" == supabase ]]; then
    [[ "$metadata_previous_release" == supabase && "$metadata_cutover_type" == first-supabase-cutover ]] || die "$label metadata has an invalid first-cutover predecessor."
  else
    [[ "$metadata_cutover_type" == steady-state ]] || die "$label metadata has an invalid steady-state predecessor."
    [[ "$metadata_previous_release" == "$canonical_releases_root/"[0-9a-fA-F][0-9a-fA-F]* ]] || die "$label metadata previous release is outside RELEASES_ROOT."
    [[ "$(basename "$metadata_previous_release")" =~ ^[0-9a-fA-F]{40}$ ]] || die "$label metadata previous release is not a full-SHA bundle."
  fi
}

validate_commit_point() {
  local bundle="$1" line key value
  declare -A point=()
  [[ -f "$bundle/commit-point.txt" && ! -L "$bundle/commit-point.txt" && -r "$bundle/commit-point.txt" ]] || die "$bundle is missing a durable commit-point record."
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die 'durable commit-point record contains an ambiguous entry.'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    case "$key" in
      writer_admission_starting|commit_sha|commit_point_utc|quest_writer_admission_started|quest_writer_admitted|quest_writer_ack_utc|valorant_writer_admission_started|valorant_writer_admitted|valorant_writer_ack_utc|writer_admitted|previous_release|cutover_type|quest_project|valorant_project|shared_network) ;;
      *) die "durable commit-point record contains an unknown entry: $key" ;;
    esac
    [[ -z "${point[$key]+present}" ]] || die "durable commit-point record contains a duplicate entry: $key"
    point["$key"]="$value"
  done < "$bundle/commit-point.txt"
  for key in writer_admission_starting commit_sha commit_point_utc quest_writer_admission_started quest_writer_admitted quest_writer_ack_utc valorant_writer_admission_started valorant_writer_admitted valorant_writer_ack_utc writer_admitted previous_release cutover_type quest_project valorant_project shared_network; do
    [[ -n "${point[$key]:-}" ]] || die "durable commit-point record is missing $key."
  done
  [[ "${point[commit_sha],,}" == "$(basename "$bundle" | tr '[:upper:]' '[:lower:]')" && "${point[commit_sha]}" =~ ^[0-9a-fA-F]{40}$ ]] || die 'durable commit-point SHA is not bound to its release bundle.'
  [[ "${point[writer_admission_starting]}" == true && "${point[quest_project]}" == quest-prod && "${point[valorant_project]}" == valorant-prod && "${point[shared_network]}" == quest-shared ]] || die 'durable commit-point identity is invalid.'
  [[ "${point[cutover_type]}" == steady-state || "${point[cutover_type]}" == first-supabase-cutover ]] || die 'durable commit-point cutover type is invalid.'
  if [[ "${point[previous_release]}" == supabase ]]; then
    [[ "${point[cutover_type]}" == first-supabase-cutover ]] || die 'durable commit-point Supabase predecessor is only valid for first cutover.'
  else
    [[ "${point[cutover_type]}" == steady-state ]] || die 'durable commit-point first-cutover predecessor is fabricated.'
    [[ "${point[previous_release]}" == "$canonical_releases_root/"[0-9a-fA-F][0-9a-fA-F]* ]] || die 'durable commit-point previous release is outside RELEASES_ROOT.'
    [[ -d "${point[previous_release]}" && ! -L "${point[previous_release]}" && "$(realpath "${point[previous_release]}" 2>/dev/null)" == "${point[previous_release]}" ]] || die 'durable commit-point previous release is not canonical.'
    [[ "$(basename "${point[previous_release]}")" =~ ^[0-9a-fA-F]{40}$ && "${point[previous_release]}" != "$bundle" ]] || die 'durable commit-point previous release is not a distinct full-SHA bundle.'
  fi
  for key in quest_writer_admission_started quest_writer_admitted valorant_writer_admission_started valorant_writer_admitted writer_admitted; do
    [[ "${point[$key]}" == true || "${point[$key]}" == false ]] || die "durable commit-point $key is not boolean."
  done
  for key in commit_point_utc quest_writer_ack_utc valorant_writer_ack_utc; do
    [[ "${point[$key]}" == not-recorded || "${point[$key]}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "durable commit-point $key is not a UTC timestamp."
  done
  [[ "${point[quest_writer_admitted]}" == false || "${point[quest_writer_ack_utc]}" != not-recorded ]] || die 'durable commit-point lost the Quest writer acknowledgement timestamp.'
  [[ "${point[valorant_writer_admitted]}" == false || "${point[valorant_writer_ack_utc]}" != not-recorded ]] || die 'durable commit-point lost the VALORANT writer acknowledgement timestamp.'
  [[ "${point[quest_writer_admission_started]}" == true || "${point[quest_writer_admitted]}" == false ]] || die 'durable commit-point admitted Quest without recording its admission start.'
  [[ "${point[valorant_writer_admission_started]}" == true || "${point[valorant_writer_admitted]}" == false ]] || die 'durable commit-point admitted VALORANT without recording its admission start.'
  [[ "${point[writer_admitted]}" == false || "${point[quest_writer_admitted]}" == true || "${point[valorant_writer_admitted]}" == true ]] || die 'durable commit-point writer_admitted is not backed by a writer-group acknowledgement.'
  commit_point_requires_postcommit=false
  if [[ "${point[quest_writer_admission_started]}" == true || "${point[quest_writer_admitted]}" == true || "${point[valorant_writer_admission_started]}" == true || "${point[valorant_writer_admitted]}" == true || "${point[writer_admitted]}" == true ]]; then
    commit_point_requires_postcommit=true
  fi
  commit_point_previous_release="${point[previous_release]}"
  commit_point_cutover_type="${point[cutover_type]}"
}

if [[ "$mode" == pre-commit ]]; then
  rollback_release="${ROLLBACK_RELEASE_DIR:-${2:-}}"
  [[ -n "$rollback_release" ]] || die 'pre-commit rollback requires an immutable failed release directory.'
  safe_bundle "$rollback_release" 'failed release bundle'
  validate_commit_point "$rollback_release"
  validate_predecessor_metadata "$rollback_release"
  [[ "$commit_point_requires_postcommit" == false ]] || die 'durable commit-point state requires post-commit recovery; refusing pre-commit rollback.'
  writer_state="$metadata_writer_state"
  previous_release="$metadata_previous_release"
  if [[ "$previous_release" == supabase ]]; then
    [[ "$commit_point_previous_release" == supabase && "$commit_point_cutover_type" == first-supabase-cutover ]] || die 'Supabase predecessor is only valid for a first-cutover durable bundle.'
    [[ "$metadata_cutover_type" == first-supabase-cutover ]] || die 'first-cutover metadata does not identify the Supabase sentinel.'
    [[ "$(awk -F= '$1 == "owner_approval_sha" { print $2; exit }' "$rollback_release/release-metadata.txt")" == "$(basename "$rollback_release")" ]] || die 'first-cutover metadata lacks owner approval for this release.'
    first_cutover_recovery=true
  else
    first_cutover_recovery=false
    safe_bundle "$previous_release" 'previous release bundle'
  fi
  [[ "$writer_state" == false ]] || die 'a release past writer admission requires the post-commit recovery boundary.'
  validate_project_config "$rollback_release" quest-prod
  if [[ "$first_cutover_recovery" != true ]]; then
    validate_project_config "$previous_release" quest-prod
    validate_project_config "$previous_release" valorant-prod
  fi
  validate_bundle_images "$rollback_release" true
  if [[ "$first_cutover_recovery" != true ]]; then
    validate_bundle_images "$previous_release"
  fi

  command_setting OLD_DATABASE_AUTHORITATIVE_COMMAND
  previous_database_authority="$("$OLD_DATABASE_AUTHORITATIVE_COMMAND" 2>/dev/null)"
  [[ "$previous_database_authority" == supabase || "$previous_database_authority" == quest-postgres ]] || die 'previous database authority is ambiguous; refusing a split-brain rollback.'
  if [[ "$first_cutover_recovery" == true && "$previous_database_authority" != supabase ]]; then
    die 'first-cutover Supabase recovery requires Supabase to remain authoritative.'
  fi
  recovery_status=0
  record_recovery_evidence "$rollback_release" pre-commit-rollback started || recovery_status=1
  compose --env-file "$rollback_release/.env" -f "$rollback_release/compose.production.yml" --project-name quest-prod down --remove-orphans >/dev/null 2>&1 || recovery_status=1
  compose --env-file "$rollback_release/.env" -f "$rollback_release/valorant.compose.yml" --project-name valorant-prod down --remove-orphans >/dev/null 2>&1 || recovery_status=1
  if [[ "$previous_database_authority" == quest-postgres ]]; then
    compose --env-file "$previous_release/.env" -f "$previous_release/compose.production.yml" --project-name quest-prod up -d --no-build >/dev/null 2>&1 || recovery_status=1
    compose --env-file "$previous_release/.env" -f "$previous_release/valorant.compose.yml" --project-name valorant-prod up -d --no-build >/dev/null 2>&1 || recovery_status=1
  else
    if [[ "$first_cutover_recovery" == true ]]; then
      recovery_command "${OLD_APPLICATION_RESTART_COMMAND:-}" restarted || recovery_status=1
    else
      RELEASE_DIR="$previous_release" recovery_command "${OLD_APPLICATION_RESTART_COMMAND:-}" restarted || recovery_status=1
    fi
  fi

  if [[ "${OLD_VALORANT_WAS_STOPPED:-0}" == 1 ]]; then
    recovery_command "${OLD_VALORANT_UNMASKED_CHECK:-}" unmasked || recovery_status=1
    recovery_command "${OLD_VALORANT_RESTART_COMMAND:-}" || recovery_status=1
  fi
  record_recovery_evidence "$rollback_release" pre-commit-rollback "$([[ "$recovery_status" == 0 ]] && printf completed || printf incomplete)" || recovery_status=1
  (( recovery_status == 0 )) && printf '%s\n' 'Pre-commit rollback completed: previous application release restored; no database URL was redirected.' || printf '%s\n' 'URGENT: pre-commit rollback was incomplete; inspect recovery-evidence.txt.' >&2
  exit "$recovery_status"
fi

# Post-commit recovery is not an application rollback. It never restarts old
# writers and never points either service at stale Supabase.
postcommit_status=0
recovery_bundle="${ROLLBACK_RELEASE_DIR:-}"
[[ -n "$recovery_bundle" ]] || die 'post-commit recovery requires an evidence bundle path.'
safe_bundle "$recovery_bundle" 'post-commit evidence bundle'
validate_commit_point "$recovery_bundle"
validate_predecessor_metadata "$recovery_bundle"
[[ "$commit_point_requires_postcommit" == true ]] || { printf '%s\n' 'URGENT: post-commit recovery requires durable writer-admission evidence.' >&2; postcommit_status=1; }
if [[ -n "${SUPABASE_URL_ROLLBACK_COMMAND:-}" ]]; then
  printf '%s\n' 'URGENT: blind Supabase URL rollback is prohibited after the first VPS write; an explicit reconciliation/data-loss decision is required.' >&2
  postcommit_status=1
fi
record_recovery_evidence "$recovery_bundle" post-commit-recovery started || postcommit_status=1
recovery_command "${QUEST_WRITER_STOP_COMMAND:-}" stopped || postcommit_status=1
recovery_command "${VALORANT_WRITER_STOP_COMMAND:-}" stopped || postcommit_status=1
RELEASE_DIR="$recovery_bundle" recovery_command "${FREEZE_ENABLE_COMMAND:-}" || postcommit_status=1
if capture_output="$(RELEASE_DIR="$recovery_bundle" "${CURRENT_STATE_CAPTURE_COMMAND:-}" 2>/dev/null)"; then capture_rc=0; else capture_rc=$?; fi
(( capture_rc == 0 )) && [[ "$capture_output" == "captured evidence_bundle=$recovery_bundle" ]] || postcommit_status=1
[[ -n "${EXPECTED_LOSS_RPO:-}" ]] || { printf '%s\n' 'URGENT: post-commit recovery requires an explicit expected-loss/RPO record.' >&2; postcommit_status=1; }
[[ "${INCIDENT_OWNER_APPROVAL:-}" == INCIDENT_OWNER_APPROVAL ]] || { printf '%s\n' 'URGENT: post-commit recovery requires incident-owner approval.' >&2; postcommit_status=1; }
if [[ -z "${RECOVERY_ACTION_COMMAND:-}" || ! -x "$RECOVERY_ACTION_COMMAND" ]]; then
  printf '%s\n' 'URGENT: recovery action command is missing or not executable.' >&2
  postcommit_status=1
fi
action='not-selected'
if (( postcommit_status == 0 )); then
  action="$("$RECOVERY_ACTION_COMMAND" 2>/dev/null)"; action_rc=$?
else
  action_rc=1
fi
if (( action_rc != 0 )) || [[ "$action" != fix-forward && "$action" != controlled-restore ]]; then postcommit_status=1; fi
if [[ "$action" == return-to-supabase ]]; then
  printf '%s\n' 'URGENT: return to Supabase requires explicit reconciliation/data-loss approval; refusing a blind URL rollback.' >&2
  postcommit_status=1
fi
record_recovery_evidence "$recovery_bundle" post-commit-recovery "$([[ "$postcommit_status" == 0 ]] && printf completed || printf incomplete)" || postcommit_status=1
(( postcommit_status == 0 )) || die 'post-commit recovery was incomplete; inspect recovery-evidence.txt.'
printf 'Post-commit recovery boundary recorded: action=%s expected_loss_rpo=%s\n' "$action" "$EXPECTED_LOSS_RPO"
