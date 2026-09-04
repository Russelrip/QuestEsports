#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Backup configuration is not readable." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
# The release controller already holds this lock and hands its descriptor down
# on fd 8; re-opening the same path would deadlock against that held lock.
if [[ "${BACKUP_RELEASE_LOCK_HELD:-}" == 1 ]]; then
  expected_lock_target="$(readlink -f "$release_lock_path" 2>/dev/null || true)"
  inherited_lock_target="$(readlink -f /proc/self/fd/8 2>/dev/null || true)"
  if [[ -z "$expected_lock_target" || "$expected_lock_target" != "$inherited_lock_target" ]]; then
    echo "The inherited release lock descriptor is not the canonical lock." >&2
    exit 1
  fi
  if ! flock -n 8; then
    echo "The inherited release lock is not held." >&2
    exit 1
  fi
else
  if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
    echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
    exit 1
  fi
  if ! exec 8>"$release_lock_path" || ! flock -n 8; then
    echo "Another release operation is already running." >&2
    exit 1
  fi
fi

if [[ -z "${BACKUP_ROOT:-}" ]]; then
  echo "Missing required backup freshness setting: BACKUP_ROOT" >&2
  exit 1
fi
case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute path." >&2; exit 1 ;;
esac
if [[ "$BACKUP_ROOT" == "/" || -L "$BACKUP_ROOT" || ! -d "$BACKUP_ROOT" ]]; then
  echo "BACKUP_ROOT must be an existing, non-symlink directory below the filesystem root." >&2
  exit 1
fi

declare -a remote_labels=()
declare -a remote_values=()
declare -a remote_configs=()
declare -A config_by_label=()
declare -A config_by_resolved_path=()
if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
  while IFS= read -r config_entry || [[ -n "$config_entry" ]]; do
    [[ -z "$config_entry" ]] && continue
    config_label="${config_entry%%=*}"
    config_path="${config_entry#*=}"
    if [[ "$config_entry" != *=* || -z "$config_label" || -z "$config_path" ||
          ! "$config_label" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains an invalid entry." >&2
      exit 1
    fi
    if [[ -n "${config_by_label[$config_label]+x}" ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains a duplicate label." >&2
      exit 1
    fi
    resolved_config_path="$(realpath "$config_path" 2>/dev/null)" || {
      echo "Rclone configuration is unavailable for remote label: $config_label" >&2
      exit 1
    }
    if [[ ! -r "$resolved_config_path" || -n "${config_by_resolved_path[$resolved_config_path]+x}" ]]; then
      echo "Rclone configuration paths must be readable and unique." >&2
      exit 1
    fi
    config_by_label["$config_label"]="$resolved_config_path"
    config_by_resolved_path["$resolved_config_path"]="$config_label"
  done <<< "$BACKUP_RCLONE_CONFIGS"
fi
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  remote_entries="$BACKUP_RCLONE_REMOTES"
elif [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  remote_entries="legacy=${BACKUP_RCLONE_REMOTE}"
  if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
    echo "BACKUP_RCLONE_CONFIGS requires BACKUP_RCLONE_REMOTES." >&2
    exit 1
  fi
  if [[ -z "${RCLONE_CONFIG:-}" ]]; then
    echo "Missing required freshness setting: RCLONE_CONFIG" >&2
    exit 1
  fi
  config_by_label[legacy]="$RCLONE_CONFIG"
fi
if [[ -z "$remote_entries" ]]; then
  echo "Missing required freshness setting: BACKUP_RCLONE_REMOTES" >&2
  exit 1
fi
while IFS= read -r remote_entry || [[ -n "$remote_entry" ]]; do
  [[ -z "$remote_entry" ]] && continue
  remote_label="${remote_entry%%=*}"
  remote_value="${remote_entry#*=}"
  if [[ "$remote_entry" != *=* || -z "$remote_label" ||
        ! "$remote_label" =~ ^[A-Za-z0-9._-]+$ ||
        ! "$remote_value" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]]; then
    echo "BACKUP_RCLONE_REMOTES contains an invalid entry." >&2
    exit 1
  fi
  for existing_label in "${remote_labels[@]}"; do
    [[ "$existing_label" == "$remote_label" ]] && {
      echo "BACKUP_RCLONE_REMOTES contains a duplicate label." >&2
      exit 1
    }
  done
  remote_config="${config_by_label[$remote_label]:-}"
  if [[ -z "$remote_config" && -z "${BACKUP_RCLONE_REMOTES+x}" &&
        ${#remote_labels[@]} -eq 0 && -n "${RCLONE_CONFIG:-}" ]]; then
    remote_config="$RCLONE_CONFIG"
  fi
  if [[ -z "$remote_config" || ! -r "$remote_config" ]]; then
    echo "Rclone configuration is unavailable for remote label: $remote_label" >&2
    exit 1
  fi
  remote_labels+=("$remote_label")
  remote_values+=("$remote_value")
  remote_configs+=("$remote_config")
done <<< "$remote_entries"
if (( ${#remote_labels[@]} == 0 )); then
  echo "At least one backup remote is required." >&2
  exit 1
fi
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  for configured_label in "${!config_by_label[@]}"; do
    configured_remote=false
    for remote_label in "${remote_labels[@]}"; do
      [[ "$configured_label" == "$remote_label" ]] && configured_remote=true
    done
    if [[ "$configured_remote" != true ]]; then
      echo "BACKUP_RCLONE_CONFIGS must exactly match BACKUP_RCLONE_REMOTES." >&2
      exit 1
    fi
  done
fi

maximum_age_minutes="${BACKUP_MAX_AGE_MINUTES:-2160}"
if [[ ! "$maximum_age_minutes" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_MAX_AGE_MINUTES must be a positive integer." >&2
  exit 1
fi
for command in basename find flock realpath rclone sha256sum sort; do
  command -v "$command" >/dev/null || {
    echo "Required freshness command is unavailable: $command" >&2
    exit 1
  }
done

candidate_file="$(mktemp)"
trap 'rm -f -- "$candidate_file"' EXIT
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  -name 'quest-production-*.tar.gz.enc' -mmin "-${maximum_age_minutes}" \
  -print0 | sort -z -r > "$candidate_file"
recent_archive=""
while IFS= read -r -d '' candidate; do
  [[ -f "$candidate.sha256" ]] || continue
  archive_name="$(basename "$candidate")"
  if ! (cd "$BACKUP_ROOT" && sha256sum --check --status "$archive_name.sha256") 2>/dev/null; then
    continue
  fi
  all_remotes_valid=true
  for remote_index in "${!remote_labels[@]}"; do
    remote="${remote_values[$remote_index]}"
    config="${remote_configs[$remote_index]}"
    if ! rclone check "$BACKUP_ROOT" "${remote%/}" --config "$config" \
        --one-way --include "/$archive_name" --include "/$archive_name.sha256" \
        --quiet >/dev/null 2>/dev/null; then
      all_remotes_valid=false
    fi
  done
  if [[ "$all_remotes_valid" == true ]]; then
    recent_archive="$candidate"
    break
  fi
done < "$candidate_file"

if [[ -z "$recent_archive" ]]; then
  echo "No locally valid and remotely verified production backup/checksum pair newer than ${maximum_age_minutes} minutes was found." >&2
  exit 1
fi
echo "Backup freshness check passed: $(basename "$recent_archive")"
