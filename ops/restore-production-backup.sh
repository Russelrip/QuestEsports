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
for command in age basename cat cut date dirname grep mkdir mktemp mv pg_restore realpath rm rsync sha256sum sleep tar; do
  command -v "$command" >/dev/null || {
    echo "Required restore command is unavailable: $command" >&2
    exit 1
  }
done
if [[ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]]; then
  echo "The age identity is not readable: $BACKUP_AGE_IDENTITY_FILE" >&2
  exit 1
fi
if [[ "$(basename "$UPLOAD_ROOT")" == "$(basename "$PRIVATE_UPLOAD_ROOT")" ]]; then
  echo "Public and private upload roots must have distinct directory names." >&2
  exit 1
fi
for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Restore directories must be absolute paths: $directory" >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" || -L "$directory" ]]; then
    echo "Restore directories must not be the filesystem root or symbolic links: $directory" >&2
    exit 1
  fi
done
if [[ ! -f "$archive_path" || ! -f "$archive_path.sha256" ]]; then
  echo "The encrypted archive and its .sha256 file are both required." >&2
  exit 1
fi

countdown_seconds="${RESTORE_COUNTDOWN_SECONDS:-10}"
if [[ ! "$countdown_seconds" =~ ^[0-9]+$ ]]; then
  echo "RESTORE_COUNTDOWN_SECONDS must be a non-negative integer." >&2
  exit 1
fi

work_directory="$(mktemp -d)"
public_stage=""
private_stage=""
resolved_upload_root=""
resolved_private_root=""
public_previous=""
private_previous=""
public_activated=false
private_activated=false

rollback_activated_directory() {
  local target_path="$1"
  local previous_path="$2"
  local label="$3"
  local failed_path=""
  if [[ -n "$target_path" && -e "$target_path" ]]; then
    failed_path="$(dirname "$target_path")/.quest-failed-$(basename "$target_path")-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    if mv -- "$target_path" "$failed_path"; then
      echo "Rolled back $label activation; failed restored tree retained at: $failed_path" >&2
    else
      echo "URGENT: could not move the activated $label tree out of the restore target: $target_path" >&2
      return 1
    fi
  fi
  if [[ -n "$previous_path" && -e "$previous_path" ]]; then
    mv -- "$previous_path" "$target_path" || {
      echo "URGENT: could not restore the previous $label tree from: $previous_path" >&2
      return 1
    }
  fi
}

cleanup() {
  local exit_status=$?
  set +e
  if [[ "$private_activated" == true ]]; then
    rollback_activated_directory "$resolved_private_root" "$private_previous" "private"
  fi
  if [[ "$public_activated" == true ]]; then
    rollback_activated_directory "$resolved_upload_root" "$public_previous" "public"
  fi
  rm -rf -- "$work_directory"
  [[ -z "$public_stage" ]] || rm -rf -- "$public_stage"
  [[ -z "$private_stage" ]] || rm -rf -- "$private_stage"
  return "$exit_status"
}
trap cleanup EXIT

(cd "$(dirname "$archive_path")" && sha256sum --check "$(basename "$archive_path").sha256")
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" \
  --output "$work_directory/payload.tar.gz" \
  "$archive_path"

# Reject paths that could escape the temporary extraction directory before extracting.
if tar --list --gzip --file="$work_directory/payload.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "The backup contains an unsafe archive path." >&2
  exit 1
fi
tar --extract --gzip --no-same-owner --no-same-permissions \
  --file="$work_directory/payload.tar.gz" --directory="$work_directory"
test -f "$work_directory/database.dump"
test -f "$work_directory/manifest.txt"
pg_restore --list "$work_directory/database.dump" >/dev/null

public_name="$(basename "$UPLOAD_ROOT")"
private_name="$(basename "$PRIVATE_UPLOAD_ROOT")"
manifest_public_root="$(grep -m1 '^public_upload_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
manifest_private_root="$(grep -m1 '^private_upload_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
if [[ -z "$manifest_public_root" || -z "$manifest_private_root" ||
      "$(basename "$manifest_public_root")" != "$public_name" ||
      "$(basename "$manifest_private_root")" != "$private_name" ]]; then
  echo "The backup manifest does not match the configured upload directory names." >&2
  exit 1
fi
test -d "$work_directory/$public_name"
test -d "$work_directory/$private_name"

mkdir -p "$(dirname "$UPLOAD_ROOT")" "$(dirname "$PRIVATE_UPLOAD_ROOT")"
resolved_upload_root="$(realpath -m "$UPLOAD_ROOT")"
resolved_private_root="$(realpath -m "$PRIVATE_UPLOAD_ROOT")"
if [[ "$resolved_upload_root" == "$resolved_private_root" ||
      "$resolved_upload_root" == "$resolved_private_root/"* ||
      "$resolved_private_root" == "$resolved_upload_root/"* ]]; then
  echo "Restore targets must be distinct and must not contain one another." >&2
  exit 1
fi

# Build complete replacement trees on the target filesystems before touching the database.
public_stage="$(mktemp -d "$(dirname "$resolved_upload_root")/.quest-restore-${public_name}-XXXXXX")"
private_stage="$(mktemp -d "$(dirname "$resolved_private_root")/.quest-restore-${private_name}-XXXXXX")"
rsync -a --delete "$work_directory/$public_name/" "$public_stage/"
rsync -a --delete "$work_directory/$private_name/" "$private_stage/"
chmod 700 "$private_stage"

echo "Restore manifest:"
cat "$work_directory/manifest.txt"
echo "File activation and a transactional database restore begin in ${countdown_seconds} seconds. Press Ctrl+C to abort." >&2
sleep "$countdown_seconds"

swap_directory() {
  local stage_path="$1"
  local target_path="$2"
  local previous_variable="$3"
  local previous_path=""
  if [[ -e "$target_path" ]]; then
    previous_path="$(dirname "$target_path")/.quest-previous-$(basename "$target_path")-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mv -- "$target_path" "$previous_path"
  fi
  if ! mv -- "$stage_path" "$target_path"; then
    [[ -z "$previous_path" ]] || mv -- "$previous_path" "$target_path"
    return 1
  fi
  printf -v "$previous_variable" '%s' "$previous_path"
}

swap_directory "$public_stage" "$resolved_upload_root" public_previous
public_stage=""
public_activated=true
if ! swap_directory "$private_stage" "$resolved_private_root" private_previous; then
  echo "Private file activation failed; the exit guard will roll back the public file tree." >&2
  exit 1
fi
private_stage=""
private_activated=true
chmod 700 "$resolved_private_root"

if ! pg_restore --dbname="$DIRECT_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --single-transaction \
  "$work_directory/database.dump"; then
  echo "Database restore failed; the exit guard will roll back both activated file trees." >&2
  exit 1
fi

public_activated=false
private_activated=false
echo "Restore completed. Restart the API and run the production verification checklist."
[[ -z "$public_previous" ]] || echo "Previous public files retained at: $public_previous"
[[ -z "$private_previous" ]] || echo "Previous private files retained at: $private_previous"
