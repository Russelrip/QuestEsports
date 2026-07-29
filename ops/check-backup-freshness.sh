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

for name in BACKUP_ROOT BACKUP_RCLONE_REMOTE RCLONE_CONFIG; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup freshness setting: $name" >&2
    exit 1
  fi
done
case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute path." >&2; exit 1 ;;
esac
if [[ "$BACKUP_ROOT" == "/" || -L "$BACKUP_ROOT" || ! -d "$BACKUP_ROOT" ]]; then
  echo "BACKUP_ROOT must be an existing, non-symlink directory below the filesystem root." >&2
  exit 1
fi
if [[ ! -r "$RCLONE_CONFIG" ]]; then
  echo "Rclone configuration is not readable: $RCLONE_CONFIG" >&2
  exit 1
fi
if [[ ! "$BACKUP_RCLONE_REMOTE" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]]; then
  echo "BACKUP_RCLONE_REMOTE must name an rclone remote and non-root destination path." >&2
  exit 1
fi

maximum_age_minutes="${BACKUP_MAX_AGE_MINUTES:-2160}"
if [[ ! "$maximum_age_minutes" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_MAX_AGE_MINUTES must be a positive integer." >&2
  exit 1
fi
for command in basename find rclone sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Required freshness command is unavailable: $command" >&2
    exit 1
  }
done

recent_archive=""
while IFS= read -r -d '' candidate; do
  [[ -f "$candidate.sha256" ]] || continue
  archive_name="$(basename "$candidate")"
  if ! (cd "$BACKUP_ROOT" && sha256sum --check --status "$archive_name.sha256"); then
    continue
  fi
  if ! rclone check "$BACKUP_ROOT" "${BACKUP_RCLONE_REMOTE%/}" \
    --config "$RCLONE_CONFIG" \
    --one-way \
    --include "/$archive_name" \
    --include "/$archive_name.sha256" \
    --quiet; then
    continue
  fi
  recent_archive="$candidate"
  break
done < <(find "$BACKUP_ROOT" -maxdepth 1 -type f \
  -name 'quest-production-*.tar.gz.enc' \
  -mmin "-${maximum_age_minutes}" \
  -print0)
if [[ -z "$recent_archive" ]]; then
  echo "No locally valid and remotely verified production backup/checksum pair newer than ${maximum_age_minutes} minutes was found." >&2
  exit 1
fi

echo "Backup freshness check passed: $(basename "$recent_archive")"
