#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Backup failure notification configuration is not readable: $BACKUP_ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

if [[ -z "${BACKUP_FAILURE_WEBHOOK_URL:-}" ]]; then
  echo "Backup failed, but BACKUP_FAILURE_WEBHOOK_URL is not configured." >&2
  exit 1
fi
case "$BACKUP_FAILURE_WEBHOOK_URL" in
  https://*) ;;
  *) echo "BACKUP_FAILURE_WEBHOOK_URL must use HTTPS." >&2; exit 1 ;;
esac
for command in curl node hostname; do
  command -v "$command" >/dev/null || {
    echo "Required notification command is unavailable: $command" >&2
    exit 1
  }
done

failed_unit="${1:-quest-esports-backup.service}"
if [[ ! "$failed_unit" =~ ^[A-Za-z0-9@_.-]+$ ]]; then
  failed_unit="unknown-unit"
fi
host_name="$(hostname -f 2>/dev/null || hostname)"
message="QuestEsports production backup check failed on ${host_name}. Unit: ${failed_unit}. Check: journalctl -u ${failed_unit}"
payload="$(node -e 'process.stdout.write(JSON.stringify({content: process.argv[1]}))' "$message")"

curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Content-Type: application/json" \
  --data "$payload" \
  "$BACKUP_FAILURE_WEBHOOK_URL" >/dev/null

echo "Backup failure notification delivered for $failed_unit."
