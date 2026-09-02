#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'adoption refused: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

[[ "${EUID:-$(id -u)}" -eq 0 || "${ADOPTION_TEST_FIXTURE:-0}" == 1 ]] ||
  die 'the adoption controller must run as root.'
[[ $# -eq 2 ]] || die 'usage: adopt-compose.sh <full-release-sha> <release-manifest>'

release_sha="$1"
manifest_path="$2"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA must be full lowercase hexadecimal.'
[[ "$manifest_path" == /var/lib/quest-esports/incoming/release-manifest || "${ADOPTION_TEST_FIXTURE:-0}" == 1 ]] ||
  die 'release manifest path is not the fixed incoming path.'

release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ "$release_env_file" == /* && "$release_env_file" != / && -f "$release_env_file" && ! -L "$release_env_file" ]] ||
  die 'release environment is missing or unsafe.'
if [[ "${ADOPTION_TEST_FIXTURE:-0}" != 1 ]]; then
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] ||
    die 'release environment is not canonical.'
  [[ "$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" =~ ^0\ (600|640)$ ]] ||
    die 'release environment must be root-owned and private.'
fi
set -a
# shellcheck disable=SC1090
source "$release_env_file"
set +a

require_setting() { [[ -n "${!1:-}" ]] || die "missing adoption setting: $1"; }
command_setting() {
  require_setting "$1"
  [[ "${!1}" == /* && -x "${!1}" && ! -L "${!1}" ]] || die "adoption command is unsafe: $1"
  if [[ "${ADOPTION_TEST_FIXTURE:-0}" != 1 ]]; then
    [[ "$(stat -c '%u' "${!1}" 2>/dev/null)" == 0 ]] || die "adoption command is not root-owned: $1"
  fi
}
root_file() {
  [[ "$1" == /* && -f "$1" && ! -L "$1" ]] || die 'required root-owned file is missing or unsafe.'
  [[ "${ADOPTION_TEST_FIXTURE:-0}" == 1 || "$(stat -c '%u' "$1" 2>/dev/null)" == 0 ]] ||
    die 'required file is not root-owned.'
}

for setting in RELEASE_ROOT RELEASES_ROOT CURRENT_LINK RELEASE_LOCK_PATH QUEST_COMPOSE_TEMPLATE \
  VALORANT_COMPOSE_SOURCE ADOPTION_HOST_VALIDATE_COMMAND ADOPTION_AUTHORITY_AUDIT_COMMAND \
  ADOPTION_RECOVERY_VERIFY_COMMAND ADOPTION_CANDIDATE_VALIDATE_COMMAND ADOPTION_HANDOFF_ARM_COMMAND \
  ADOPTION_FREEZE_COMMAND ADOPTION_LEGACY_STOP_COMMAND ADOPTION_FINAL_BACKUP_COMMAND \
  ADOPTION_FINAL_RESTORE_COMMAND ADOPTION_COMPOSE_FROZEN_START_COMMAND \
  ADOPTION_QUEST_WRITER_ENABLE_COMMAND ADOPTION_VALORANT_WRITER_ENABLE_COMMAND \
  ADOPTION_COMMIT_VERIFY_COMMAND ADOPTION_LEGACY_MASK_COMMAND ADOPTION_PRECOMMIT_ROLLBACK_COMMAND \
  ADOPTION_POSTCOMMIT_FREEZE_COMMAND QUEST_FRONTEND_IMAGE_APPROVED_REF \
  QUEST_BACKEND_IMAGE_APPROVED_REF MIGRATOR_IMAGE_APPROVED_REF POSTGRES_IMAGE_APPROVED_REF \
  VALORANT_IMAGE_APPROVED_REF FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA; do
  require_setting "$setting"
done
for command_name in ADOPTION_HOST_VALIDATE_COMMAND ADOPTION_AUTHORITY_AUDIT_COMMAND \
  ADOPTION_RECOVERY_VERIFY_COMMAND ADOPTION_CANDIDATE_VALIDATE_COMMAND ADOPTION_HANDOFF_ARM_COMMAND \
  ADOPTION_FREEZE_COMMAND ADOPTION_LEGACY_STOP_COMMAND ADOPTION_FINAL_BACKUP_COMMAND \
  ADOPTION_FINAL_RESTORE_COMMAND ADOPTION_COMPOSE_FROZEN_START_COMMAND \
  ADOPTION_QUEST_WRITER_ENABLE_COMMAND ADOPTION_VALORANT_WRITER_ENABLE_COMMAND \
  ADOPTION_COMMIT_VERIFY_COMMAND ADOPTION_LEGACY_MASK_COMMAND ADOPTION_PRECOMMIT_ROLLBACK_COMMAND \
  ADOPTION_POSTCOMMIT_FREEZE_COMMAND; do
  command_setting "$command_name"
done

[[ "$FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA" == "$release_sha" ]] ||
  die 'owner approval is not bound to the adoption SHA.'
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / && -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] ||
  die 'release root is invalid.'
[[ "$RELEASES_ROOT" == "$RELEASE_ROOT/releases" && -d "$RELEASES_ROOT" && ! -L "$RELEASES_ROOT" ]] ||
  die 'release storage root is invalid.'
[[ "$CURRENT_LINK" == "$RELEASE_ROOT/current" ]] || die 'current pointer path is not canonical.'
[[ ! -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]] ||
  die 'first adoption requires an absent current release pointer.'
[[ "$RELEASE_LOCK_PATH" == /* && "$RELEASE_LOCK_PATH" != / ]] || die 'release lock path is invalid.'

exec 9>"$RELEASE_LOCK_PATH" || die 'release lock is not writable.'
flock -n 9 || die 'another release or backup operation is active.'

root_file "$manifest_path"
root_file "$QUEST_COMPOSE_TEMPLATE"
root_file "$VALORANT_COMPOSE_SOURCE"

declare -A manifest=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || die 'release manifest contains an ambiguous entry.'
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  [[ -z "${manifest[$key]+present}" ]] || die 'release manifest contains a duplicate key.'
  manifest["$key"]="$value"
done < "$manifest_path"
expected_keys=(commit_sha frontend_image backend_image migrator_image postgres_image valorant_image)
[[ "${#manifest[@]}" -eq "${#expected_keys[@]}" ]] || die 'release manifest key count is invalid.'
for key in "${expected_keys[@]}"; do [[ -n "${manifest[$key]:-}" ]] || die 'release manifest is incomplete.'; done
[[ "${manifest[commit_sha]}" == "$release_sha" ]] || die 'release manifest SHA does not match the requested adoption.'
[[ "${manifest[frontend_image]}" == "$QUEST_FRONTEND_IMAGE_APPROVED_REF" &&
   "${manifest[backend_image]}" == "$QUEST_BACKEND_IMAGE_APPROVED_REF" &&
   "${manifest[migrator_image]}" == "$MIGRATOR_IMAGE_APPROVED_REF" &&
   "${manifest[postgres_image]}" == "$POSTGRES_IMAGE_APPROVED_REF" &&
   "${manifest[valorant_image]}" == "$VALORANT_IMAGE_APPROVED_REF" ]] ||
  die 'release manifest does not match the owner-approved image digests.'
for key in frontend_image backend_image migrator_image valorant_image; do
  [[ "${manifest[$key]}" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die 'application image is not immutable.'
done
[[ "${manifest[postgres_image]}" =~ ^postgres:17-bookworm@sha256:[0-9a-f]{64}$ ]] ||
  die 'PostgreSQL image is not the approved immutable major.'

host_validation="$(RUNTIME_DATABASE_AUTHORITY=quest-postgres-legacy RELEASE_SHA="$release_sha" \
  RELEASE_MANIFEST="$manifest_path" "$ADOPTION_HOST_VALIDATE_COMMAND" 2>/dev/null)" ||
  die 'host and artifact validation failed.'
[[ "$host_validation" == validated ]] || die 'host validation acknowledgement is invalid.'

stage_dir="$RELEASES_ROOT/$release_sha"
[[ ! -e "$stage_dir" && ! -L "$stage_dir" ]] || die 'adoption release directory already exists.'
mkdir -m 0755 "$stage_dir"
cp -- "$QUEST_COMPOSE_TEMPLATE" "$stage_dir/compose.production.yml"
cp -- "$VALORANT_COMPOSE_SOURCE" "$stage_dir/valorant.compose.yml"
cat > "$stage_dir/.env" <<EOF
QUEST_FRONTEND_IMAGE=${manifest[frontend_image]}
QUEST_BACKEND_IMAGE=${manifest[backend_image]}
QUEST_MIGRATOR_IMAGE=${manifest[migrator_image]}
POSTGRES_IMAGE=${manifest[postgres_image]}
VALORANT_IMAGE=${manifest[valorant_image]}
EOF
chmod 0644 "$stage_dir/compose.production.yml" "$stage_dir/valorant.compose.yml"
chmod 0600 "$stage_dir/.env"

state=undetermined
writer_admission_started=false
quest_writer_admitted=false
valorant_writer_admitted=false
current_pointer_updated=false
rollback_reference=not-recorded
commit_timestamp=not-recorded

write_state() {
  local temporary="$stage_dir/.adoption-state.$$"
  {
    printf 'state=%s\n' "$state"
    printf 'release_sha=%s\n' "$release_sha"
    printf 'source_authority=quest-postgres-legacy\n'
    printf 'writer_admission_started=%s\n' "$writer_admission_started"
    printf 'quest_writer_admitted=%s\n' "$quest_writer_admitted"
    printf 'valorant_writer_admitted=%s\n' "$valorant_writer_admitted"
    printf 'current_pointer_updated=%s\n' "$current_pointer_updated"
    printf 'rollback_reference=%s\n' "$rollback_reference"
    printf 'updated_at=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)"
  } > "$temporary"
  chmod 0600 "$temporary"
  mv -Tf -- "$temporary" "$stage_dir/adoption-state.txt"
}
write_state

run_exact() {
  local variable="$1" expected="$2" output
  output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" RELEASE_MANIFEST="$manifest_path" \
    "${!variable}" 2>/dev/null)" || die "$variable failed."
  [[ "$output" == "$expected" ]] || die "$variable returned an invalid acknowledgement."
}

precommit_recovery() {
  RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$ADOPTION_PRECOMMIT_ROLLBACK_COMMAND" >/dev/null 2>&1
}
postcommit_recovery() {
  RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$ADOPTION_POSTCOMMIT_FREEZE_COMMAND" >/dev/null 2>&1
}
on_exit() {
  local status=$? recovery_status=0
  trap - EXIT
  if (( status != 0 )); then
    if [[ "$writer_admission_started" == true ]]; then
      postcommit_recovery || recovery_status=$?
    else
      precommit_recovery || recovery_status=$?
    fi
    (( recovery_status == 0 )) || printf '%s\n' 'URGENT: adoption recovery was incomplete.' >&2
  fi
  exit "$status"
}
trap on_exit EXIT

run_exact ADOPTION_AUTHORITY_AUDIT_COMMAND \
  'vps-authoritative-audited source=quest-postgres:5433 schemas=public,valorant writers=quest,valorant'
state=vps-authoritative-audited; write_state

run_exact ADOPTION_RECOVERY_VERIFY_COMMAND \
  'recovery-verified archive=verified checksum=verified remotes=verified restore=verified'
state=recovery-verified; write_state

run_exact ADOPTION_CANDIDATE_VALIDATE_COMMAND \
  'candidate-validated database=postgresql17 schemas=public,valorant quest=frozen-ready valorant=frozen-ready'
state=candidate-validated; write_state

arm_output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$ADOPTION_HANDOFF_ARM_COMMAND" 2>/dev/null)" ||
  die 'handoff arm command failed.'
[[ "$arm_output" =~ ^handoff-armed\ rollback=([^[:space:]]+)\ rpo=([^[:space:]]+)\ rto=([^[:space:]]+)$ ]] ||
  die 'handoff arm acknowledgement is invalid.'
rollback_reference="${BASH_REMATCH[1]}"
[[ "$rollback_reference" == /* && "$rollback_reference" != / ]] || die 'rollback reference is unsafe.'
state=handoff-armed; write_state

run_exact ADOPTION_FREEZE_COMMAND 'frozen groups=quest,valorant'
run_exact ADOPTION_LEGACY_STOP_COMMAND 'stopped groups=quest,valorant reboot_persistence=disabled'
run_exact ADOPTION_FINAL_BACKUP_COMMAND \
  "verified-complete release_sha=$release_sha schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified"
run_exact ADOPTION_FINAL_RESTORE_COMMAND 'restored target=quest-postgres:55432 schemas=public,valorant'
run_exact ADOPTION_COMPOSE_FROZEN_START_COMMAND 'started-frozen groups=quest,valorant readiness=verified'

writer_admission_started=true; write_state
run_exact ADOPTION_QUEST_WRITER_ENABLE_COMMAND 'admitted group=quest'
quest_writer_admitted=true; write_state
run_exact ADOPTION_VALORANT_WRITER_ENABLE_COMMAND 'admitted group=valorant'
valorant_writer_admitted=true
commit_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
state=compose-authoritative
write_state

write_commit_point() {
  local pointer_updated="$1" temporary="$stage_dir/.commit-point.$$"
  cat > "$temporary" <<EOF
writer_admission_starting=true
quest_writer_admitted=true
valorant_writer_admitted=true
writer_admitted=true
current_pointer_updated=$pointer_updated
commit_point_utc=$commit_timestamp
previous_release=legacy-vps
previous_database_authority=quest-postgres
rollback_reference=$rollback_reference
cutover_type=existing-vps-compose-adoption
EOF
  chmod 0600 "$temporary"
  mv -Tf -- "$temporary" "$stage_dir/commit-point.txt"
}
write_commit_point false

temporary_current="$RELEASE_ROOT/.current.$release_sha.$$"
[[ ! -e "$temporary_current" && ! -L "$temporary_current" ]] || die 'temporary current pointer already exists.'
ln -s -- "$stage_dir" "$temporary_current"
mv -Tf -- "$temporary_current" "$CURRENT_LINK"
[[ "$(realpath "$CURRENT_LINK" 2>/dev/null)" == "$stage_dir" ]] || die 'current pointer verification failed.'
current_pointer_updated=true
write_state

metadata_temporary="$stage_dir/.release-metadata.$$"
cat > "$metadata_temporary" <<EOF
release_sha=$release_sha
commit_point_utc=$commit_timestamp
writer_admitted=true
current_pointer_updated=true
previous_release=legacy-vps
previous_database_authority=quest-postgres
database_authority=quest-postgres
schemas=public,valorant
writer_groups=quest,valorant
rollback_reference=$rollback_reference
cutover_type=existing-vps-compose-adoption
EOF
chmod 0600 "$metadata_temporary"
mv -Tf -- "$metadata_temporary" "$stage_dir/release-metadata.txt"
write_commit_point true

run_exact ADOPTION_COMMIT_VERIFY_COMMAND \
  "compose-authoritative release_sha=$release_sha current=verified writers=quest,valorant schemas=public,valorant"
run_exact ADOPTION_LEGACY_MASK_COMMAND 'masked groups=quest,valorant'

trap - EXIT
say "First Compose adoption completed: $release_sha"
