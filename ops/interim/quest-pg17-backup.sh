#!/usr/bin/env bash
# INTERIM: database-only encrypted backup, until the multi-remote TLS
# pipeline in ops/backup-production-multi-remote.sh is provisioned.
set -euo pipefail
umask 077
set -a; . /etc/quest-esports-backup.env; set +a
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_ROOT/quest-pg17-$STAMP.dump.age"
docker exec quest-prod-postgres-1 pg_dump -U postgres -d quest -Fc --no-owner --no-acl \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT"
[ -s "$OUT" ] || { echo "refusing: empty archive" >&2; rm -f "$OUT"; exit 1; }
sha256sum "$OUT" > "$OUT.sha256"
chown deploy:deploy "$OUT" "$OUT.sha256"
rclone copy "$OUT" "$BACKUP_RCLONE_REMOTE"
rclone copy "$OUT.sha256" "$BACKUP_RCLONE_REMOTE"
find "$BACKUP_ROOT" -name 'quest-pg17-*.dump.age*' -mtime +"${BACKUP_LOCAL_RETENTION_DAYS:-7}" -delete
echo "ok: $OUT"
