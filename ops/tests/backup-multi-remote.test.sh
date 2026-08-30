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
printf 'fixture ca\n' > "$TEST_ROOT/ca.crt"
mkdir -p "$TEST_ROOT/backup-client"
printf 'fixture cert\n' > "$TEST_ROOT/backup-client/backup-client.crt"
printf 'fixture key\n' > "$TEST_ROOT/backup-client/backup-client.key"
chmod 600 "$TEST_ROOT/ca.crt"
chmod 750 "$TEST_ROOT/backup-client"
chmod 640 "$TEST_ROOT/backup-client/backup-client.crt" "$TEST_ROOT/backup-client/backup-client.key"
printf 'public fixture\n' > "$UPLOAD_ROOT/public.txt"
printf 'private fixture\n' > "$PRIVATE_ROOT/private.txt"
printf 'fixture\n' > "$TEST_ROOT/primary.conf"
printf 'fixture\n' > "$TEST_ROOT/secondary.conf"

cat > "$FAKE_BIN/flock" <<'FAKE'
#!/usr/bin/env bash
fd="${2:-unknown}"
printf '%s\n' "$fd" >> "$FLOCK_LOG"
target="$(readlink -f "/proc/$$/fd/$fd" 2>/dev/null || true)"
marker="${target}.fixture-lock"
owner="${FLOCK_OWNER_TOKEN:-default}"
if [[ -e "$marker" ]]; then
  [[ "$(cat "$marker")" == "$owner" ]] || exit 1
else
  printf '%s\n' "$owner" > "$marker"
fi
FAKE
cat > "$FAKE_BIN/psql" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then printf 'psql (PostgreSQL) 17.4\n'; exit 0; fi
if [[ "$*" == *current_database* ]]; then printf 'quest|170004|on|quest_backup|172.18.0.2|5432|quest-backup-target\n'; else printf '1\n'; fi
FAKE
cat > "$FAKE_BIN/pg_dump" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then printf 'pg_dump (PostgreSQL) 17.4\n'; exit 0; fi
printf '%s\n' "pg_dump $*" >> "$TEST_ROOT/pg_dump.log"
for argument in "$@"; do
  case "$argument" in --file=*) printf 'fake postgres custom dump\n' > "${argument#--file=}" ;; esac
done
FAKE
cat > "$FAKE_BIN/pg_restore" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then printf 'pg_restore (PostgreSQL) 17.4\n'; fi
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
    remote="$1"
    minimum_age=false
    for argument in "$@"; do
      [[ "$argument" == '--min-age' ]] && minimum_age=true
    done
    while IFS= read -r object_path; do
      object_name="$(basename "$object_path")"
      if [[ "$minimum_age" == true && "$object_name" != quest-production-20200101T000000Z.tar.gz.enc* ]]; then
        continue
      fi
      printf '%s\n' "$object_name"
    done < <(find "$(remote_directory "$remote")" -maxdepth 1 -type f -print)
    ;;
  deletefile)
    if [[ "$(basename "$config")" == "${RCLONE_PARTIAL_DELETE_CONFIG:-}" && "$1" != *.sha256 ]]; then
      exit 1
    fi
    rm -f "$(remote_directory "$1")"
    ;;
  *) exit 2 ;;
esac
FAKE
chmod +x "$FAKE_BIN"/*

ENV_FILE="$TEST_ROOT/backup.env"
cat > "$ENV_FILE" <<EOF
DIRECT_URL=postgresql://quest_backup:fixture@127.0.0.1:55432/quest
UPLOAD_ROOT=$UPLOAD_ROOT
PRIVATE_UPLOAD_ROOT=$PRIVATE_ROOT
BACKUP_ROOT=$BACKUP_ROOT
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES17_BIN=$FAKE_BIN
POSTGRES_CA_FILE=$TEST_ROOT/ca.crt
BACKUP_CLIENT_TLS_DIR=$TEST_ROOT/backup-client
BACKUP_CLIENT_CERT_FILE=$TEST_ROOT/backup-client/backup-client.crt
BACKUP_CLIENT_KEY_FILE=$TEST_ROOT/backup-client/backup-client.key
POSTGRES_TARGET_HOST=127.0.0.1
POSTGRES_TARGET_PORT=55432
POSTGRES_TARGET_DATABASE=quest
POSTGRES_TARGET_MAJOR=17
POSTGRES_TARGET_DATA_ROOT=$BACKUP_ROOT
POSTGRES_TARGET_SENTINEL_COMMAND=$FAKE_BIN/postgres-target
BACKUP_RCLONE_REMOTES='primary=one:production
secondary=two:production'
BACKUP_RCLONE_CONFIGS='primary=$TEST_ROOT/primary.conf
secondary=$TEST_ROOT/secondary.conf'
BACKUP_LOCAL_RETENTION_DAYS=7
BACKUP_MAX_AGE_MINUTES=2160
BACKUP_REMOTE_RETENTION_DAYS=90
BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=2
EOF
cat > "$FAKE_BIN/postgres-target" <<EOF
#!/usr/bin/env bash
printf 'target_kind=postgresql17 database=quest host=127.0.0.1 port=55432 major=17 data_root=%s\n' "$BACKUP_ROOT"
EOF
chmod 700 "$FAKE_BIN/postgres-target"
export PATH="$FAKE_BIN:$PATH" FLOCK_LOG="$TEST_ROOT/flock.log" REMOTE_ROOT FLOCK_OWNER_TOKEN=owner-a TEST_ROOT
REAL_STAT="$(command -v stat)"; export REAL_STAT
cat > "$FAKE_BIN/stat" <<'FAKE'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == %a && "$3" == *backup-client && "$3" != *backup-client.crt && "$3" != *backup-client.key ]]; then
  printf '%s\n' "${BACKUP_DIR_MODE:-750}"
elif [[ "$1" == -c && "$2" == %a && ( "$3" == *backup-client.crt || "$3" == *backup-client.key ) ]]; then
  printf '%s\n' "${BACKUP_TLS_MODE:-640}"
else
  exec "$REAL_STAT" "$@"
fi
FAKE
chmod +x "$FAKE_BIN/stat"
assert_file() { [[ -f "$1" ]] || { printf 'missing fixture file: %s\n' "$1" >&2; exit 1; }; }
assert_contains() { grep -F -- "$1" "$2" >/dev/null || { printf 'missing fixture result\n' >&2; exit 1; }; }
run_backup() { BACKUP_ENV_FILE="$ENV_FILE" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" bash "$ROOT/ops/backup-production.sh" --test-fixture; }

BACKUP_TLS_MODE=600; export BACKUP_TLS_MODE
if run_backup; then
  printf 'expected backup client TLS mode rejection\n' >&2
  exit 1
fi
: > "$FLOCK_LOG"
BACKUP_TLS_MODE=640 BACKUP_DIR_MODE=750; export BACKUP_TLS_MODE BACKUP_DIR_MODE
chmod 700 "$TEST_ROOT/backup-client"
BACKUP_DIR_MODE=700; export BACKUP_DIR_MODE
if run_backup; then
  printf 'expected backup client TLS directory mode rejection\n' >&2
  exit 1
fi
chmod 750 "$TEST_ROOT/backup-client"
BACKUP_DIR_MODE=750; export BACKUP_DIR_MODE
: > "$FLOCK_LOG"
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
[[ "$(sed -n '1p' "$FLOCK_LOG")" == 8 && "$(sed -n '2p' "$FLOCK_LOG")" == 8 &&
   "$(sed -n '3p' "$FLOCK_LOG")" == 9 ]] || exit 1
if FLOCK_OWNER_TOKEN=owner-b run_backup; then
  printf 'expected canonical lock contention\n' >&2
  exit 1
fi
if BACKUP_RELEASE_LOCK_HELD=1 BACKUP_ENV_FILE="$ENV_FILE" \
    BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" \
    bash "$ROOT/ops/backup-production-multi-remote.sh"; then
  printf 'expected spoofed inherited-lock marker to be rejected\n' >&2
  exit 1
fi
duplicate_env="$TEST_ROOT/duplicate.env"
sed "s#secondary=$TEST_ROOT/secondary.conf#secondary=$TEST_ROOT/primary.conf#" \
  "$ENV_FILE" > "$duplicate_env"
if BACKUP_ENV_FILE="$duplicate_env" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/duplicate.lock" \
    bash "$ROOT/ops/backup-production.sh" --test-fixture; then
  printf 'expected duplicate resolved config paths to be rejected\n' >&2
  exit 1
fi

sleep 1
if RCLONE_FAIL_CONFIG=secondary.conf BACKUP_ENV_FILE="$ENV_FILE" \
    BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" bash "$ROOT/ops/backup-production.sh" --test-fixture; then
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

# Populate both disposable remotes with one expired pair and two retained points.
for config in primary.conf secondary.conf; do
  remote_fixture="$REMOTE_ROOT/$config/production"
  mkdir -p "$remote_fixture"
  for object in \
      quest-production-20200101T000000Z.tar.gz.enc \
      quest-production-20260826T000000Z.tar.gz.enc \
      quest-production-20260827T000000Z.tar.gz.enc; do
    printf '%s\n' "$object" > "$remote_fixture/$object"
    printf 'checksum\n' > "$remote_fixture/$object.sha256"
  done
done
prune_output="$TEST_ROOT/prune-output.txt"
BACKUP_ENV_FILE="$ENV_FILE" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/prune.lock" \
  bash "$ROOT/ops/prune-production-backups.sh" > "$prune_output"
assert_contains 'Dry run only.' "$prune_output"
assert_file "$REMOTE_ROOT/primary.conf/production/quest-production-20200101T000000Z.tar.gz.enc"
assert_file "$REMOTE_ROOT/primary.conf/production/quest-production-20200101T000000Z.tar.gz.enc.sha256"
assert_contains 'label secondary' "$prune_output"

# A failed archive deletion retains the complete pair; the other remote still deletes.
if RCLONE_PARTIAL_DELETE_CONFIG=primary.conf RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$ENV_FILE" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/prune.lock" \
    bash "$ROOT/ops/prune-production-backups.sh"; then
  printf 'expected partial deletion to produce a nonzero result\n' >&2
  exit 1
fi
assert_file "$REMOTE_ROOT/primary.conf/production/quest-production-20200101T000000Z.tar.gz.enc"
assert_file "$REMOTE_ROOT/primary.conf/production/quest-production-20200101T000000Z.tar.gz.enc.sha256"
[[ ! -e "$REMOTE_ROOT/secondary.conf/production/quest-production-20200101T000000Z.tar.gz.enc" &&
   ! -e "$REMOTE_ROOT/secondary.conf/production/quest-production-20200101T000000Z.tar.gz.enc.sha256" ]] || exit 1

# Minimum-recovery-point guards are evaluated independently for each remote.
guard_env="$TEST_ROOT/guard.env"
sed 's/BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=2/BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=4/' \
  "$ENV_FILE" > "$guard_env"
if BACKUP_ENV_FILE="$guard_env" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/prune.lock" \
    bash "$ROOT/ops/prune-production-backups.sh" > "$TEST_ROOT/guard-output.txt" 2>&1; then
  printf 'expected per-remote minimum guard failure\n' >&2
  exit 1
fi
assert_contains 'label primary' "$TEST_ROOT/guard-output.txt"
assert_contains 'label secondary' "$TEST_ROOT/guard-output.txt"

# Listing failure on one remote does not prevent the other remote from being inspected.
RCLONE_FAIL_CONFIG=primary.conf BACKUP_ENV_FILE="$ENV_FILE" \
  BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/prune.lock" \
  bash "$ROOT/ops/prune-production-backups.sh" > "$TEST_ROOT/failure-output.txt" 2>&1 || true
assert_contains 'label secondary' "$TEST_ROOT/failure-output.txt"

sleep 1
single_env="$TEST_ROOT/single.env"
sed "/BACKUP_RCLONE_REMOTES=/,/^secondary=/d; /BACKUP_RCLONE_CONFIGS=/,/^secondary=/d" "$ENV_FILE" > "$single_env"
printf '%s\n' "BACKUP_RCLONE_REMOTE=one:production" "RCLONE_CONFIG=$TEST_ROOT/primary.conf" >> "$single_env"
BACKUP_ENV_FILE="$single_env" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/single.lock" \
  bash "$ROOT/ops/backup-production.sh" --test-fixture
printf 'backup multi-remote fixture tests passed\n'
