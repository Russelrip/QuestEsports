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
if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
  echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
  exit 1
fi
if ! exec 8>"$release_lock_path" || ! flock -n 8; then
  echo "Another release operation is already running." >&2
  exit 1
fi

for name in BACKUP_REMOTE_RETENTION_DAYS BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required retention setting: $name" >&2
    exit 1
  fi
done
if [[ ! "$BACKUP_REMOTE_RETENTION_DAYS" =~ ^[0-9]+$ || "$BACKUP_REMOTE_RETENTION_DAYS" -lt 1 ]]; then
  echo "BACKUP_REMOTE_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi
if [[ ! "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" =~ ^[0-9]+$ || "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" -lt 2 ]]; then
  echo "BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS must be an integer of at least 2." >&2
  exit 1
fi
command -v rclone >/dev/null || { echo "rclone is required." >&2; exit 1; }
command -v mktemp >/dev/null || { echo "mktemp is required." >&2; exit 1; }

declare -a remote_labels=()
declare -a remote_values=()
declare -a remote_configs=()
declare -A config_by_label=()
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
    config_by_label["$config_label"]="$config_path"
  done <<< "$BACKUP_RCLONE_CONFIGS"
fi
remote_entries="${BACKUP_RCLONE_REMOTES:-}"
if [[ -z "$remote_entries" && -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  remote_entries="legacy=${BACKUP_RCLONE_REMOTE}"
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
  if [[ -z "$remote_config" && ${#remote_labels[@]} -eq 0 && -n "${RCLONE_CONFIG:-}" ]]; then
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

listing_file="$(mktemp)"
trap 'rm -f -- "$listing_file"' EXIT
policy_failure=0
operation_failure=0
for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  : > "$listing_file"
  if ! rclone lsf "${remote%/}" --config "$config" --files-only --max-depth 1 \
      --include 'quest-production-*.tar.gz.enc' \
      --include 'quest-production-*.tar.gz.enc.sha256' > "$listing_file" 2>/dev/null; then
    echo "Could not inspect configured backup remote label: $label" >&2
    operation_failure=1
    continue
  fi
  declare -A object_set=()
  while IFS= read -r object_name; do
    [[ -n "$object_name" ]] || continue
    if [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc(\.sha256)?$ ]]; then
      object_set["$object_name"]=1
    fi
  done < "$listing_file"
  complete_count=0
  expired_archives=()
  while IFS= read -r object_name; do
    [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ ]] || continue
    [[ -n "${object_set[${object_name}.sha256]:-}" ]] || continue
    complete_count=$((complete_count + 1))
  done < "$listing_file"
  expired_file="$(mktemp)"
  if ! rclone lsf "${remote%/}" --config "$config" --files-only --max-depth 1 \
      --min-age "${BACKUP_REMOTE_RETENTION_DAYS}d" \
      --include 'quest-production-*.tar.gz.enc' > "$expired_file" 2>/dev/null; then
    rm -f -- "$expired_file"
    echo "Could not inspect retention age for remote label: $label" >&2
    operation_failure=1
    continue
  fi
  while IFS= read -r object_name; do
    [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ ]] || continue
    [[ -n "${object_set[${object_name}.sha256]:-}" ]] || continue
    expired_archives+=("$object_name")
  done < "$expired_file"
  rm -f -- "$expired_file"

  remaining_count=$((complete_count - ${#expired_archives[@]}))
  if (( remaining_count < BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS )); then
    echo "Refusing retention for remote label $label: policy is below the minimum recovery points." >&2
    policy_failure=1
    continue
  fi
  if (( ${#expired_archives[@]} == 0 )); then
    echo "No remote production backups are older than ${BACKUP_REMOTE_RETENTION_DAYS} days for label $label."
    continue
  fi
  echo "Remote retention candidate archives for label $label: ${#expired_archives[@]}; recovery points retained: ${remaining_count}."
  if [[ "${RETENTION_CONFIRMATION:-}" != "PRUNE_QUEST_PRODUCTION" ]]; then
    echo "Dry run only. Set RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION for an intentional deletion."
    for archive_name in "${expired_archives[@]}"; do
      printf 'Would delete recovery pair for label %s: %s and checksum\n' "$label" "$archive_name"
    done
    continue
  fi
  for archive_name in "${expired_archives[@]}"; do
    if ! rclone deletefile "${remote%/}/$archive_name.sha256" --config "$config" >/dev/null 2>/dev/null; then
      operation_failure=1
      continue
    fi
    if ! rclone deletefile "${remote%/}/$archive_name" --config "$config" >/dev/null 2>/dev/null; then
      operation_failure=1
    fi
  done
done

if (( policy_failure > 0 || operation_failure > 0 )); then
  exit 1
fi
if [[ "${RETENTION_CONFIRMATION:-}" == "PRUNE_QUEST_PRODUCTION" ]]; then
  echo "Remote retention completed."
fi
