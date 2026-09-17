#!/usr/bin/env bash
# Tiered off-site retention: which pairs each family keeps, pins and rehearsal
# evidence, trash-then-empty deletion, and the per-remote failure guards.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quest-retention-fixture.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
FAKE_BIN="$TEST_ROOT/bin"
REMOTE_ROOT="$TEST_ROOT/remotes"
EVIDENCE_ROOT="$TEST_ROOT/recovery"
mkdir -p "$FAKE_BIN" "$REMOTE_ROOT" "$EVIDENCE_ROOT"
export REMOTE_ROOT PATH="$FAKE_BIN:$PATH"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$1" "$2" || { sed -n '1,200p' "$2" >&2; fail "expected '$1' in $2"; }; }
assert_not_contains() { ! grep -Fq -- "$1" "$2" || fail "did not expect '$1' in $2"; }

cat > "$FAKE_BIN/flock" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
# A directory-backed Drive: live objects at the top, trashed objects under .trash.
cat > "$FAKE_BIN/rclone" <<'FAKE'
#!/usr/bin/env bash
set -u
operation="$1"
shift
config=''
trashed_only=false
use_trash=true
positional=()
while (($#)); do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    --drive-trashed-only) trashed_only=true; shift ;;
    --drive-use-trash=false) use_trash=false; shift ;;
    --drive-use-trash=true) shift ;;
    --format|--separator|--max-depth) shift 2 ;;
    --*) shift ;;
    *) positional+=("$1"); shift ;;
  esac
done
config_name="$(basename "$config")"
[[ "$config_name" == "${RCLONE_FAIL_CONFIG:-}" ]] && exit 1
directory() { printf '%s/%s/%s' "$REMOTE_ROOT" "$config_name" "${1#*:}"; }
case "$operation" in
  lsf)
    listed="$(directory "${positional[0]}")"
    [[ "$trashed_only" == true ]] && listed="$listed/.trash"
    mkdir -p "$listed"
    find "$listed" -maxdepth 1 -type f -printf '%s|%f\n'
    ;;
  deletefile)
    object="$(directory "${positional[0]}")"
    parent="$(dirname "$object")"
    name="$(basename "$object")"
    if [[ "$config_name" == "${RCLONE_PARTIAL_DELETE_CONFIG:-}" && "$name" != *.sha256 ]]; then exit 1; fi
    if [[ "$trashed_only" == true ]]; then
      [[ "$use_trash" == false && -f "$parent/.trash/$name" ]] || exit 1
      rm -f -- "$parent/.trash/$name"
    else
      [[ -f "$object" ]] || exit 1
      mkdir -p "$parent/.trash"
      mv -- "$object" "$parent/.trash/$name"
    fi
    ;;
  *) exit 2 ;;
esac
FAKE
chmod +x "$FAKE_BIN"/*
printf 'fixture\n' > "$TEST_ROOT/primary.conf"
printf 'fixture\n' > "$TEST_ROOT/secondary.conf"

pair() {
  local directory="$1" name="$2"
  printf '%s\n' "$name" > "$directory/$name"
  printf 'checksum  %s\n' "$name" > "$directory/$name.sha256"
}
populate() {
  local directory="$REMOTE_ROOT/$1/production" day
  mkdir -p "$directory"
  for offset in $(seq 0 110); do
    day="$(date -u -d "2026-09-17 - $offset days" +%Y%m%d)"
    pair "$directory" "quest-pg17-${day}T024500Z.dump.age"
  done
  pair "$directory" quest-pg17-20260911T180000Z.dump.age
  for offset in $(seq 0 47); do
    day="$(date -u -d "2026-09-17 - $offset days" +%Y%m%d)"
    pair "$directory" "quest-media-${day}T031500Z.tar.gz.age"
  done
  pair "$directory" quest-media-20260916T100000Z.tar.gz.age
  for stamp in 20260915T133344Z 20260908T165530Z 20260903T165638Z 20260820T120000Z 20260810T120000Z 20260725T120000Z; do
    pair "$directory" "quest-production-$stamp.tar.gz.enc"
  done
  pair "$directory" quest-adoption-1c4ccda1bc0455acf917ebf566c85363d25be7c8-20260903T111422Z.dump.age
  pair "$directory" quest-adoption-1c4ccda1bc0455acf917ebf566c85363d25be7c8-20260903T112030Z.dump.age
  pair "$directory" quest-legacy-media-20260827T191544Z.tar.gz.enc
  printf 'incomplete\n' > "$directory/quest-pg17-20200101T000000Z.dump.age"
  printf 'orphan\n' > "$directory/quest-media-20200101T000000Z.tar.gz.age.sha256"
  printf 'not a backup\n' > "$directory/notes.txt"
}
populate primary.conf
populate secondary.conf

mkdir -p "$EVIDENCE_ROOT/rehearsal-evidence" "$EVIDENCE_ROOT/rehearsal-evidence-20260820" \
  "$EVIDENCE_ROOT/rehearsal-evidence-20260725" "$EVIDENCE_ROOT/rehearsal-archive"
printf 'archive=/secure/archives/quest-production-20260915T133344Z.tar.gz.enc\n' > "$EVIDENCE_ROOT/rehearsal-evidence/summary"
printf 'archive=quest-production-20260820T120000Z.tar.gz.enc\n' > "$EVIDENCE_ROOT/rehearsal-evidence-20260820/summary"
printf 'archive=quest-production-20260725T120000Z.tar.gz.enc\n' > "$EVIDENCE_ROOT/rehearsal-evidence-20260725/summary"
# A staged archive copy is not evidence and must not protect anything.
printf 'quest-production-20260810T120000Z.tar.gz.enc\n' > "$EVIDENCE_ROOT/rehearsal-archive/staged"

ENV_FILE="$TEST_ROOT/backup.env"
cat > "$ENV_FILE" <<EOF
BACKUP_RCLONE_REMOTES='primary=one:production
secondary=two:production'
BACKUP_RCLONE_CONFIGS='primary=$TEST_ROOT/primary.conf
secondary=$TEST_ROOT/secondary.conf'
BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=2
BACKUP_RETAIN_REHEARSAL_BOUND=2
BACKUP_REHEARSAL_EVIDENCE_ROOT=$EVIDENCE_ROOT
BACKUP_RETENTION_PINS='quest-production-20260903T165638Z.tar.gz.enc until=2026-12-02
quest-adoption-1c4ccda1bc0455acf917ebf566c85363d25be7c8-20260903T112030Z.dump.age until=2026-12-02
quest-legacy-media-20260827T191544Z.tar.gz.enc until=2026-09-10'
EOF
run_prune() {
  BACKUP_ENV_FILE="${PRUNE_ENV:-$ENV_FILE}" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" \
    BACKUP_RETENTION_NOW=20260917T120000Z bash "$ROOT/ops/prune-production-backups.sh" "$@"
}
live() { printf '%s/%s/production/%s' "$REMOTE_ROOT" "$1" "$2"; }
trashed() { printf '%s/%s/production/.trash/%s' "$REMOTE_ROOT" "$1" "$2"; }

snapshot="$TEST_ROOT/before.txt"
(cd "$REMOTE_ROOT" && find . -type f | sort) > "$snapshot"
dry="$TEST_ROOT/dry.txt"
run_prune > "$dry"
diff -q "$snapshot" <(cd "$REMOTE_ROOT" && find . -type f | sort) >/dev/null || fail "dry run changed a remote"
assert_contains 'Dry run only.' "$dry"
for label in primary secondary; do
  # Database: every dump younger than 35 days, then the newest per ISO week to 90 days.
  assert_contains "Would keep recovery pair for label $label: quest-pg17-20260917T024500Z.dump.age" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-pg17-20260814T024500Z.dump.age (database-recent)" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-pg17-20260911T180000Z.dump.age (database-recent)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-pg17-20260813T024500Z.dump.age and checksum" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-pg17-20260809T024500Z.dump.age (database-weekly)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-pg17-20260808T024500Z.dump.age and checksum" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-pg17-20260621T024500Z.dump.age (database-weekly)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-pg17-20260620T024500Z.dump.age and checksum" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-pg17-20260614T024500Z.dump.age and checksum" "$dry"
  # Media: newest per day for seven days, newest per ISO week for four weeks.
  assert_contains "Would keep recovery pair for label $label: quest-media-20260916T100000Z.tar.gz.age" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-media-20260916T031500Z.tar.gz.age and checksum" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-media-20260911T031500Z.tar.gz.age (media-daily)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-media-20260910T031500Z.tar.gz.age and checksum" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-media-20260906T031500Z.tar.gz.age (media-weekly)" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-media-20260830T031500Z.tar.gz.age (media-weekly)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-media-20260823T031500Z.tar.gz.age and checksum" "$dry"
  # Release archives: recent, rehearsal-bound (newest two named by evidence), or pinned.
  assert_contains "Would keep recovery pair for label $label: quest-production-20260908T165530Z.tar.gz.enc (minimum-recovery-point,release-recent)" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-production-20260820T120000Z.tar.gz.enc (rehearsal-bound)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-production-20260725T120000Z.tar.gz.enc and checksum" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-production-20260810T120000Z.tar.gz.enc and checksum" "$dry"
  assert_contains "Would keep recovery pair for label $label: quest-production-20260903T165638Z.tar.gz.enc (pinned,release-recent)" "$dry"
  # Cutover one-offs survive only while pinned.
  assert_contains "Would keep recovery pair for label $label: quest-adoption-1c4ccda1bc0455acf917ebf566c85363d25be7c8-20260903T112030Z.dump.age (pinned)" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-adoption-1c4ccda1bc0455acf917ebf566c85363d25be7c8-20260903T111422Z.dump.age and checksum" "$dry"
  assert_contains "Would delete recovery pair for label $label: quest-legacy-media-20260827T191544Z.tar.gz.enc and checksum" "$dry"
  # Anything the policy cannot vouch for is left alone.
  assert_contains "Retained an archive without its checksum for label $label: quest-pg17-20200101T000000Z.dump.age" "$dry"
  assert_contains "Retained a checksum without its archive for label $label: quest-media-20200101T000000Z.tar.gz.age.sha256" "$dry"
  assert_contains "Retained 1 unrecognised objects for label $label." "$dry"
done
assert_not_contains 'quest-pg17-20200101T000000Z.dump.age and checksum' "$dry"

# The minimum-recovery-point floor overrides a policy that would keep too little.
floor_env="$TEST_ROOT/floor.env"
{ cat "$ENV_FILE"; printf '%s\n' BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS=3 BACKUP_RETAIN_MEDIA_DAILY=1 BACKUP_RETAIN_MEDIA_WEEKLY=1; } > "$floor_env"
PRUNE_ENV="$floor_env" run_prune > "$TEST_ROOT/floor.txt"
assert_contains 'quest-media-20260916T031500Z.tar.gz.age (minimum-recovery-point)' "$TEST_ROOT/floor.txt"
assert_contains 'Would delete recovery pair for label primary: quest-media-20260915T031500Z.tar.gz.age and checksum' "$TEST_ROOT/floor.txt"

# Configuration guards refuse before touching any remote.
refuses() {
  local expected="$1"
  shift
  if env "$@" BACKUP_RELEASE_LOCK_PATH="$TEST_ROOT/release.lock" BACKUP_RETENTION_NOW=20260917T120000Z \
      bash "$ROOT/ops/prune-production-backups.sh" > "$TEST_ROOT/refusal.txt" 2>&1; then
    fail "expected refusal: $expected"
  fi
  assert_contains "$expected" "$TEST_ROOT/refusal.txt"
}
stale_env="$TEST_ROOT/stale.env"
{ cat "$ENV_FILE"; printf 'BACKUP_REMOTE_RETENTION_DAYS=90\n'; } > "$stale_env"
refuses 'BACKUP_REMOTE_RETENTION_DAYS is no longer used' BACKUP_ENV_FILE="$stale_env"
refuses 'set only one' BACKUP_ENV_FILE="$ENV_FILE" RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION TRASH_CONFIRMATION=EMPTY_QUEST_BACKUP_TRASH
refuses 'must be exactly PRUNE_QUEST_PRODUCTION' BACKUP_ENV_FILE="$ENV_FILE" RETENTION_CONFIRMATION=yes
no_evidence_env="$TEST_ROOT/no-evidence.env"
sed "s#^BACKUP_REHEARSAL_EVIDENCE_ROOT=.*#BACKUP_REHEARSAL_EVIDENCE_ROOT=$TEST_ROOT/missing#" "$ENV_FILE" > "$no_evidence_env"
refuses 'BACKUP_REHEARSAL_EVIDENCE_ROOT must be a readable absolute directory' BACKUP_ENV_FILE="$no_evidence_env"
bad_pin_env="$TEST_ROOT/bad-pin.env"
{ cat "$ENV_FILE"; printf "BACKUP_RETENTION_PINS='notes.txt until=2026-12-02'\n"; } > "$bad_pin_env"
refuses 'BACKUP_RETENTION_PINS contains an invalid entry' BACKUP_ENV_FILE="$bad_pin_env"
diff -q "$snapshot" <(cd "$REMOTE_ROOT" && find . -type f | sort) >/dev/null || fail "a refused run changed a remote"

# An unreadable remote fails the run, but the other remote is still evaluated.
if RCLONE_FAIL_CONFIG=primary.conf run_prune > "$TEST_ROOT/unreadable.txt" 2>&1; then
  fail "expected an unreadable remote to fail the run"
fi
assert_contains 'Could not inspect configured backup remote label: primary' "$TEST_ROOT/unreadable.txt"
assert_contains 'Inspected remote label secondary.' "$TEST_ROOT/unreadable.txt"
diff -q "$snapshot" <(cd "$REMOTE_ROOT" && find . -type f | sort) >/dev/null || fail "a failed inspection deleted objects"

# Confirmed pruning moves expired pairs to trash; a failed archive delete keeps its pair.
if RCLONE_PARTIAL_DELETE_CONFIG=primary.conf RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION \
    run_prune > "$TEST_ROOT/prune.txt" 2>&1; then
  fail "expected a partial deletion to fail the run"
fi
assert_contains 'the recovery pair was retained' "$TEST_ROOT/prune.txt"
[[ -f "$(live primary.conf quest-pg17-20260614T024500Z.dump.age)" &&
   -f "$(live primary.conf quest-pg17-20260614T024500Z.dump.age.sha256)" ]] || fail "primary lost a pair whose deletion failed"
for name in quest-pg17-20260614T024500Z.dump.age quest-pg17-20260614T024500Z.dump.age.sha256 \
    quest-legacy-media-20260827T191544Z.tar.gz.enc; do
  [[ ! -e "$(live secondary.conf "$name")" && -f "$(trashed secondary.conf "$name")" ]] \
    || fail "secondary did not move $name to trash"
done
for name in quest-pg17-20260917T024500Z.dump.age quest-production-20260820T120000Z.tar.gz.enc \
    quest-production-20260903T165638Z.tar.gz.enc quest-pg17-20200101T000000Z.dump.age notes.txt; do
  [[ -f "$(live secondary.conf "$name")" ]] || fail "secondary lost retained object $name"
done

# Emptying trash removes only backup objects that are no longer live.
printf 'personal\n' > "$(trashed secondary.conf personal.txt)"
mv -- "$(live secondary.conf quest-media-20260917T031500Z.tar.gz.age.sha256)" \
  "$(trashed secondary.conf quest-media-20260917T031500Z.tar.gz.age.sha256)"
TRASH_CONFIRMATION=EMPTY_QUEST_BACKUP_TRASH RCLONE_FAIL_CONFIG=primary.conf run_prune > "$TEST_ROOT/empty.txt" 2>&1 || true
assert_contains 'trashed backup objects' "$TEST_ROOT/empty.txt"
[[ ! -e "$(trashed secondary.conf quest-pg17-20260614T024500Z.dump.age)" ]] || fail "trash was not emptied"
[[ -f "$(trashed secondary.conf personal.txt)" ]] || fail "emptying trash removed a non-backup object"
[[ -f "$(trashed secondary.conf quest-media-20260917T031500Z.tar.gz.age.sha256)" ]] \
  || fail "emptying trash stranded a live archive without its checksum"
[[ -f "$(live secondary.conf quest-pg17-20260917T024500Z.dump.age)" ]] || fail "emptying trash touched a live object"

printf 'backup-retention tests passed\n'
