#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/quest-media-backup-contract.XXXXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

# Synthetic archives must carry the same upload source inventories the producer
# writes, or the restore preflight refuses them before the behaviour each
# fixture actually exercises. Keep this identical to the producer and restore
# implementations of inventory_tree.
fixture_inventory_tree() {
  local tree_root="$1" output="$2" entry relative
  : > "$output"
  while IFS= read -r -d '' entry; do
    relative="${entry#"$tree_root"/}"
    if [[ -d "$entry" ]]; then
      printf 'directory\t%s\n' "$relative" >> "$output"
    else
      printf 'file\t%s\t%s\t%s\n' "$relative" "$(stat -c '%s' -- "$entry")" "$(sha256sum -- "$entry" | awk '{print $1}')" >> "$output"
    fi
  done < <(find -P "$tree_root" -mindepth 1 -print0 | sort -z)
}

# Regenerate both inventories for a staged payload and (re)bind them to its
# manifest, so a fixture may be built or copied in any order.
stage_fixture_inventories() {
  local payload="$1"
  fixture_inventory_tree "$payload/uploads" "$payload/public-upload-inventory.tsv"
  fixture_inventory_tree "$payload/private" "$payload/private-upload-inventory.tsv"
  grep -v '^\(public\|private\)_upload_inventory\(_sha256\)\?=' "$payload/manifest.txt" > "$payload/manifest.rebound"
  {
    printf 'public_upload_inventory=public-upload-inventory.tsv\n'
    printf 'public_upload_inventory_sha256=%s\n' "$(sha256sum "$payload/public-upload-inventory.tsv" | awk '{print $1}')"
    printf 'private_upload_inventory=private-upload-inventory.tsv\n'
    printf 'private_upload_inventory_sha256=%s\n' "$(sha256sum "$payload/private-upload-inventory.tsv" | awk '{print $1}')"
  } >> "$payload/manifest.rebound"
  mv -- "$payload/manifest.rebound" "$payload/manifest.txt"
}

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
printf 'fixture server ca\n' > "$test_root/server-ca.crt"
printf 'fixture cert\n' > "$test_root/postgres.crt"
printf 'fixture key\n' > "$test_root/postgres.key"
mkdir -p "$test_root/backup-client"
printf 'fixture ca\n' > "$test_root/backup-client/backup-client-ca.crt"
printf 'fixture backup cert\n' > "$test_root/backup-client/backup-client.crt"
printf 'fixture backup key\n' > "$test_root/backup-client/backup-client.key"
chmod 600 "$test_root/identity" "$test_root/server-ca.crt" "$test_root/postgres.crt" "$test_root/postgres.key"
chmod 750 "$test_root/backup-client"
chmod 640 "$test_root/backup-client/backup-client-ca.crt" "$test_root/backup-client/backup-client.crt" "$test_root/backup-client/backup-client.key"
cat > "$fake_bin/postgres-target" <<EOF
#!/usr/bin/env bash
printf 'target_kind=postgresql17 database=quest host=quest-postgres port=5432 major=17 data_root=%s\n' "$backup_root"
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
printf '%s\n' "psql $*" >> "$TEST_ROOT/psql.log"
if [[ "$*" == *current_database* && "${PGAPPNAME:-}" == quest-restore-target ]]; then
  printf 'quest_restore|170004|on|quest_recovery_admin|172.18.0.2|5432|quest-restore-target\n'
elif [[ "$*" == *owner_name* ]]; then
  printf '0\n'
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
written=false
for argument in "$@"; do
  case "$argument" in
    --file=*) printf 'fixture database dump\n' > "${argument#--file=}"; written=true ;;
  esac
done
[[ "$written" == true ]] || printf 'fixture database dump\n'
FAKE
cat > "$fake_bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
operation="${1:-}"
shift || true
fake_bin="$(dirname "$0")"
case "$operation" in
  info) exit 0 ;;
  inspect)
    template="$2"
    case "$template" in
      *State.Health.Status*) printf 'healthy\n' ;;
      *com.docker.compose.project*) printf 'quest-prod\n' ;;
      *com.docker.compose.service*) printf 'postgres\n' ;;
      *Config.Image*) printf 'postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0\n' ;;
      *HostConfig.PortBindings*) printf '{}\n' ;;
      *NetworkSettings.Networks*) printf 'quest-prod-postgres-1,quest-postgres\n' ;;
      *var/lib/postgresql/data*) printf '%s\n' "$BACKUP_ROOT" ;;
      *) exit 2 ;;
    esac
    ;;
  network)
    [[ "$1" == inspect && "$2" == quest-shared ]] || exit 2
    printf 'quest-prod-postgres-1\n'
    ;;
  run)
    IFS= read -r connection_url
    arguments=("$@")
    passthrough=()
    after_separator=false
    for ((index=0; index < ${#arguments[@]}; index++)); do
      if [[ "${arguments[$index]}" == -- ]]; then after_separator=true; continue; fi
      [[ "$after_separator" == true ]] && passthrough+=("${arguments[$index]}")
    done
    client="$(basename "${passthrough[0]}")"
    passthrough=("${passthrough[@]:1}")
    case "$client" in
      psql) "$fake_bin/psql" -X "$connection_url" "${passthrough[@]}" ;;
      pg_dump) "$fake_bin/pg_dump" "$connection_url" "${passthrough[@]}" ;;
      *) exit 2 ;;
    esac
    ;;
  *) exit 2 ;;
esac
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
emit_schema_base() {
  printf '%s\n' \
    '3; 2615 2200 SCHEMA - public postgres' \
    '4; 1259 2201 TABLE public users postgres' \
    '5; 2615 2202 SCHEMA - valorant postgres' \
    '6; 1259 2203 TABLE valorant matches postgres'
}
if grep -q public-only "$dump"; then
  printf '%s\n' '3; 2615 2200 SCHEMA - public postgres' '4; 1259 2201 TABLE public users postgres'
elif grep -q extra-schema "$dump"; then
  printf '%s\n' '3; 2615 2200 SCHEMA - public postgres' '4; 1259 2201 TABLE public users postgres' '5; 2615 2202 SCHEMA - valorant postgres' '6; 1259 2203 TABLE valorant matches postgres' '7; 2615 2204 SCHEMA - analytics postgres'
elif grep -q scoped-fk-constraint "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 2606 2204 FK CONSTRAINT analytics cross_schema postgres'
elif grep -q scoped-row-security "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 0 2204 ROW SECURITY analytics cross_schema postgres'
elif grep -q scoped-policy "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 0 2204 POLICY analytics cross_schema postgres'
elif grep -q scoped-acl "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 0 2204 ACL analytics TABLE cross_schema postgres'
elif grep -q scoped-comment "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 0 2204 COMMENT analytics TABLE cross_schema postgres'
elif grep -q scoped-default-acl "$dump"; then
  emit_schema_base
  printf '%s\n' '7; 0 2204 DEFAULT ACL analytics IN SCHEMA analytics postgres'
elif grep -q materialized-view-data "$dump"; then
  printf '%s\n' \
    '3; 2615 2200 SCHEMA - public postgres' \
    '4; 1259 2201 TABLE public users postgres' \
    '5; 2615 2202 SCHEMA - valorant postgres' \
    '6; 1259 2203 TABLE valorant matches postgres' \
    '7; 1259 2204 MATERIALIZED VIEW public standings postgres' \
    '8; 0 2204 MATERIALIZED VIEW DATA public standings postgres' \
    '9; 0 2205 DEFAULT public users status postgres' \
    '10; 0 2206 DEFAULT ACL - GLOBAL postgres' \
    '11; 0 2207 DEFAULT ACL public IN SCHEMA public postgres'
else
  emit_schema_base
fi
exit 0
FAKE
cat > "$fake_bin/sha256sum" <<'FAKE'
#!/usr/bin/env bash
# Archive checksum files in this fixture are placeholders, so --check always
# succeeds. Digests, however, must be real: the manifest binds each upload
# source inventory by hash, and both the producer and the restore preflight
# reject anything that is not 64 hexadecimal characters.
if [[ "${1:-}" == --check ]]; then
  exit 0
fi
for real in /usr/bin/sha256sum /bin/sha256sum; do
  [[ -x "$real" ]] && exec "$real" "$@"
done
printf 'sha256sum is unavailable to the media backup fixture\n' >&2
exit 1
FAKE
chmod 700 "$fake_bin"/*

env_file="$test_root/backup.env"
cat > "$env_file" <<EOF
DOCKER_BIN=$fake_bin/docker
POSTGRES_CA_FILE=$test_root/backup-client/backup-client-ca.crt
BACKUP_CLIENT_TLS_DIR=$test_root/backup-client
BACKUP_CLIENT_CERT_FILE=$test_root/backup-client/backup-client.crt
BACKUP_CLIENT_KEY_FILE=$test_root/backup-client/backup-client.key
POSTGRES_TARGET_HOST=quest-postgres
POSTGRES_TARGET_PORT=5432
POSTGRES_TARGET_CONTAINER=quest-prod-postgres-1
POSTGRES_TARGET_NETWORK=quest-shared
POSTGRES_TARGET_DATABASE=quest
POSTGRES_TARGET_MAJOR=17
POSTGRES_TARGET_DATA_ROOT=$backup_root
POSTGRES_TARGET_SENTINEL_COMMAND=$fake_bin/postgres-target
DIRECT_URL=postgresql://quest_backup:fixture@quest-postgres:5432/quest
UPLOAD_ROOT=$upload_root
PRIVATE_UPLOAD_ROOT=$private_root
BACKUP_ROOT=$backup_root
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BACKUP_RCLONE_REMOTES='primary=fixture:production'
BACKUP_RCLONE_CONFIGS='primary=$test_root/rclone.conf'
EOF

export PATH="$fake_bin:$PATH" REMOTE_ROOT="$remote_root" TEST_ROOT="$test_root"
REAL_STAT="$(command -v stat)"; export REAL_STAT
cat > "$fake_bin/stat" <<'FAKE'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == %a && "$3" == *backup-client && "$3" != *backup-client.crt && "$3" != *backup-client.key ]]; then
  printf '750\n'
elif [[ "$1" == -c && "$2" == %a && ( "$3" == *backup-client.crt || "$3" == *backup-client.key ) ]]; then
  printf '640\n'
else
  exec "$REAL_STAT" "$@"
fi
FAKE
chmod 700 "$fake_bin/stat"
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
real_stat="${REAL_STAT:-$(command -v stat)}"
cat > "$fake_bin/stat" <<'FAKE'
#!/usr/bin/env bash
case "$*" in
  *postgres-target*) [[ "${MISSING_VALORANT:-0}" != 1 ]] && { printf '702\n'; exit 0; } ;;
  *backup-client/backup-client.crt*|*backup-client/backup-client.key*) printf '640\n'; exit 0 ;;
  *backup-client*) printf '750\n'; exit 0 ;;
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
# The two-schema target is mandatory; a missing VALORANT schema must not
# silently downgrade the recovery point to a public-only archive.
if MISSING_VALORANT=1 BACKUP_ENV_FILE="$env_file" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/missing-schema.lock" \
    bash "$root/ops/backup-production.sh" --test-fixture >"$test_root/missing-schema.out" 2>&1; then
  echo "backup accepted a target without the valorant schema" >&2
  exit 1
fi
grep -F "valorant schema is required" "$test_root/missing-schema.out" >/dev/null || {
  cat "$test_root/missing-schema.out" >&2
  exit 1
}

# The private-network path must fail closed when its configured Docker binary is
# unavailable; it must never fall back to a host PostgreSQL client or loopback.
sed "s#^DOCKER_BIN=.*#DOCKER_BIN=$test_root/missing-docker#" "$env_file" > "$test_root/mutable.env"
if MISSING_VALORANT=1 BACKUP_ENV_FILE="$test_root/mutable.env" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/mutable.lock" \
    bash "$root/ops/backup-production.sh" --test-fixture >"$test_root/mutable.out" 2>&1; then
  echo "backup accepted a missing Docker client" >&2
  exit 1
fi
grep -F "Docker is missing or unsafe" "$test_root/mutable.out" >/dev/null

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
stage_fixture_inventories "$preview_only"
tar --create --gzip --file="$test_root/preview-only.tar.gz" \
  -C "$preview_only" database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv uploads private
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
POSTGRES_CA_FILE=$test_root/server-ca.crt
RECOVERY_CLIENT_CERT_FILE=$test_root/postgres.crt
RECOVERY_CLIENT_KEY_FILE=$test_root/postgres.key
RECOVERY_ADMIN_URL=postgresql://quest_recovery_admin:fixture@127.0.0.1:55432/quest_restore
UPLOAD_ROOT=$test_root/restore/uploads
PRIVATE_UPLOAD_ROOT=$test_root/restore/private
BACKUP_AGE_IDENTITY_FILE=$test_root/identity
RESTORE_TARGET_SENTINEL_FILE=$test_root/restore-target-sentinel.env
EOF

# Count every attempted file-tree move so preflight refusals cannot pass by
# activating and then restoring an identical fixture tree.
real_mv="$(command -v mv)"
activation_counter="$test_root/activation.counter"
: > "$activation_counter"
cat > "$fake_bin/mv" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$ACTIVATION_COUNTER"
exec "$REAL_MV" "$@"
FAKE
chmod 700 "$fake_bin/mv"
export REAL_MV="$real_mv" ACTIVATION_COUNTER="$activation_counter"

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
[[ "$(wc -l < "$activation_counter" | tr -d ' ')" == 0 ]] || {
  echo "preflight refusal reached file activation for previews-only archive" >&2
  exit 1
}

# An archive that adds a third schema is refused after TOC inspection but
# before activation, destructive pg_restore, or security normalization.
extra_schema="$test_root/extra-schema"
mkdir -p "$extra_schema/uploads/poster-images" "$extra_schema/private/event-album-originals"
printf 'extra-schema\n' > "$extra_schema/database.dump"
cp -- "$preview_only/manifest.txt" "$extra_schema/manifest.txt"
printf 'extra fixture\n' > "$extra_schema/uploads/poster-images/photo.webp"
printf 'extra fixture\n' > "$extra_schema/private/event-album-originals/photo.jpg"
extra_schema_archive="$test_root/extra-schema.tar.gz.enc"
stage_fixture_inventories "$extra_schema"
tar --create --gzip --file="$test_root/extra-schema.tar.gz" \
  -C "$extra_schema" database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv uploads private
cp -- "$test_root/extra-schema.tar.gz" "$extra_schema_archive"
printf 'fixture checksum\n' > "$extra_schema_archive.sha256"
: > "$test_root/pg_restore.log"
: > "$test_root/psql.log"
if RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/restore.env" \
    RESTORE_COUNTDOWN_SECONDS=0 \
    bash "$root/ops/restore-production-backup.sh" --test-fixture "$extra_schema_archive" \
    >"$test_root/extra-schema.out" 2>&1; then
  echo "restore accepted an extra-schema archive" >&2
  exit 1
fi
grep -F "unexpected schema scope" "$test_root/extra-schema.out" >/dev/null || {
  cat "$test_root/extra-schema.out" >&2
  exit 1
}
! grep -F -- '--dbname=' "$test_root/pg_restore.log" >/dev/null
! grep -F -- 'RESTORE_MODE=1' "$test_root/psql.log" >/dev/null
[[ ! -e "$test_root/restore/uploads/file.txt" && ! -e "$test_root/restore/private/file.txt" ]] || exit 1
[[ "$(wc -l < "$activation_counter" | tr -d ' ')" == 0 ]] || {
  echo "preflight refusal reached file activation for extra-schema archive" >&2
  exit 1
}

# Scoped descriptors that were previously skipped must be rejected even when
# the SCHEMA declarations themselves are limited to public and valorant. Keep
# each descriptor in its own archive so one early refusal cannot hide coverage
# of the remaining PostgreSQL TOC descriptor grammars.
for descriptor in fk-constraint row-security policy acl comment default-acl; do
  marker="scoped-$descriptor"
  scoped_descriptors="$test_root/$marker"
  mkdir -p "$scoped_descriptors/uploads/poster-images" "$scoped_descriptors/private/event-album-originals"
  printf '%s\n' "$marker" > "$scoped_descriptors/database.dump"
  cp -- "$preview_only/manifest.txt" "$scoped_descriptors/manifest.txt"
  printf 'scoped fixture\n' > "$scoped_descriptors/uploads/poster-images/photo.webp"
  printf 'scoped fixture\n' > "$scoped_descriptors/private/event-album-originals/photo.jpg"
  scoped_archive="$test_root/$marker.tar.gz.enc"
  stage_fixture_inventories "$scoped_descriptors"
  tar --create --gzip --file="$test_root/$marker.tar.gz" \
    -C "$scoped_descriptors" database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv uploads private
  cp -- "$test_root/$marker.tar.gz" "$scoped_archive"
  printf 'fixture checksum\n' > "$scoped_archive.sha256"
  : > "$test_root/pg_restore.log"
  : > "$test_root/psql.log"
  activation_before="$(wc -l < "$activation_counter" | tr -d ' ')"
  if RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
      BACKUP_ENV_FILE="$test_root/restore.env" \
      RESTORE_COUNTDOWN_SECONDS=0 \
      bash "$root/ops/restore-production-backup.sh" --test-fixture "$scoped_archive" \
      >"$test_root/$marker.out" 2>&1; then
    echo "restore accepted an unexpected schema-scoped descriptor: $descriptor" >&2
    exit 1
  fi
  grep -F "outside public and valorant" "$test_root/$marker.out" >/dev/null || {
    cat "$test_root/$marker.out" >&2
    exit 1
  }
  ! grep -F -- '--dbname=' "$test_root/pg_restore.log" >/dev/null
  ! grep -F -- 'RESTORE_MODE=1' "$test_root/psql.log" >/dev/null
  [[ "$(wc -l < "$activation_counter" | tr -d ' ')" == "$activation_before" ]] || {
    echo "preflight refusal reached file activation for scoped descriptor: $descriptor" >&2
    exit 1
  }
done

# MATERIALIZED VIEW DATA has DATA between the descriptor and schema.  It is a
# valid public/valorant archive entry and must not be mistaken for schema DATA.
materialized="$test_root/materialized-view-data"
mkdir -p "$materialized/uploads/poster-images" "$materialized/private/event-album-originals"
printf 'materialized-view-data\n' > "$materialized/database.dump"
cp -- "$preview_only/manifest.txt" "$materialized/manifest.txt"
printf 'materialized fixture\n' > "$materialized/uploads/poster-images/photo.webp"
printf 'materialized fixture\n' > "$materialized/private/event-album-originals/photo.jpg"
materialized_archive="$test_root/materialized-view-data.tar.gz.enc"
stage_fixture_inventories "$materialized"
tar --create --gzip --file="$test_root/materialized-view-data.tar.gz" \
  -C "$materialized" database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv uploads private
cp -- "$test_root/materialized-view-data.tar.gz" "$materialized_archive"
printf 'fixture checksum\n' > "$materialized_archive.sha256"
: > "$test_root/pg_restore.log"
: > "$test_root/psql.log"
if ! RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/restore.env" \
    RESTORE_COUNTDOWN_SECONDS=0 \
    OBSERVED_SESSION_USER=quest_recovery_admin \
    bash "$root/ops/restore-production-backup.sh" --test-fixture "$materialized_archive" \
    >"$test_root/materialized-view-data.out" 2>&1; then
  cat "$test_root/materialized-view-data.out" >&2
  exit 1
fi
grep -F -- '--dbname=' "$test_root/pg_restore.log" >/dev/null || {
  cat "$test_root/materialized-view-data.out" >&2
  cat "$test_root/pg_restore.log" >&2
  exit 1
}
grep -F -- 'RESTORE_MODE=1' "$test_root/psql.log" >/dev/null || {
  cat "$test_root/materialized-view-data.out" >&2
  printf '%s\n' '--- psql log ---' >&2
  cat "$test_root/psql.log" >&2
  exit 1
}
[[ "$(wc -l < "$activation_counter" | tr -d ' ')" -gt 0 ]] || {
  echo "valid materialized-view data archive did not activate file trees" >&2
  exit 1
}

printf 'media backup contract fixture tests passed\n'
