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

required=(DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_ROOT BACKUP_AGE_RECIPIENT BACKUP_RCLONE_REMOTE RCLONE_CONFIG)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup setting: $name" >&2
    exit 1
  fi
done

for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Backup source directories must be absolute paths: $directory" >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" ]]; then
    echo "Refusing to archive the filesystem root." >&2
    exit 1
  fi
  if [[ ! -d "$directory" ]]; then
    echo "Required backup directory does not exist: $directory" >&2
    exit 1
  fi
done
case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute path." >&2; exit 1 ;;
esac
if [[ "$BACKUP_ROOT" == "/" ]]; then
  echo "BACKUP_ROOT must not be the filesystem root." >&2
  exit 1
fi
for command in pg_dump tar age sha256sum rclone; do
  command -v "$command" >/dev/null || {
    echo "Required backup command is unavailable: $command" >&2
    exit 1
  }
done

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
resolved_upload_root="$(realpath "$UPLOAD_ROOT")"
resolved_private_root="$(realpath "$PRIVATE_UPLOAD_ROOT")"
resolved_backup_root="$(realpath "$BACKUP_ROOT")"
if [[ "$resolved_upload_root" == "$resolved_private_root" ]] ||
   [[ "$(basename "$resolved_upload_root")" == "$(basename "$resolved_private_root")" ]]; then
  echo "Public and private upload roots must be distinct and have distinct directory names." >&2
  exit 1
fi
for source_root in "$resolved_upload_root" "$resolved_private_root"; do
  if [[ "$resolved_backup_root" == "$source_root" || "$resolved_backup_root" == "$source_root/"* ||
        "$source_root" == "$resolved_backup_root/"* ]]; then
    echo "BACKUP_ROOT and upload roots must not contain one another." >&2
    exit 1
  fi
done
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
hostname_value="$(hostname -f 2>/dev/null || hostname)"
archive_name="quest-production-${timestamp}.tar.gz.enc"
archive_path="$BACKUP_ROOT/$archive_name"
checksum_path="$archive_path.sha256"
work_directory="$(mktemp -d "$BACKUP_ROOT/.quest-backup-${timestamp}-XXXXXX")"
trap 'rm -rf -- "$work_directory"' EXIT

pg_dump "$DIRECT_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$work_directory/database.dump"

cat > "$work_directory/manifest.txt" <<MANIFEST
created_at_utc=$timestamp
source_host=$hostname_value
database_format=postgres_custom
public_upload_root=$UPLOAD_ROOT
private_upload_root=$PRIVATE_UPLOAD_ROOT
MANIFEST

tar \
  --create \
  --gzip \
  --file="$work_directory/payload.tar.gz" \
  -C "$work_directory" database.dump manifest.txt \
  -C "$(dirname "$resolved_upload_root")" "$(basename "$resolved_upload_root")" \
  -C "$(dirname "$resolved_private_root")" "$(basename "$resolved_private_root")"

age --recipient "$BACKUP_AGE_RECIPIENT" \
  --output "$archive_path" \
  "$work_directory/payload.tar.gz"
(cd "$BACKUP_ROOT" && sha256sum "$archive_name" > "$archive_name.sha256")

rclone copyto "$archive_path" "${BACKUP_RCLONE_REMOTE%/}/$archive_name"
rclone copyto "$checksum_path" "${BACKUP_RCLONE_REMOTE%/}/$archive_name.sha256"
rclone lsf "${BACKUP_RCLONE_REMOTE%/}/$archive_name" >/dev/null
rclone lsf "${BACKUP_RCLONE_REMOTE%/}/$archive_name.sha256" >/dev/null

retention_days="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_LOCAL_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'quest-production-*.tar.gz.enc' -o -name 'quest-production-*.tar.gz.enc.sha256' \) \
  -mtime "+$retention_days" -delete

echo "Encrypted production backup uploaded successfully: $archive_name"
