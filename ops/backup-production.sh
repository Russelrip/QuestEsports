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
if [[ ! "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]]; then
  echo "BACKUP_AGE_RECIPIENT must be a valid age public recipient." >&2
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
if [[ "$BACKUP_ROOT" == "/" || -L "$BACKUP_ROOT" ]]; then
  echo "BACKUP_ROOT must not be the filesystem root or a symbolic link." >&2
  exit 1
fi
for command in age basename cat chmod date find flock hostname mkdir mktemp pg_dump psql realpath rm rclone rsync sha256sum tar; do
  command -v "$command" >/dev/null || {
    echo "Required backup command is unavailable: $command" >&2
    exit 1
  }
done

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.quest-backup.lock"
if ! flock -n 9; then
  echo "Another production backup is already running." >&2
  exit 1
fi
resolved_upload_root="$(realpath "$UPLOAD_ROOT")"
resolved_private_root="$(realpath "$PRIVATE_UPLOAD_ROOT")"
resolved_backup_root="$(realpath "$BACKUP_ROOT")"
if [[ "$resolved_backup_root" == "/" ]]; then
  echo "Resolved BACKUP_ROOT must not be the filesystem root." >&2
  exit 1
fi
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

if ! valorant_probe="$(psql "$DIRECT_URL" -tAc "SELECT 1 FROM pg_namespace WHERE nspname = 'valorant'")"; then
  echo "valorant schema probe failed" >&2
  exit 1
fi
valorant_schema_exists=false
[[ "$valorant_probe" == "1" ]] && valorant_schema_exists=true

public_name="$(basename "$resolved_upload_root")"
private_name="$(basename "$resolved_private_root")"
mkdir -p "$work_directory/$public_name" "$work_directory/$private_name"

# Uploads use immutable random filenames. Two passes around the database dump create
# a stable union snapshot that includes files committed immediately before or during
# the dump without reading directly from the live trees while archiving.
rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

if [[ "$valorant_schema_exists" == true ]]; then
  pg_dump "$DIRECT_URL" \
    --format=custom \
    --schema=public \
    --schema=valorant \
    --no-owner \
    --no-acl \
    --file="$work_directory/database.dump"
else
  # Transitional state: the VALORANT schema has not been migrated into this
  # project yet; keep a public-only snapshot that is still restorable.
  pg_dump "$DIRECT_URL" \
    --format=custom \
    --schema=public \
    --no-owner \
    --no-acl \
    --file="$work_directory/database.dump"
fi

rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

if [[ "$valorant_schema_exists" == true ]]; then
  database_scope=application_public_and_valorant_schemas
else
  database_scope=application_public_schema_only
fi

cat > "$work_directory/manifest.txt" <<MANIFEST
created_at_utc=$timestamp
source_host=$hostname_value
database_format=postgres_custom
database_scope=$database_scope
valorant_schema_included=$valorant_schema_exists
supabase_managed_schemas_included=false
public_upload_root=$UPLOAD_ROOT
private_upload_root=$PRIVATE_UPLOAD_ROOT
file_snapshot_strategy=two_pass_union_around_database_dump
MANIFEST

tar \
  --create \
  --gzip \
  --file="$work_directory/payload.tar.gz" \
  -C "$work_directory" database.dump manifest.txt "$public_name" "$private_name"

age --recipient "$BACKUP_AGE_RECIPIENT" \
  --output "$archive_path" \
  "$work_directory/payload.tar.gz"
(cd "$BACKUP_ROOT" && sha256sum "$archive_name" > "$archive_name.sha256")

rclone copyto "$archive_path" "${BACKUP_RCLONE_REMOTE%/}/$archive_name" --config "$RCLONE_CONFIG"
rclone copyto "$checksum_path" "${BACKUP_RCLONE_REMOTE%/}/$archive_name.sha256" --config "$RCLONE_CONFIG"
rclone check "$BACKUP_ROOT" "${BACKUP_RCLONE_REMOTE%/}" \
  --config "$RCLONE_CONFIG" \
  --one-way \
  --include "/$archive_name" \
  --include "/$archive_name.sha256"

retention_days="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_LOCAL_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'quest-production-*.tar.gz.enc' -o -name 'quest-production-*.tar.gz.enc.sha256' \) \
  -mtime "+$retention_days" -delete

echo "Encrypted production backup uploaded successfully: $archive_name"
