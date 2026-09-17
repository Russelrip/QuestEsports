#!/usr/bin/env bash
# Remote quota alarm: passes with headroom, and fails per remote on low space,
# an unreadable remote, a remote that hides its free space, or a bad threshold.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quest-quota-fixture.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FAKE_BIN"
export PATH="$FAKE_BIN:$PATH"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$1" "$2" || { cat "$2" >&2; fail "expected '$1' in $2"; }; }

# Free bytes per config come from FREE_<config basename without .conf>.
cat > "$FAKE_BIN/rclone" <<'FAKE'
#!/usr/bin/env bash
set -u
[[ "$1" == about ]] || exit 2
target="$2"
config=''
json=false
shift 2
while (($#)); do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    --json) json=true; shift ;;
    *) exit 2 ;;
  esac
done
[[ "$json" == true && "$target" =~ ^[a-z]+:$ ]] || exit 2
name="$(basename "$config" .conf)"
[[ "$name" == "${RCLONE_FAIL_CONFIG:-}" ]] && exit 1
free_variable="FREE_$name"
# Exactly the shape rclone 1.60 prints: pretty, tab-indented, one field per line.
if [[ "$name" == "${RCLONE_NO_FREE_CONFIG:-}" ]]; then
  printf '{\n\t"used": 1073741824\n}\n'
else
  printf '{\n\t"total": 16106127360,\n\t"used": 3177545728,\n\t"trashed": 0,\n\t"other": 58271744,\n\t"free": %s\n}\n' "${!free_variable}"
fi
FAKE
chmod +x "$FAKE_BIN/rclone"
printf 'fixture\n' > "$TEST_ROOT/primary.conf"
printf 'fixture\n' > "$TEST_ROOT/secondary.conf"
cat > "$TEST_ROOT/backup.env" <<EOF
BACKUP_RCLONE_REMOTES='primary=one:quest-esports-v2/production
secondary=two:quest-esports-v2/production'
BACKUP_RCLONE_CONFIGS='primary=$TEST_ROOT/primary.conf
secondary=$TEST_ROOT/secondary.conf'
EOF
check() { BACKUP_ENV_FILE="$TEST_ROOT/backup.env" bash "$ROOT/ops/check-backup-remote-quota.sh" > "$TEST_ROOT/out.txt" 2>&1; }
plenty=12869828608
low=1073741824

FREE_primary=$plenty FREE_secondary=$plenty check || { cat "$TEST_ROOT/out.txt" >&2; fail "healthy remotes failed"; }
assert_contains 'Remote label primary: 11.99 GiB free of 15.00 GiB, 2.96 GiB used, 0.00 GiB in trash.' "$TEST_ROOT/out.txt"
assert_contains 'Remote label secondary: 11.99 GiB free' "$TEST_ROOT/out.txt"

if FREE_primary=$plenty FREE_secondary=$low check; then fail "low space passed"; fi
assert_contains 'Low space on remote label secondary: 1.00 GiB free is below the 2 GiB minimum.' "$TEST_ROOT/out.txt"
assert_contains 'Remote label primary: 11.99 GiB free' "$TEST_ROOT/out.txt"

if FREE_primary=$plenty FREE_secondary=$plenty BACKUP_REMOTE_MIN_FREE_GIB=12 check; then fail "threshold was ignored"; fi
assert_contains 'below the 12 GiB minimum' "$TEST_ROOT/out.txt"

if FREE_primary=$plenty FREE_secondary=$plenty RCLONE_FAIL_CONFIG=primary check; then fail "unreadable remote passed"; fi
assert_contains 'Could not read storage usage for remote label: primary' "$TEST_ROOT/out.txt"
assert_contains 'Remote label secondary: 11.99 GiB free' "$TEST_ROOT/out.txt"

if FREE_primary=$plenty FREE_secondary=$plenty RCLONE_NO_FREE_CONFIG=secondary check; then fail "missing free space passed"; fi
assert_contains 'Remote label secondary does not report free space' "$TEST_ROOT/out.txt"

for bad in 0 -1 two; do
  if FREE_primary=$plenty FREE_secondary=$plenty BACKUP_REMOTE_MIN_FREE_GIB=$bad check; then fail "accepted threshold $bad"; fi
  assert_contains 'BACKUP_REMOTE_MIN_FREE_GIB must be a positive integer.' "$TEST_ROOT/out.txt"
done

printf 'backup-quota tests passed\n'
