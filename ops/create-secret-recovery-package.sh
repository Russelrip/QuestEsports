#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this recovery packaging script as root." >&2
  exit 1
fi
if [[ "${RECOVERY_PACKAGE_CONFIRMATION:-}" != "PACKAGE_QUEST_SECRETS" ]]; then
  echo "Set RECOVERY_PACKAGE_CONFIRMATION=PACKAGE_QUEST_SECRETS for an intentional export." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: create-secret-recovery-package.sh /absolute/secure/output-directory" >&2
  exit 1
fi
output_directory="$1"
case "$output_directory" in
  /*) ;;
  *) echo "The output directory must be absolute." >&2; exit 1 ;;
esac
if [[ "$output_directory" == "/" ]]; then
  echo "Refusing to write a recovery package to the filesystem root." >&2
  exit 1
fi
if [[ -z "${RECOVERY_AGE_RECIPIENT:-}" || ! "$RECOVERY_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]]; then
  echo "RECOVERY_AGE_RECIPIENT must be a valid offline age public recipient." >&2
  exit 1
fi
for command in age date hostname id install mktemp sha256sum tar; do
  command -v "$command" >/dev/null || {
    echo "Required recovery command is unavailable: $command" >&2
    exit 1
  }
done

required_files=(
  /var/www/QuestEsports/backend/.env
  /srv/quest-esports/rclone/quest-esports.conf
  /etc/quest-esports-backup.env
)
optional_files=(
  /etc/nginx/sites-available/questesports
  /etc/nginx/sites-available/quest-esports
  /etc/systemd/system/quest-esports-backup.service
  /etc/systemd/system/quest-esports-backup.timer
  /etc/systemd/system/quest-esports-backup-failure@.service
  /etc/systemd/system/quest-esports-backup-freshness.service
  /etc/systemd/system/quest-esports-backup-freshness.timer
  /home/deploy/.pm2/dump.pm2
)
archive_files=()
for source_path in "${required_files[@]}"; do
  if [[ ! -r "$source_path" ]]; then
    echo "Required recovery source is missing or unreadable: $source_path" >&2
    exit 1
  fi
  archive_files+=("${source_path#/}")
done
for source_path in "${optional_files[@]}"; do
  if [[ -r "$source_path" ]]; then
    archive_files+=("${source_path#/}")
  fi
done

install -d -m 700 "$output_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
package_name="quest-secret-recovery-${timestamp}.tar.gz.age"
package_path="$output_directory/$package_name"
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT

{
  echo "created_at_utc=$timestamp"
  echo "source_host=$(hostname -f 2>/dev/null || hostname)"
  echo "contains_private_operational_secrets=true"
  echo "private_age_identity_included=false"
  printf 'included_path=/%s\n' "${archive_files[@]}"
} > "$work_directory/recovery-manifest.txt"

tar --create --gzip --file="$work_directory/recovery-package.tar.gz" \
  -C / "${archive_files[@]}" \
  -C "$work_directory" recovery-manifest.txt
age --recipient "$RECOVERY_AGE_RECIPIENT" \
  --output "$package_path" \
  "$work_directory/recovery-package.tar.gz"
(cd "$output_directory" && sha256sum "$package_name" > "$package_name.sha256")

echo "Encrypted secret recovery package created: $package_path"
echo "Copy the package and checksum to the approved separate recovery vault, test decryption offline, then remove this staging copy."
