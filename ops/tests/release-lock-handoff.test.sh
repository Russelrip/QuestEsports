#!/usr/bin/env bash
# Regression test for the release-to-backup lock handoff.
#
# release.sh, cutover.sh, and the host adapter all hold the canonical release
# lock and then invoke the backup and freshness scripts, which take the same
# lock. flock is per open file description, so a child that re-opens the lock
# path (including via /proc/self/fd/N, which is a re-open on Linux rather than a
# dup) blocks against the lock its own parent already holds. The only working
# handoff is to pass the held descriptor down as fd 8 with
# BACKUP_RELEASE_LOCK_HELD=1. Nothing else exercises this path until a real
# release runs, so pin it here.
set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
failures=0
fail() { printf 'not ok: %s\n' "$*" >&2; failures=$((failures + 1)); }
pass() { printf 'ok: %s\n' "$*"; }

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT
lock="$sandbox/quest-esports-release.lock"
: > "$lock"

# 1. Re-opening the lock path under a held lock must fail. This is the defect the
#    controllers used to have, so if this ever starts succeeding the handoff
#    below is no longer the only correct pattern and this test is misleading.
reopen_status=0
(
  exec 9>"$lock"
  flock -n 9 || exit 3
  bash -c 'exec 8>"$1" && flock -n 8' _ "$lock"
) || reopen_status=$?
if (( reopen_status == 3 )); then
  fail 'the outer lock could not be taken'
elif (( reopen_status == 0 )); then
  fail 'a child re-opened and re-locked the held release lock; the handoff assumption is wrong'
else
  pass 'a child cannot re-lock the release lock by re-opening its path'
fi

# 2. The documented handoff must succeed.
handoff_status=0
(
  exec 9>"$lock"
  flock -n 9 || exit 3
  bash -c 'flock -n 8' 8>&9
) || handoff_status=$?
if (( handoff_status == 0 )); then
  pass 'the inherited descriptor handoff succeeds'
else
  fail "the inherited descriptor handoff failed with status $handoff_status"
fi

# 3. The controllers must use that handoff rather than re-opening the path.
for controller in ops/deploy/release.sh ops/deploy/cutover.sh ops/deploy/host-hooks.sh; do
  file="$repository_root/$controller"
  [[ -f "$file" ]] || { fail "missing controller: $controller"; continue; }
  if grep -q 'BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/' "$file"; then
    fail "$controller re-opens the held release lock through /proc/self/fd"
  fi
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    grep -q 'BACKUP_RELEASE_LOCK_HELD=1' <<< "$line" \
      || fail "$controller invokes a backup command without the held-lock handoff: $line"
    grep -q '8>&9' <<< "$line" \
      || fail "$controller invokes a backup command without passing descriptor 8: $line"
  done < <(grep -E '"\$(BACKUP_COMMAND|BACKUP_FRESHNESS_COMMAND)"|"\$\{BACKUP_COMMAND|"\$\{BACKUP_FRESHNESS_COMMAND' "$file" \
    | grep -v '^\s*#' | grep -v 'run_backup_command "' || true)
done
(( failures == 0 )) && pass 'controllers hand the held lock to the backup scripts'

# 4. The backup scripts must accept the handoff instead of re-opening the path.
for script in ops/backup-production.sh ops/check-backup-freshness.sh ops/backup-production-multi-remote.sh; do
  file="$repository_root/$script"
  [[ -f "$file" ]] || { fail "missing backup script: $script"; continue; }
  grep -q 'BACKUP_RELEASE_LOCK_HELD' "$file" || fail "$script does not accept an inherited release lock"
done

# 5. End-to-end: the real preamble of each backup script must get past the lock
#    when it is invoked the way the controllers invoke it.
for script in ops/backup-production.sh ops/check-backup-freshness.sh; do
  file="$repository_root/$script"
  [[ -f "$file" ]] || continue
  output="$(
    exec 9>"$lock"
    flock -n 9 || { printf 'outer-lock-failed\n'; exit 0; }
    BACKUP_ENV_FILE="$sandbox/absent.env" \
      BACKUP_RELEASE_LOCK_PATH="$lock" BACKUP_RELEASE_LOCK_HELD=1 \
      bash "$file" 2>&1 8>&9 || true
  )"
  if grep -qE 'Another release operation is already running|inherited release lock is not held|inherited release lock descriptor is not the canonical lock' <<< "$output"; then
    fail "$script rejected the inherited release lock: $output"
  else
    pass "$script accepts the inherited release lock"
  fi
done

if (( failures > 0 )); then
  printf '%s release lock handoff check(s) failed.\n' "$failures" >&2
  exit 1
fi
printf 'release lock handoff contracts passed.\n'
