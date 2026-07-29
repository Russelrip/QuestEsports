#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${RESTORE_CONFIRMATION:-}" != "RESTORE_QUEST_PRODUCTION" ]]; then
  echo "Set RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION for an intentional restore." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: restore-production-backup.sh /absolute/path/to/quest-production-*.tar.gz.enc" >&2
  exit 1
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Restore configuration is not readable: $BACKUP_ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

archive_path="$1"
case "$archive_path" in
  /*) ;;
  *) echo "The backup path must be absolute." >&2; exit 1 ;;
esac
for name in DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_AGE_IDENTITY_FILE; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required restore setting: $name" >&2
    exit 1
  fi
done
if [[ "$(basename "$UPLOAD_ROOT")" == "$(basename "$PRIVATE_UPLOAD_ROOT")" ]]; then
  echo "Public and private upload roots must have distinct directory names." >&2
  exit 1
fi
for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Restore directories must be absolute paths: $directory" >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" ]]; then
    echo "Refusing to restore files into the filesystem root." >&2
    exit 1
  fi
done
if [[ ! -f "$archive_path" || ! -f "$archive_path.sha256" ]]; then
  echo "The encrypted archive and its .sha256 file are both required." >&2
  exit 1
fi

(cd "$(dirname "$archive_path")" && sha256sum --check "$(basename "$archive_path").sha256")
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" \
  --output "$work_directory/payload.tar.gz" \
  "$archive_path"
tar --extract --gzip --file="$work_directory/payload.tar.gz" --directory="$work_directory"
test -f "$work_directory/database.dump"
test -f "$work_directory/manifest.txt"

echo "Restore manifest:"
cat "$work_directory/manifest.txt"
echo "Database restore begins in 10 seconds. Press Ctrl+C to abort." >&2
sleep 10
pg_restore "$DIRECT_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$work_directory/database.dump"

public_name="$(basename "$UPLOAD_ROOT")"
private_name="$(basename "$PRIVATE_UPLOAD_ROOT")"
test -d "$work_directory/$public_name"
test -d "$work_directory/$private_name"
mkdir -p "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"
resolved_upload_root="$(realpath "$UPLOAD_ROOT")"
resolved_private_root="$(realpath "$PRIVATE_UPLOAD_ROOT")"
if [[ "$resolved_upload_root" == "$resolved_private_root" ||
      "$resolved_upload_root" == "$resolved_private_root/"* ||
      "$resolved_private_root" == "$resolved_upload_root/"* ]]; then
  echo "Restore targets must be distinct and must not contain one another." >&2
  exit 1
fi
rsync -a --delete "$work_directory/$public_name/" "$UPLOAD_ROOT/"
rsync -a --delete "$work_directory/$private_name/" "$PRIVATE_UPLOAD_ROOT/"
chmod 700 "$PRIVATE_UPLOAD_ROOT"
echo "Restore completed. Restart the API and run the production verification checklist."
