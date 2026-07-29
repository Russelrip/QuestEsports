#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Backup configuration is not readable: $BACKUP_ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

for name in BACKUP_RCLONE_REMOTE RCLONE_CONFIG BACKUP_REMOTE_RETENTION_DAYS BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required retention setting: $name" >&2
    exit 1
  fi
done
if [[ ! -r "$RCLONE_CONFIG" ]]; then
  echo "Rclone configuration is not readable: $RCLONE_CONFIG" >&2
  exit 1
fi
if [[ ! "$BACKUP_RCLONE_REMOTE" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]]; then
  echo "BACKUP_RCLONE_REMOTE must name an rclone remote and non-root destination path." >&2
  exit 1
fi
if [[ ! "$BACKUP_REMOTE_RETENTION_DAYS" =~ ^[0-9]+$ || "$BACKUP_REMOTE_RETENTION_DAYS" -lt 1 ]]; then
  echo "BACKUP_REMOTE_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi
if [[ ! "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" =~ ^[0-9]+$ || "$BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS" -lt 2 ]]; then
  echo "BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS must be an integer of at least 2." >&2
  exit 1
fi
command -v rclone >/dev/null || { echo "rclone is required." >&2; exit 1; }

remote="${BACKUP_RCLONE_REMOTE%/}"
mapfile -t remote_objects < <(
  rclone lsf "$remote" --config "$RCLONE_CONFIG" --files-only \
    --max-depth 1 \
    --include 'quest-production-*.tar.gz.enc' \
    --include 'quest-production-*.tar.gz.enc.sha256'
)
declare -A object_set=()
for object_name in "${remote_objects[@]}"; do
  if [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc(\.sha256)?$ ]]; then
    object_set["$object_name"]=1
  fi
done

complete_archives=()
for object_name in "${remote_objects[@]}"; do
  sidecar_name="${object_name}.sha256"
  if [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ &&
        -n "${object_set[$sidecar_name]:-}" ]]; then
    complete_archives+=("$object_name")
  fi
done

mapfile -t expired_objects < <(
  rclone lsf "$remote" --config "$RCLONE_CONFIG" --files-only \
    --max-depth 1 \
    --min-age "${BACKUP_REMOTE_RETENTION_DAYS}d" \
    --include 'quest-production-*.tar.gz.enc'
)
expired_archives=()
for object_name in "${expired_objects[@]}"; do
  sidecar_name="${object_name}.sha256"
  if [[ "$object_name" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ &&
        -n "${object_set[$sidecar_name]:-}" ]]; then
    expired_archives+=("$object_name")
  fi
done

remaining_count=$((${#complete_archives[@]} - ${#expired_archives[@]}))
if (( remaining_count < BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS )); then
  echo "Refusing retention: it would leave ${remaining_count} recovery points, below the minimum ${BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS}." >&2
  exit 1
fi
if (( ${#expired_archives[@]} == 0 )); then
  echo "No remote production backups are older than ${BACKUP_REMOTE_RETENTION_DAYS} days."
  exit 0
fi

echo "Remote retention candidate archives: ${#expired_archives[@]}; recovery points retained: ${remaining_count}."
if [[ "${RETENTION_CONFIRMATION:-}" != "PRUNE_QUEST_PRODUCTION" ]]; then
  echo "Dry run only. Set RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION for an intentional deletion."
  for archive_name in "${expired_archives[@]}"; do
    printf 'Would delete recovery pair: %s and %s.sha256\n' "$archive_name" "$archive_name"
  done
  exit 0
fi

for archive_name in "${expired_archives[@]}"; do
  rclone deletefile "$remote/$archive_name.sha256" --config "$RCLONE_CONFIG"
  rclone deletefile "$remote/$archive_name" --config "$RCLONE_CONFIG"
done
echo "Remote retention completed."
