#!/usr/bin/env bash
set -euo pipefail
umask 077

# Keep descriptor 8 open across exec. The implementation script acquires the
# nested backup lock only after this canonical release lock is held.
release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
# The release controller already holds this lock and hands its descriptor down
# on fd 8; re-opening the same path would deadlock against that held lock.
if [[ "${BACKUP_RELEASE_LOCK_HELD:-}" == 1 ]]; then
  expected_lock_target="$(readlink -f "$release_lock_path" 2>/dev/null || true)"
  inherited_lock_target="$(readlink -f /proc/self/fd/8 2>/dev/null || true)"
  if [[ -z "$expected_lock_target" || "$expected_lock_target" != "$inherited_lock_target" ]]; then
    echo "The inherited release lock descriptor is not the canonical lock." >&2
    exit 1
  fi
  if ! flock -n 8; then
    echo "The inherited release lock is not held." >&2
    exit 1
  fi
else
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
fi

export BACKUP_RELEASE_LOCK_HELD=1
script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "$script_directory/backup-production-multi-remote.sh" "$@"
