#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quest-backup-fixture.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
FAKE_BIN="$TEST_ROOT/bin"
UPLOAD_ROOT="$TEST_ROOT/uploads"
PRIVATE_ROOT="$TEST_ROOT/private"
BACKUP_ROOT="$TEST_ROOT/backups"
REMOTE_ROOT="$TEST_ROOT/remotes"
mkdir -p "$FAKE_BIN" "$UPLOAD_ROOT" "$PRIVATE_ROOT" "$BACKUP_ROOT" "$REMOTE_ROOT"
printf 'public fixture\n' > "$UPLOAD_ROOT/public.txt"
printf 'private fixture\n' > "$PRIVATE_ROOT/private.txt"
printf 'fixture\n' > "$TEST_ROOT/primary.conf"
printf 'fixture\n' > "$TEST_ROOT/secondary.conf"

cat > "$FAKE_BIN/flock" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "${2:-unknown}" >> "$FLOCK_LOG"
FAKE
cat > "$FAKE_BIN/psql" <<'FAKE'
#!/usr/bin/env bash
printf '1\n'
FAKE
cat > "$FAKE_BIN/pg_dump" <<'FAKE'
#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in --file=*) printf 'fake postgres custom dump\n' > "${argument#--file=}" ;; esac
done
FAKE
cat > "$FAKE_BIN/age" <<'FAKE'
#!/usr/bin/env bash
output=''
input=''
while (($#)); do
  case "$1" in --output) output="$2"; shift 2 ;; *) input="$1"; shift ;; esac
done
cp -- "$input" "$output"
FAKE
cat > "$FAKE_BIN/rsync" <<'FAKE'
#!/usr/bin/env bash
[[ "$1" == '-a' ]] && shift
mkdir -p "${2%/}"
cp -a -- "${1%/}/." "${2%/}/"
FAKE
cat > "$FAKE_BIN/rclone" <<'FAKE'
#!/usr/bin/env bash
set -u
operation="$1"
shift
config=''
for ((index = 1; index <= $#; index++)); do
  if [[ "${!index}" == '--config' ]]; then
    next=$((index + 1))
    config="${!next}"
  fi
done
if [[ "$(basename "$config")" == "${RCLONE_FAIL_CONFIG:-}" ]]; then exit 1; fi
remote_directory() { printf '%s/%s/%s' "$REMOTE_ROOT" "$(basename "$config")" "${1#*:}"; }
case "$operation" in
  copyto)
    target="$2"
    mkdir -p "$(remote_directory "${target%/*}")"
    cp -- "$1" "$(remote_directory "$target")"
    ;;
  check)
    source_directory="$1"
    remote="$2"
    shift 2
    while (($#)); do
      if [[ "$1" == '--include' ]]; then
        name="${2#/}"
        cmp -s "$source_directory/$name" "$(remote_directory "$remote")/$name" || exit 1
        shift 2
      else
        shift
      fi
    done
    ;;
  lsf)
    find "$(remote_directory "$1")" -maxdepth 1 -type f -printf '%f\n'
    ;;
  deletefile) rm -f "$(remote_directory "$1")" ;;
  *) exit 2 ;;
esac
FAKE
chmod +x "$FAKE_BIN"/*

ENV_FILE="$TEST_ROOT/backup.env"
cat > "$ENV_FILE" <<EOF
DIRECT_URL=postgresql://fixture.invalid/not-a-real-database
UPLOAD_ROOT=$UPLOAD_ROOT
PRIVATE_UPLOAD_ROOT=$PRIVATE_ROOT
BACKUP_ROOT=$BACKUP_ROOT
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BACKUP_RCLONE_REMOTES='primary=one:production
secondary=two:production'
BACKUP_RCLONE_CONFIGS='primary=$TEST_ROOT/primary.conf
secondary=$TEST_ROOT/secondary.conf'
BACKUP_LOCAL_RETENTION_DAYS=7
BACKUP_MAX_AGE_MINUTES=2160
BACKUP_REMOTE_RETENTION_DAYS=90
BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=2
EOF
export PATH="$FAKE_BIN:$PATH" FLOCK_LOG="$TEST_ROOT/flock.log" REMOTE_ROOT
assert_file() { [[ -f "$1" ]] || { printf 'missing fixture file\n' >&2; exit 1; }; }
assert_contains() { grep -F -- "$1" "$2" >/dev/null || { printf 'missing fixture result\n' >&2; exit 1; }; }
run_backup() { BACKUP_ENV_FILE="$ENV_FILE" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" bash "$ROOT/ops/backup-production.sh"; }

run_backup
archive_path="$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'quest-production-*.tar.gz.enc' -print -quit)"
assert_file "$archive_path"
archive_name="$(basename "$archive_path")"
assert_file "$BACKUP_ROOT/$archive_name.sha256"
assert_file "$REMOTE_ROOT/primary.conf/production/$archive_name"
assert_file "$REMOTE_ROOT/secondary.conf/production/$archive_name"
assert_file "$REMOTE_ROOT/primary.conf/production/$archive_name.sha256"
assert_file "$REMOTE_ROOT/secondary.conf/production/$archive_name.sha256"
assert_contains $'primary\tsuccess' "$BACKUP_ROOT/$archive_name.results"
assert_contains $'secondary\tsuccess' "$BACKUP_ROOT/$archive_name.results"
[[ "$(sed -n '1p' "$FLOCK_LOG")" == 8 && "$(sed -n '2p' "$FLOCK_LOG")" == 9 ]] || exit 1

sleep 1
if RCLONE_FAIL_CONFIG=secondary.conf BACKUP_ENV_FILE="$ENV_FILE" \
    BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" bash "$ROOT/ops/backup-production.sh"; then
  printf 'expected failed remote\n' >&2
  exit 1
fi
failed_result="$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name '*.results' -print | tail -n 1)"
assert_contains $'primary\tsuccess' "$failed_result"
assert_contains $'secondary\tfailure' "$failed_result"

if RCLONE_FAIL_CONFIG=secondary.conf BACKUP_ENV_FILE="$ENV_FILE" \
    BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/freshness.lock" bash "$ROOT/ops/check-backup-freshness.sh"; then
  printf 'expected required-remote freshness failure\n' >&2
  exit 1
fi
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'quest-production-*.tar.gz.enc' \
  ! -path "$archive_path" -delete
printf 'tampered fixture archive\n' > "$archive_path"
if BACKUP_ENV_FILE="$ENV_FILE" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/freshness.lock" \
    bash "$ROOT/ops/check-backup-freshness.sh"; then
  printf 'expected checksum verification failure\n' >&2
  exit 1
fi

sleep 1
single_env="$TEST_ROOT/single.env"
sed "/BACKUP_RCLONE_REMOTES=/,/^secondary=/d; /BACKUP_RCLONE_CONFIGS=/,/^secondary=/d" "$ENV_FILE" > "$single_env"
printf '%s\n' "BACKUP_RCLONE_REMOTE=one:production" "RCLONE_CONFIG=$TEST_ROOT/primary.conf" >> "$single_env"
BACKUP_ENV_FILE="$single_env" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/single.lock" \
  bash "$ROOT/ops/backup-production.sh"
printf 'backup multi-remote fixture tests passed\n'
