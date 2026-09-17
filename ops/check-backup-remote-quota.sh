#!/usr/bin/env bash
# Fails while there is still time to act: when a backup remote's free space
# drops below BACKUP_REMOTE_MIN_FREE_GIB, before uploads (and, through the backup
# evidence gate, migration releases) start failing. Read-only apart from the
# OAuth token refresh rclone persists in its own config.
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

minimum_free_gib="${BACKUP_REMOTE_MIN_FREE_GIB:-2}"
if [[ ! "$minimum_free_gib" =~ ^[0-9]+$ || "$minimum_free_gib" -lt 1 ]]; then
  echo "BACKUP_REMOTE_MIN_FREE_GIB must be a positive integer." >&2
  exit 1
fi
command -v rclone >/dev/null || { echo "rclone is required." >&2; exit 1; }

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
remote_entries=''
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  remote_entries="$BACKUP_RCLONE_REMOTES"
elif [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  remote_entries="legacy=${BACKUP_RCLONE_REMOTE}"
  if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
    echo "BACKUP_RCLONE_CONFIGS requires BACKUP_RCLONE_REMOTES." >&2
    exit 1
  fi
  if [[ -z "${RCLONE_CONFIG:-}" ]]; then
    echo "Missing required retention setting: RCLONE_CONFIG" >&2
    exit 1
  fi
  config_by_label[legacy]="$RCLONE_CONFIG"
fi
if [[ -z "$remote_entries" ]]; then
  echo "Missing required retention setting: BACKUP_RCLONE_REMOTES" >&2
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

gib() { awk -v bytes="$1" 'BEGIN { printf "%.2f GiB", bytes / 1073741824 }'; }
# rclone pretty-prints this JSON across lines with tabs, so flatten it first.
json_number() { tr -d ' \t\r\n' <<< "$2" | sed -nE "s/.*\"$1\":([0-9]+).*/\1/p"; }

failure=0
for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  # Quota belongs to the account, so ask the remote root rather than the backup path.
  if ! about="$(rclone about "${remote%%:*}:" --config "$config" --json 2>/dev/null)"; then
    echo "Could not read storage usage for remote label: $label" >&2
    failure=1
    continue
  fi
  free="$(json_number free "$about")"
  if [[ -z "$free" ]]; then
    echo "Remote label $label does not report free space; the quota cannot be checked." >&2
    failure=1
    continue
  fi
  printf 'Remote label %s: %s free of %s, %s used, %s in trash.\n' "$label" "$(gib "$free")" \
    "$(gib "$(json_number total "$about")")" "$(gib "$(json_number used "$about")")" \
    "$(gib "$(json_number trashed "$about")")"
  if (( free < minimum_free_gib * 1073741824 )); then
    echo "Low space on remote label $label: $(gib "$free") free is below the ${minimum_free_gib} GiB minimum." >&2
    failure=1
  fi
done
exit "$failure"
