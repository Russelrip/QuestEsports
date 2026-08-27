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
  [[ -f "$1" && -r "$1" && ! -L "$1" ]] || die 'required cutover file is missing or unsafe.'
  if [[ "$fixture_mode" != 1 ]]; then
    [[ "$(stat -c '%u' "$1" 2>/dev/null)" == 0 ]] || die 'required cutover file is not root-owned.'
  fi
}
protected_file() {
  root_file "$1"
  if [[ "$fixture_mode" != 1 ]]; then
    protected_mode="$(stat -c '%a' "$1" 2>/dev/null)" || die 'protected runtime file mode cannot be inspected.'
    [[ "$protected_mode" == 600 || "$protected_mode" == 640 ]] || die 'protected runtime file mode is unsafe.'
  fi
}

for setting in RELEASE_ROOT RELEASES_ROOT QUEST_COMPOSE_TEMPLATE VALORANT_COMPOSE_SOURCE DOCKER_BIN CURRENT_SUPABASE_ENV_FILE VALIDATE_HOST_COMMAND CUTOVER_RESTORE_COMMAND; do
  require_setting "$setting"
done
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / && -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'release root is invalid.'
[[ "$RELEASES_ROOT" == /* && "$RELEASES_ROOT" != / && -d "$RELEASES_ROOT" && ! -L "$RELEASES_ROOT" ]] || die 'release storage root is invalid.'
[[ -x "$DOCKER_BIN" ]] || die 'Docker command is not executable.'
root_file "$manifest_path"
protected_file "$CURRENT_SUPABASE_ENV_FILE"
command_setting VALIDATE_HOST_COMMAND
[[ "$(RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" "$VALIDATE_HOST_COMMAND" 2>/dev/null)" == validated ]] || die 'host/artifact validation did not acknowledge the cutover manifest.'
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
[[ "${manifest[commit_sha]:-}" == "$release_sha" ]] || die 'cutover manifest is not bound to the requested SHA.'

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
old_units_stopped=false
old_valorant_was_active=false
old_quest_stopped=false
old_valorant_stop_attempted=false
old_quest_stop_attempted=false
old_quest_was_active=false
postcommit_armed=false

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
  output="$(TARGET_AUTHORITY=quest-postgres RELEASE_SHA="$release_sha" RELEASE_MANIFEST="$manifest_path" RELEASE_DIR="$stage_dir" POSTGRES_IMAGE="${manifest[postgres_image]:-}" CURRENT_SUPABASE_ENV_FILE="$CURRENT_SUPABASE_ENV_FILE" "${!variable}" 2>/dev/null)" || die "$variable command failed."
  if [[ -n "$expected" ]]; then [[ "$output" == "$expected" ]] || die "$variable command acknowledgement was invalid."; fi
}
run_migrator() {
  # The migrator acknowledgement is `migrated image=<digest> target=quest-postgres`.
  local variable="$1" repository="$2" target_authority="$3" schema="$4" output expected
  command_setting "$variable"
  [[ "$target_authority" == quest-postgres ]] || die 'migrator target authority is not the fixed Quest PostgreSQL target.'
  [[ "$schema" == public || "$schema" == valorant ]] || die 'migrator schema is not an approved service schema.'
  output="$(MIGRATION_REPOSITORY="$repository" TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" MIGRATOR_IMAGE="${manifest[migrator_image]}" EXPECTED_MIGRATOR_IMAGE="${manifest[migrator_image]}" "${!variable}" 2>/dev/null)" || die 'migration command failed.'
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
    output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" "$command" 2>/dev/null)"; rc=$?
    if (( rc != 0 )) || [[ -n "$expected" && "$output" != "$expected" ]]; then
      printf 'URGENT: pre-commit recovery hook %s failed or returned an invalid acknowledgement.\n' "$variable" >&2
      return 1
    fi
    return 0
  }
  if [[ -n "${CUTOVER_ABORT_COMMAND:-}" ]]; then
    recovery_hook CUTOVER_ABORT_COMMAND || status=1
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
  if [[ "$freeze_active" == true && -n "${FREEZE_DISABLE_COMMAND:-}" ]]; then
    recovery_hook FREEZE_DISABLE_COMMAND || status=1
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
  hook="${FREEZE_ENABLE_COMMAND:-}"
  if [[ -z "$hook" || ! -x "$hook" ]]; then
    printf '%s\n' 'URGENT: post-commit freeze-enable hook is missing or not executable.' >&2
    status=1
  else
    "$hook" >/dev/null 2>&1 || { printf '%s\n' 'URGENT: post-commit freeze-enable failed.' >&2; status=1; }
  fi
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
  printf '%s\n' 'Expected loss/RPO and incident-owner approval are required before recovery.' >&2
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
  } > "$stage_dir/recovery-evidence.txt" 2>/dev/null || return 1
  chmod 600 "$stage_dir/recovery-evidence.txt" 2>/dev/null || return 1
}
on_exit() {
  local status=$? original_status recovery_status
  original_status="$status"
  trap - EXIT
  if (( status != 0 )); then
    if [[ "$postcommit_armed" == true || "$writer_admitted" == true || "$commit_recorded" == true ]]; then
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
run_hook FREEZE_ENABLE_COMMAND validation
freeze_active=true
run_hook FREEZE_STATUS_COMMAND acknowledged
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
run_database_readiness

command_setting CANDIDATE_FROZEN_START_COMMAND
require_setting CANDIDATE_START_CONTRACT
require_setting CANDIDATE_FREEZE_FLAG
require_setting CANDIDATE_READ_ONLY_FLAG
[[ "$CANDIDATE_START_CONTRACT" == frozen-read-only ]] || die 'candidate start contract must be frozen-read-only.'
candidate_output="$(RELEASE_SHA="$release_sha" RELEASE_DIR="$stage_dir" COMPOSE_ENV_FILE="$compose_env_file" \
  QUEST_COMPOSE_FILE="$stage_dir/compose.production.yml" VALORANT_COMPOSE_FILE="$stage_dir/valorant.compose.yml" \
  QUEST_PROJECT=quest-prod VALORANT_PROJECT=valorant-prod WRITE_FREEZE_MODE=validation CANDIDATE_READ_ONLY=1 \
  "$CANDIDATE_FROZEN_START_COMMAND" --contract "$CANDIDATE_START_CONTRACT" \
  --freeze-flag "$CANDIDATE_FREEZE_FLAG" --read-only-flag "$CANDIDATE_READ_ONLY_FLAG" 2>/dev/null)" \
  || die 'CANDIDATE_FROZEN_START_COMMAND command failed.'
[[ "$candidate_output" == started-frozen-read-only ]] || die 'candidate start acknowledgement was invalid.'
command_setting CURL_BIN
command_setting VALORANT_CONTAINER_HEALTH_COMMAND
for setting in QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE; do require_setting "$setting"; done
validate_endpoint_identities
root_file "$VALORANT_CA_FILE"
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health was not healthy.'
quest_ready="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" 2>/dev/null)" || die 'Quest readiness failed.'
grep -Eq '"ready"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$quest_ready" || die 'Quest readiness was not ready.'
valorant_health="$(VALORANT_HEALTH_URL="$VALORANT_HEALTH_URL" VALORANT_CA_FILE="$VALORANT_CA_FILE" "$VALORANT_CONTAINER_HEALTH_COMMAND" 2>/dev/null)" || die 'VALORANT HTTPS health failed from the Quest network boundary.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$valorant_health" && grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<< "$valorant_health" || die 'VALORANT health was not status ok/db up.'
validate_active_project "$stage_dir/compose.production.yml" "$quest_project" "$compose_env_file" \
  "frontend=${manifest[frontend_image]}" "backend=${manifest[backend_image]}" "postgres=${manifest[postgres_image]}"
validate_active_project "$stage_dir/valorant.compose.yml" "$valorant_project" "$compose_env_file" \
  "valorant-platform=${manifest[valorant_image]}"
validate_aliases

command_setting QUEST_READINESS_ACK_COMMAND
command_setting VALORANT_READINESS_ACK_COMMAND
[[ "$("$QUEST_READINESS_ACK_COMMAND" 2>/dev/null)" == ready ]] || die 'Quest frozen readiness was not acknowledged.'
[[ "$("$VALORANT_READINESS_ACK_COMMAND" 2>/dev/null)" == ready ]] || die 'VALORANT frozen readiness was not acknowledged.'

command_setting POST_COMMIT_RECOVERY_ARM_COMMAND
run_hook POST_COMMIT_RECOVERY_ARM_COMMAND armed
postcommit_armed=true
write_release_metadata not-recorded false false || die 'could not record provisional first-cutover metadata.'
commit_timestamp=not-recorded
record_commit_point false false not-recorded false false not-recorded || die 'could not record the armed writer-admission boundary.'
command_setting QUEST_WRITER_ENABLE_COMMAND
record_commit_point true false not-recorded false false not-recorded || die 'could not record the Quest writer-admission start boundary.'
[[ "$(RELEASE_SHA="$release_sha" "$QUEST_WRITER_ENABLE_COMMAND" 2>/dev/null)" == admitted ]] || die 'Quest writer admission failed.'
writer_admitted=true
commit_recorded=true
commit_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
quest_writer_ack_timestamp="$commit_timestamp"
record_commit_point true true "$quest_writer_ack_timestamp" false false not-recorded || die 'could not record the Quest writer admission boundary.'
command_setting VALORANT_WRITER_ENABLE_COMMAND
record_commit_point true true "$quest_writer_ack_timestamp" true false not-recorded || die 'could not record the VALORANT writer-admission start boundary.'
[[ "$(RELEASE_SHA="$release_sha" "$VALORANT_WRITER_ENABLE_COMMAND" 2>/dev/null)" == admitted ]] || die 'VALORANT writer admission failed.'
valorant_writer_ack_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
record_commit_point true true "$quest_writer_ack_timestamp" true true "$valorant_writer_ack_timestamp" || die 'could not record the VALORANT writer admission boundary.'
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
