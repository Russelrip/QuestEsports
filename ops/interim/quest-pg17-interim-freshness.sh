#!/usr/bin/env bash
set -euo pipefail
umask 077
# release.sh invokes this with BACKUP_ENV_FILE instead of systemd EnvironmentFile,
# so load the configuration here exactly as quest-pg17-backup.sh does.
set -a; . "${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"; set +a

: "${BACKUP_ROOT:?BACKUP_ROOT is required}"
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required}"
: "${RCLONE_CONFIG:?RCLONE_CONFIG is required}"
[[ "$BACKUP_ROOT" == /* && "$BACKUP_ROOT" != / && -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]]
[[ "$RCLONE_CONFIG" == /* && -f "$RCLONE_CONFIG" && ! -L "$RCLONE_CONFIG" ]]

check_fresh_backup() {
  local pattern="$1" label="$2" latest_line latest modified now max_age
  latest_line="$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %f\n' | sort -nr | head -n 1)"
  [[ -n "$latest_line" ]]
  latest="${latest_line#* }"
  modified="${latest_line%% *}"
  modified="${modified%%.*}"
  now="$(date -u +%s)"
  max_age="${BACKUP_INTERIM_MAX_AGE_SECONDS:-129600}"
  [[ "$max_age" =~ ^[0-9]+$ && "$max_age" -gt 0 ]]
  (( now - modified <= max_age ))
  (cd "$BACKUP_ROOT" && sha256sum -c "$latest.sha256" >/dev/null)
  rclone check "$BACKUP_ROOT" "$BACKUP_RCLONE_REMOTE" \
    --config "$RCLONE_CONFIG" --one-way \
    --include "/$latest" --include "/$latest.sha256" >/dev/null
  printf '%s backup is fresh and off-site: %s\n' "$label" "$latest"
}

check_fresh_backup 'quest-pg17-*.dump.age' database
check_fresh_backup 'quest-media-*.tar.gz.age' media
