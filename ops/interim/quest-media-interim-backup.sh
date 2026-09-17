#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${UPLOAD_ROOT:?UPLOAD_ROOT is required}"
: "${PRIVATE_UPLOAD_ROOT:?PRIVATE_UPLOAD_ROOT is required}"
: "${BACKUP_ROOT:?BACKUP_ROOT is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required}"
: "${RCLONE_CONFIG:?RCLONE_CONFIG is required}"

for root in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT" "$BACKUP_ROOT"; do
  [[ "$root" == /* && "$root" != / && -d "$root" && ! -L "$root" ]]
done
[[ "$UPLOAD_ROOT" != "$PRIVATE_UPLOAD_ROOT" ]]
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]]
[[ "$RCLONE_CONFIG" == /* && -f "$RCLONE_CONFIG" && ! -L "$RCLONE_CONFIG" ]]

exec 8>/var/lock/quest-esports-release.lock
flock 8

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_name="quest-media-${stamp}.tar.gz.age"
archive_path="$BACKUP_ROOT/$archive_name"
checksum_path="$archive_path.sha256"
work_dir="$(mktemp -d "$BACKUP_ROOT/.quest-media-${stamp}-XXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT

public_name="$(basename "$UPLOAD_ROOT")"
private_name="$(basename "$PRIVATE_UPLOAD_ROOT")"
[[ "$public_name" != "$private_name" ]]
mkdir -p "$work_dir/$public_name" "$work_dir/$private_name"
rsync -a "$UPLOAD_ROOT/" "$work_dir/$public_name/"
rsync -a "$PRIVATE_UPLOAD_ROOT/" "$work_dir/$private_name/"
rsync -a "$UPLOAD_ROOT/" "$work_dir/$public_name/"
rsync -a "$PRIVATE_UPLOAD_ROOT/" "$work_dir/$private_name/"

{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'snapshot_scope=public_and_private_uploads\n'
  printf 'snapshot_strategy=two_pass_union\n'
  printf 'public_root_name=%s\n' "$public_name"
  printf 'private_root_name=%s\n' "$private_name"
} > "$work_dir/manifest.txt"

tar --create --gzip --file - -C "$work_dir" manifest.txt "$public_name" "$private_name" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$archive_path"
[[ -s "$archive_path" ]]
(cd "$BACKUP_ROOT" && sha256sum "$archive_name" > "$archive_name.sha256")
chown deploy:deploy "$archive_path" "$checksum_path"
rclone copy "$archive_path" "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG"
rclone copy "$checksum_path" "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG"
rclone check "$BACKUP_ROOT" "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG" --one-way \
  --include "/$archive_name" --include "/$archive_name.sha256" >/dev/null

retention_days="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
[[ "$retention_days" =~ ^[0-9]+$ ]]
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'quest-media-*.tar.gz.age' -o -name 'quest-media-*.tar.gz.age.sha256' \) \
  -mtime "+$retention_days" -delete

printf 'Interim encrypted media backup uploaded successfully: %s\n' "$archive_name"
