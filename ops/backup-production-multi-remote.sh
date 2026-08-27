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

required=(DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_ROOT BACKUP_AGE_RECIPIENT)
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

# Direct execution remains safe for operators and disposable fixture tests.
if [[ "${BACKUP_RELEASE_LOCK_HELD:-}" != 1 ]]; then
  release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
  if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
    echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
    exit 1
  fi
  if ! exec 8>"$release_lock_path" || ! flock -n 8; then
    echo "Another release operation is already running." >&2
    exit 1
  fi
fi

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
    echo "Missing required backup setting: RCLONE_CONFIG" >&2
    exit 1
  fi
  config_by_label[legacy]="$RCLONE_CONFIG"
fi
if [[ -z "$remote_entries" ]]; then
  echo "Missing required backup setting: BACKUP_RCLONE_REMOTES" >&2
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

for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Backup source directories must be absolute paths." >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" ]]; then
    echo "Refusing to archive the filesystem root." >&2
    exit 1
  fi
  if [[ ! -d "$directory" ]]; then
    echo "Required backup directory does not exist." >&2
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
result_path="$BACKUP_ROOT/$archive_name.results"
work_directory="$(mktemp -d "$BACKUP_ROOT/.quest-backup-${timestamp}-XXXXXX")"
trap 'rm -rf -- "$work_directory"' EXIT

if ! valorant_probe="$(psql "$DIRECT_URL" -tAc "SELECT 1 FROM pg_namespace WHERE nspname = 'valorant'" 2>/dev/null)"; then
  echo "valorant schema probe failed" >&2
  exit 1
fi
valorant_schema_exists=false
[[ "$valorant_probe" == "1" ]] && valorant_schema_exists=true

public_name="$(basename "$resolved_upload_root")"
private_name="$(basename "$resolved_private_root")"
mkdir -p "$work_directory/$public_name" "$work_directory/$private_name"
# Two passes around the database dump form a stable union snapshot.
rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

if [[ "$valorant_schema_exists" == true ]]; then
  pg_dump "$DIRECT_URL" --format=custom --schema=public --schema=valorant \
    --no-owner --no-acl --file="$work_directory/database.dump" 2>/dev/null
else
  # Transitional state: retain a public-only snapshot until the second schema exists.
  pg_dump "$DIRECT_URL" --format=custom --schema=public --no-owner --no-acl \
    --file="$work_directory/database.dump" 2>/dev/null
fi
rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

if [[ "$valorant_schema_exists" == true ]]; then
  database_scope=application_public_and_valorant_schemas
else
  database_scope=application_public_schema_only
fi
{
  printf 'created_at_utc=%s\n' "$timestamp"
  printf 'source_host=%s\n' "$hostname_value"
  printf 'database_format=postgres_custom\n'
  printf 'database_scope=%s\n' "$database_scope"
  printf 'valorant_schema_included=%s\n' "$valorant_schema_exists"
  printf 'supabase_managed_schemas_included=false\n'
  printf 'public_upload_root=%s\n' "$UPLOAD_ROOT"
  printf 'private_upload_root=%s\n' "$PRIVATE_UPLOAD_ROOT"
  printf 'file_snapshot_strategy=two_pass_union_around_database_dump\n'
} > "$work_directory/manifest.txt"

tar --create --gzip --file="$work_directory/payload.tar.gz" \
  -C "$work_directory" database.dump manifest.txt "$public_name" "$private_name"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$archive_path" \
  "$work_directory/payload.tar.gz" 2>/dev/null
(cd "$BACKUP_ROOT" && sha256sum "$archive_name" > "$archive_name.sha256")

# This record intentionally contains labels and outcomes, never destinations or configs.
printf 'archive=%s\nremote_label\tstatus\n' "$archive_name" > "$result_path"
remote_failures=0
for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  remote_ok=true
  if ! rclone copyto "$archive_path" "${remote%/}/$archive_name" --config "$config" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if ! rclone copyto "$checksum_path" "${remote%/}/$archive_name.sha256" --config "$config" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if ! rclone check "$BACKUP_ROOT" "${remote%/}" --config "$config" --one-way \
      --include "/$archive_name" --include "/$archive_name.sha256" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if [[ "$remote_ok" == true ]]; then
    printf '%s\tsuccess\n' "$label" >> "$result_path"
  else
    printf '%s\tfailure\n' "$label" >> "$result_path"
    remote_failures=$((remote_failures + 1))
  fi
done
chmod 600 "$result_path"

retention_days="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_LOCAL_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'quest-production-*.tar.gz.enc' -o -name 'quest-production-*.tar.gz.enc.sha256' \) \
  -mtime "+$retention_days" -delete

if (( remote_failures > 0 )); then
  echo "Production backup was created but one or more required remotes failed; see the per-run result record." >&2
  exit 1
fi
echo "Encrypted production backup uploaded successfully: $archive_name"
