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

cat > "$fake_bin/flock" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
cat > "$fake_bin/psql" <<'FAKE'
#!/usr/bin/env bash
printf '1\n'
FAKE
cat > "$fake_bin/pg_dump" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
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
DIRECT_URL=postgresql://fixture.invalid/quest
UPLOAD_ROOT=$upload_root
PRIVATE_UPLOAD_ROOT=$private_root
BACKUP_ROOT=$backup_root
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BACKUP_RCLONE_REMOTES='primary=fixture:production'
BACKUP_RCLONE_CONFIGS='primary=$test_root/rclone.conf'
EOF

export PATH="$fake_bin:$PATH" REMOTE_ROOT="$remote_root"
BACKUP_ENV_FILE="$env_file" \
  BACKUP_RELEASE_LOCK_PATH="$test_root/release.lock" \
  bash "$root/ops/backup-production.sh" >/dev/null

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

# A payload with a public preview but no private originals root is not a valid
# recovery point, even when its top-level private root is present.
preview_only="$test_root/preview-only"
mkdir -p "$preview_only/uploads/poster-images" "$preview_only/private"
printf 'preview only\n' > "$preview_only/uploads/poster-images/photo.webp"
printf 'dump\n' > "$preview_only/database.dump"
cat > "$preview_only/manifest.txt" <<EOF
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
cat > "$test_root/restore.env" <<EOF
DIRECT_URL=postgresql://fixture.invalid/quest
UPLOAD_ROOT=$test_root/restore/uploads
PRIVATE_UPLOAD_ROOT=$test_root/restore/private
BACKUP_AGE_IDENTITY_FILE=$test_root/identity
EOF
if RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/restore.env" \
    RESTORE_COUNTDOWN_SECONDS=0 \
    bash "$root/ops/restore-production-backup.sh" "$preview_archive" \
    >"$test_root/preview-only.out" 2>&1; then
  echo "restore accepted a previews-only archive" >&2
  exit 1
fi
grep -F "missing the public previews or private event-album originals root" "$test_root/preview-only.out" >/dev/null || {
  cat "$test_root/preview-only.out" >&2
  exit 1
}

printf 'media backup contract fixture tests passed\n'
