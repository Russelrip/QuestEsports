#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'verification failed: %s\n' "$*" >&2; exit 1; }
release_lock_path="${RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
[[ "$release_lock_path" == /* && "$release_lock_path" != / && -e "$release_lock_path" ]] || die 'the canonical release lock must be a pre-created absolute path.'
if [[ "${QUEST_DEPLOY_FIXTURE:-0}" != 1 ]]; then
  [[ "$release_lock_path" == /var/lock/quest-esports-release.lock ]] || die 'the canonical release lock path cannot be overridden.'
fi
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release operation is already running.'
fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'verify-release.sh must run as root.'
  [[ "$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" == '0 660' ]] || die 'canonical release lock must be root-owned with mode 0660.'
fi
release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
# shellcheck disable=SC1090
source "$release_env_file"
require_setting() { [[ -n "${!1:-}" ]] || die "missing release setting: $1"; }
for setting in RELEASE_ROOT DOCKER_BIN QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE CURL_BIN DATABASE_READINESS_COMMAND; do require_setting "$setting"; done
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / ]] || die 'RELEASE_ROOT must be absolute and non-root.'
[[ -x "$DOCKER_BIN" && -x "$CURL_BIN" && -x "$DATABASE_READINESS_COMMAND" ]] || die 'verification command is not executable.'
[[ -f "$VALORANT_CA_FILE" && -r "$VALORANT_CA_FILE" && ! -L "$VALORANT_CA_FILE" ]] || die 'VALORANT_CA_FILE is missing or unsafe.'
current_link="${CURRENT_LINK:-$RELEASE_ROOT/current}"
current_target="$(realpath "$current_link" 2>/dev/null || true)"
release_dir="${1:-$current_target}"
[[ -n "$release_dir" && -d "$release_dir" && ! -L "$release_dir" ]] || die 'release directory is missing or unsafe.'
[[ "$release_dir" == "${RELEASES_ROOT:-$RELEASE_ROOT/releases}/"* ]] || die 'release is outside RELEASES_ROOT.'
[[ "$current_target" == "$release_dir" ]] || die 'current pointer does not identify the verified release.'
[[ -f "$release_dir/compose.production.yml" && -f "$release_dir/.env" && -f "$release_dir/valorant.compose.yml" ]] || die 'release bundle is incomplete.'

compose() { "$DOCKER_BIN" compose "$@"; }
validate_project() {
  local file="$1" project="$2" env_file="${3:-}" config active
  if [[ -n "$env_file" ]]; then
    config="$(compose --env-file "$env_file" -f "$file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
    active="$(compose --env-file "$env_file" -f "$file" --project-name "$project" ps --all --format '{{.Project}}' 2>/dev/null)" || die "Compose inspection failed for $project."
  else
    config="$(compose -f "$file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
    active="$(compose -f "$file" --project-name "$project" ps --all --format '{{.Project}}' 2>/dev/null)" || die "Compose inspection failed for $project."
  fi
  [[ "$(printf '%s\n' "$config" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project."
  [[ "$(printf '%s\n' "$active" | awk 'NF { print }' | sort -u)" == "$project" ]] || die "active project is not exactly one $project project."
}
validate_aliases() {
  local alias_output record alias_list alias container
  declare -A seen_aliases=()
  alias_output="$("$DOCKER_BIN" network inspect quest-shared --format '{{range .Containers}}{{.Name}}|{{join .Aliases ","}}{{"\n"}}{{end}}' 2>/dev/null)" || die 'shared-network inspection failed.'
  [[ -n "$alias_output" ]] || die 'shared-network alias inspection returned no containers.'
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    container="${record%%|*}"
    alias_list="${record#*|}"
    [[ -n "$container" && "$alias_list" != "$record" ]] || die 'shared-network alias inspection is ambiguous.'
    IFS=',' read -r -a aliases <<< "$alias_list"
    for alias in "${aliases[@]}"; do
      [[ -z "$alias" ]] && continue
      [[ -z "${seen_aliases[$alias]+seen}" ]] || die "duplicate shared-network alias: $alias"
      seen_aliases["$alias"]="$container"
    done
  done <<< "$alias_output"
  for alias in quest-backend quest-postgres valorant-platform valorant-updater valorant-discord-bot valorant-name-audit; do
    [[ -n "${seen_aliases[$alias]:-}" ]] || die "required shared-network alias is missing: $alias"
  done
}
validate_project "$release_dir/compose.production.yml" quest-prod "$release_dir/.env"
validate_project "$release_dir/valorant.compose.yml" valorant-prod "$release_dir/.env"
validate_aliases
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health JSON was not healthy.'
"$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" >/dev/null 2>&1 || die 'Quest readiness failed.'
valorant_json="$("$CURL_BIN" --fail --silent --show-error --cacert "$VALORANT_CA_FILE" --max-time 10 "$VALORANT_HEALTH_URL" 2>/dev/null)" || die 'VALORANT HTTPS health failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<< "$valorant_json" && grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<< "$valorant_json" || die 'VALORANT health JSON was not status ok/db up.'
[[ "$("$DATABASE_READINESS_COMMAND" 2>/dev/null)" == ready ]] || die 'database readiness failed.'
printf '%s\n' 'release verification passed: quest-prod, valorant-prod, health, readiness, HTTPS JSON health, and database readiness.'
