#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/quest-media-backup-contract.XXXXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

fake_bin="$test_root/bin"
upload_root="$test_root/uploads"
private_root="$test_root/private"
backup_root="$test_root/backups"
remote_root="$test_root/remote"
mkdir -p "$fake_bin" "$upload_root/poster-images" \
  "$private_root/event-album-originals" "$backup_root" "$remote_root"
chmod 700 "$private_root" "$private_root/event-album-originals"
printf 'RIFFpreviewWEBP\n' > "$upload_root/poster-images/photo-preview.webp"
printf '\xff\xd8\xfforiginal-JPEG\n' > "$private_root/event-album-originals/photo-preview.original.jpg"
printf 'fixture\n' > "$test_root/rclone.conf"
printf 'fixture identity\n' > "$test_root/identity"
printf 'fixture ca\n' > "$test_root/ca.crt"
printf 'fixture cert\n' > "$test_root/postgres.crt"
printf 'fixture key\n' > "$test_root/postgres.key"
chmod 600 "$test_root/identity" "$test_root/ca.crt" "$test_root/postgres.crt" "$test_root/postgres.key"
cat > "$fake_bin/postgres-target" <<EOF
#!/usr/bin/env bash
printf 'target_kind=postgresql17 database=quest host=127.0.0.1 port=55432 major=17 data_root=%s\n' "$backup_root"
EOF

cat > "$fake_bin/flock" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
cat > "$fake_bin/psql" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  printf 'psql (PostgreSQL) 17.4\n'
  exit 0
fi
if [[ "$*" == *current_database* && "${PGAPPNAME:-}" == quest-restore-target ]]; then
  printf 'quest_restore|170004|on|restore|172.18.0.2|5432|quest-restore-target\n'
elif [[ "$*" == *current_database* ]]; then
  printf 'quest|170004|on|quest_backup|172.18.0.2|5432|quest-backup-target\n'
elif [[ "$*" == *"nspname = 'valorant'"* ]]; then
  [[ "${MISSING_VALORANT:-0}" == 1 ]] || printf '1\n'
fi
FAKE
cat > "$fake_bin/pg_dump" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
  printf 'pg_dump (PostgreSQL) 17.4\n'
  exit 0
fi
printf '%s\n' "pg_dump $*" >> "$TEST_ROOT/pg_dump.log"
for argument in "$@"; do
  case "$argument" in
    --file=*) printf 'fixture database dump\n' > "${argument#--file=}" ;;
  esac
done
FAKE
cat > "$fake_bin/age" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
output=''
input=''
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    *) input="$1"; shift ;;
  esac
done
cp -- "$input" "$output"
FAKE
cat > "$fake_bin/rsync" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
source_path="${@: -2:1}"
target_path="${@: -1}"
mkdir -p "$target_path"
cp -a -- "${source_path%/}/." "${target_path%/}/"
FAKE
cat > "$fake_bin/rclone" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
operation="$1"
shift
case "$operation" in
  copyto)
    source="$1"
    target="$2"
    target_path="$REMOTE_ROOT/${target#*:}"
    mkdir -p "$(dirname "$target_path")"
    cp -- "$source" "$target_path"
    ;;
  check)
    source_directory="$1"
    remote="$2"
    shift 2
    while (($#)); do
      if [[ "$1" == --include ]]; then
        object_name="${2#/}"
        cmp -s "$source_directory/$object_name" "$REMOTE_ROOT/${remote#*:}/$object_name"
        shift 2
      else
        shift
      fi
    done
    ;;
  *)
    exit 2
    ;;
esac
FAKE
cat > "$fake_bin/pg_restore" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
  printf 'pg_restore (PostgreSQL) 17.4\n'
  exit 0
fi
printf '%s\n' "pg_restore $*" >> "$TEST_ROOT/pg_restore.log"
dump="${@: -1}"
if grep -q public-only "$dump"; then
  printf '%s\n' '3; 2615 2200 SCHEMA - public' '4; 1259 2201 TABLE public users'
else
  printf '%s\n' '3; 2615 2200 SCHEMA - public' '4; 1259 2201 TABLE public users' '5; 2615 2202 SCHEMA - valorant' '6; 1259 2203 TABLE valorant matches'
fi
exit 0
FAKE
cat > "$fake_bin/sha256sum" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == --check ]]; then
  exit 0
fi
printf 'fixture checksum  %s\n' "${1:-}"
FAKE
chmod 700 "$fake_bin"/*

env_file="$test_root/backup.env"
cat > "$env_file" <<EOF
POSTGRES17_BIN=$fake_bin
POSTGRES_CA_FILE=$test_root/ca.crt
POSTGRES_CERT_FILE=$test_root/postgres.crt
POSTGRES_KEY_FILE=$test_root/postgres.key
POSTGRES_TARGET_HOST=127.0.0.1
POSTGRES_TARGET_PORT=55432
POSTGRES_TARGET_DATABASE=quest
POSTGRES_TARGET_MAJOR=17
POSTGRES_TARGET_DATA_ROOT=$backup_root
POSTGRES_TARGET_SENTINEL_COMMAND=$fake_bin/postgres-target
DIRECT_URL=postgresql://quest_backup:fixture@127.0.0.1:55432/quest
UPLOAD_ROOT=$upload_root
PRIVATE_UPLOAD_ROOT=$private_root
BACKUP_ROOT=$backup_root
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BACKUP_RCLONE_REMOTES='primary=fixture:production'
BACKUP_RCLONE_CONFIGS='primary=$test_root/rclone.conf'
EOF

export PATH="$fake_bin:$PATH" REMOTE_ROOT="$remote_root" TEST_ROOT="$test_root"
BACKUP_ENV_FILE="$env_file" \
  BACKUP_RELEASE_LOCK_PATH="$test_root/release.lock" \
  bash "$root/ops/backup-production.sh" --test-fixture >/dev/null

archive_path="$(find "$backup_root" -maxdepth 1 -type f -name 'quest-production-*.tar.gz.enc' -print -quit)"
[[ -f "$archive_path" && -f "$archive_path.sha256" ]] || {
  echo "backup did not produce a complete archive pair" >&2
  exit 1
}
archive_extract="$test_root/archive-extract"
mkdir -p "$archive_extract"
tar --extract --gzip --file="$archive_path" --directory="$archive_extract"
manifest="$archive_extract/manifest.txt"
grep -F "public_upload_root=$upload_root" "$manifest" >/dev/null
grep -F "private_upload_root=$private_root" "$manifest" >/dev/null
grep -F "public_event_album_preview_root=$upload_root/poster-images" "$manifest" >/dev/null
grep -F "private_event_album_original_root=$private_root/event-album-originals" "$manifest" >/dev/null
[[ -f "$archive_extract/uploads/poster-images/photo-preview.webp" ]] || exit 1
[[ -f "$archive_extract/private/event-album-originals/photo-preview.original.jpg" ]] || exit 1
grep -F -- '--format=custom' "$test_root/pg_dump.log" >/dev/null
grep -F -- '--schema=public' "$test_root/pg_dump.log" >/dev/null
grep -F -- '--schema=valorant' "$test_root/pg_dump.log" >/dev/null
grep -F -- '--no-owner' "$test_root/pg_dump.log" >/dev/null
grep -F -- '--no-acl' "$test_root/pg_dump.log" >/dev/null

# The fixture seam still enforces the deployment sentinel's non-writable
# contract; only ownership/path canonicality is relaxed for the disposable root.
real_stat="$(command -v stat)"
cat > "$fake_bin/stat" <<'FAKE'
#!/usr/bin/env bash
case "$*" in
  *postgres-target*) printf '702\n'; exit 0 ;;
esac
exec "$REAL_STAT" "$@"
FAKE
chmod 700 "$fake_bin/stat"
export REAL_STAT="$real_stat"
if BACKUP_ENV_FILE="$env_file" BACKUP_RELEASE_LOCK_PATH="$test_root/unsafe-sentinel.lock" \
    bash "$root/ops/backup-production.sh" --test-fixture >"$test_root/unsafe-sentinel.out" 2>&1; then
  echo "backup accepted a group/world-writable target sentinel" >&2
  exit 1
fi
grep -F "writable by a group or other actor" "$test_root/unsafe-sentinel.out" >/dev/null
rm -f "$fake_bin/stat"

# The two-schema target is mandatory; a missing VALORANT schema must not
# silently downgrade the recovery point to a public-only archive.
if MISSING_VALORANT=1 BACKUP_ENV_FILE="$env_file" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/missing-schema.lock" \
    bash "$root/ops/backup-production.sh" --test-fixture >"$test_root/missing-schema.out" 2>&1; then
  echo "backup accepted a target without the valorant schema" >&2
  exit 1
fi
grep -F "valorant schema is required" "$test_root/missing-schema.out" >/dev/null

# Removing the explicit pinned directory must fail even though PATH contains
# fixture clients, proving that mutable discovery is not a supported fallback.
sed '/^POSTGRES17_BIN=/d' "$env_file" > "$test_root/mutable.env"
if BACKUP_ENV_FILE="$test_root/mutable.env" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/mutable.lock" \
    bash "$root/ops/backup-production.sh" --test-fixture >"$test_root/mutable.out" 2>&1; then
  echo "backup accepted mutable PostgreSQL client discovery" >&2
  exit 1
fi
grep -F "Pinned PostgreSQL client is missing or unsafe" "$test_root/mutable.out" >/dev/null

# A payload with a public preview but no private originals root is not a valid
# recovery point, even when its top-level private root is present.
preview_only="$test_root/preview-only"
mkdir -p "$preview_only/uploads/poster-images" "$preview_only/private"
printf 'preview only\n' > "$preview_only/uploads/poster-images/photo.webp"
printf 'public-only\n' > "$preview_only/database.dump"
cat > "$preview_only/manifest.txt" <<EOF
database_scope=application_public_and_valorant_schemas
valorant_schema_included=true
public_upload_root=$test_root/restore/uploads
private_upload_root=$test_root/restore/private
public_event_album_preview_root=$test_root/restore/uploads/poster-images
private_event_album_original_root=$test_root/restore/private/event-album-originals
EOF
preview_archive="$test_root/preview-only.tar.gz.enc"
tar --create --gzip --file="$test_root/preview-only.tar.gz" \
  -C "$preview_only" database.dump manifest.txt uploads private
cp -- "$test_root/preview-only.tar.gz" "$preview_archive"
printf 'fixture checksum\n' > "$preview_archive.sha256"
mkdir -p "$test_root/restore/uploads" "$test_root/restore/private"
: > "$test_root/psql.log"
: > "$test_root/pg_restore.log"
cat > "$test_root/restore-target-sentinel.env" <<EOF
target_kind=disposable_postgresql17
target_id=quest-restore-fixture
container_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
public_root=$test_root/restore/uploads
private_root=$test_root/restore/private
EOF
chmod 600 "$test_root/restore-target-sentinel.env"
cat > "$test_root/restore.env" <<EOF
POSTGRES17_BIN=$fake_bin
POSTGRES_CA_FILE=$test_root/ca.crt
POSTGRES_CERT_FILE=$test_root/postgres.crt
POSTGRES_KEY_FILE=$test_root/postgres.key
DIRECT_URL=postgresql://restore:fixture@127.0.0.1:55432/quest_restore
UPLOAD_ROOT=$test_root/restore/uploads
PRIVATE_UPLOAD_ROOT=$test_root/restore/private
BACKUP_AGE_IDENTITY_FILE=$test_root/identity
RESTORE_TARGET_SENTINEL_FILE=$test_root/restore-target-sentinel.env
EOF
if RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/restore.env" \
    RESTORE_COUNTDOWN_SECONDS=0 \
    bash "$root/ops/restore-production-backup.sh" --test-fixture "$preview_archive" \
    >"$test_root/preview-only.out" 2>&1; then
  echo "restore accepted a previews-only archive" >&2
  exit 1
fi
grep -F "TOC is missing the valorant schema" "$test_root/preview-only.out" >/dev/null || {
  cat "$test_root/preview-only.out" >&2
  exit 1
}
! grep -F -- '--dbname=' "$test_root/pg_restore.log" >/dev/null
! grep -F -- 'RESTORE_MODE=1' "$test_root/psql.log" >/dev/null
[[ ! -e "$test_root/restore/uploads/file.txt" && ! -e "$test_root/restore/private/file.txt" ]] || exit 1

printf 'media backup contract fixture tests passed\n'
