#!/usr/bin/env bash
set -euo pipefail
umask 077

# Keep descriptor 8 open across exec. The implementation script acquires the
# nested backup lock only after this canonical release lock is held.
release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
  echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
  exit 1
fi
if ! exec 8>"$release_lock_path"; then
  echo "The canonical release lock is not writable." >&2
  exit 1
fi
if ! flock -n 8; then
  echo "Another release operation is already running." >&2
  exit 1
fi

export BACKUP_RELEASE_LOCK_HELD=1
script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "$script_directory/backup-production-multi-remote.sh"
