#!/usr/bin/env bash
# Non-destructive recovery drill that reads the OFF-SITE copy, not local staging.
#
#   database  quest-pg17-*.dump.age   -> restored into a throwaway, network-less
#             PostgreSQL container on the production image, then every table's
#             row count is compared with live production.
#   media     quest-media-*.tar.gz.age -> decrypted and listed to the end of the
#             stream in memory; file counts and bytes are compared with live.
#
# The age identity is read from stdin and held only in this shell's memory, so
# it never lands on the production disk. Run as root on the production host from
# a workstation that holds the identity. The script travels as an argument so
# stdin carries only the identity:
#
#   drill="$(base64 -w0 ops/rehearsal/drive-restore-drill.sh)"
#   ssh quest-vps "bash -c \"\$(echo $drill | base64 -d)\" drill database quest-pg17-YYYYMMDDTHHMMSSZ.dump.age" \
#     < ~/.config/quest-esports/recovery/quest-esports-backup-age-key.txt
#
# Nothing in production is written to; the disposable container and its volume
# are removed on exit.
set -euo pipefail
umask 077

kind="${1:?usage: drive-restore-drill.sh database|media <archive name>}"
archive="${2:?usage: drive-restore-drill.sh database|media <archive name>}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
LIVE_POSTGRES_CONTAINER="${LIVE_POSTGRES_CONTAINER:-quest-prod-postgres-1}"
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required}"
: "${RCLONE_CONFIG:?RCLONE_CONFIG is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
export RCLONE_CONFIG
remote="${BACKUP_RCLONE_REMOTE%/}"

case "$kind:$archive" in
  database:quest-pg17-[0-9]*T[0-9]*Z.dump.age) ;;
  media:quest-media-[0-9]*T[0-9]*Z.tar.gz.age) ;;
  *) echo "Archive name does not match the drill kind." >&2; exit 1 ;;
esac

identity=''
while IFS= read -r line; do
  identity+="$line"$'\n'
done
[[ -n "$identity" ]] || { echo "No age identity on stdin." >&2; exit 1; }
if [[ "$(printf '%s' "$identity" | age-keygen -y 2>/dev/null)" != "$BACKUP_AGE_RECIPIENT" ]]; then
  echo "The supplied identity does not match BACKUP_AGE_RECIPIENT." >&2
  exit 1
fi
echo "identity=matches-recipient"

started=$(date -u +%s)
work="$(mktemp -d -p /dev/shm)"
container=''
cleanup() {
  [[ -n "$container" ]] && docker rm -fv "$container" >/dev/null 2>&1
  rm -rf -- "$work"
}
trap cleanup EXIT

expected="$(rclone cat "$remote/$archive.sha256" | awk '{print $1}')"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "Checksum sidecar is missing or malformed on the remote." >&2; exit 1; }
verify_checksum() {
  local actual
  actual="$(cat "$work/sha256")"
  [[ "$actual" == "$expected" ]] || { echo "checksum=MISMATCH (download again before concluding the archive is bad)" >&2; exit 1; }
  echo "checksum=OK"
}

if [[ "$kind" == database ]]; then
  image="$(docker inspect -f '{{.Config.Image}}' "$LIVE_POSTGRES_CONTAINER")"
  container="quest-restore-drill-$(date -u +%Y%m%dT%H%M%SZ)"
  docker run -d --name "$container" --network none \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=drill "$image" >/dev/null
  for _ in $(seq 60); do
    docker exec "$container" pg_isready -U postgres -d drill -q 2>/dev/null && break
    sleep 1
  done
  sleep 2
  docker exec "$container" pg_isready -U postgres -d drill -q
  # Dumps are --no-owner --no-acl, but policies still name the application roles.
  roles="$(docker exec "$LIVE_POSTGRES_CONTAINER" psql -U postgres -d quest -Atc \
    "select rolname from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres'")"
  for role in $roles; do
    docker exec "$container" psql -U postgres -d drill -qc "create role \"$role\" nologin"
  done
  rclone cat "$remote/$archive" \
    | tee >(sha256sum | awk '{print $1}' > "$work/sha256") \
    | age -d -i <(printf '%s' "$identity") \
    | docker exec -i "$container" pg_restore -U postgres -d drill --no-owner --no-acl --exit-on-error
  sleep 1
  verify_checksum
  counts="select table_schema||'.'||table_name||' '||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema in ('public','valorant') and table_type='BASE TABLE' order by 1"
  migrations="select count(*) filter (where finished_at is not null and rolled_back_at is null)||'/'||count(*) from public._prisma_migrations"
  docker exec "$container" psql -U postgres -d drill -Atc "$counts" > "$work/restored"
  docker exec "$LIVE_POSTGRES_CONTAINER" psql -U postgres -d quest -Atc "$counts" > "$work/live"
  echo "prisma_migrations applied/rows restored=$(docker exec "$container" psql -U postgres -d drill -Atc "$migrations") live=$(docker exec "$LIVE_POSTGRES_CONTAINER" psql -U postgres -d quest -Atc "$migrations")"
  echo "tables restored=$(wc -l < "$work/restored") live=$(wc -l < "$work/live") identical_row_counts=$(comm -12 "$work/restored" "$work/live" | wc -l)"
  echo "differing tables (restored live) -- expected only where production wrote after the dump:"
  join -a1 -a2 -e MISSING -o 0,1.2,2.2 "$work/restored" "$work/live" | awk '$2 != $3 { print "  " $0 }'
else
  : "${UPLOAD_ROOT:?UPLOAD_ROOT is required}"
  : "${PRIVATE_UPLOAD_ROOT:?PRIVATE_UPLOAD_ROOT is required}"
  rclone cat "$remote/$archive" \
    | tee >(sha256sum | awk '{print $1}' > "$work/sha256") \
    | age -d -i <(printf '%s' "$identity") \
    | tar -tzvf - > "$work/listing"
  sleep 1
  verify_checksum
  grep -q ' manifest.txt$' "$work/listing" && echo "manifest=present"
  for root in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
    name="$(basename "$root")"
    printf '%s archive: files=%s bytes=%s | live: files=%s bytes=%s\n' "$name" \
      "$(awk -v r="$name/" '$1 ~ /^-/ && index($6, r) == 1' "$work/listing" | wc -l)" \
      "$(awk -v r="$name/" '$1 ~ /^-/ && index($6, r) == 1 { s += $3 } END { print s + 0 }' "$work/listing")" \
      "$(find "$root" -type f | wc -l)" \
      "$(find "$root" -type f -printf '%s\n' | awk '{ s += $1 } END { print s + 0 }')"
  done
  stamp="$(sed -E 's/^quest-media-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z.*/\1-\2-\3 \4:\5:\6 UTC/' <<< "$archive")"
  echo "live files written after the archive: $(find "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT" -type f -newermt "$stamp" | wc -l)"
fi
echo "elapsed_seconds=$(( $(date -u +%s) - started ))"
