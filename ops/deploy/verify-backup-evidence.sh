#!/usr/bin/env bash
set -euo pipefail
umask 077

# This is the repository-side adoption evidence consumer.  The contract file is
# an untrusted, secret-free index; every assertion which matters to adoption is
# recomputed from the archive, its one checksum row, each configured remote, and
# the signed rehearsal bundle.
refuse() { printf 'backup evidence refused: %s\n' "$1" >&2; exit 1; }
[[ $# -eq 2 && "$1" == --release-sha && "$2" =~ ^[0-9a-f]{40}$ ]] || refuse 'usage: verify-backup-evidence.sh --release-sha FULL_LOWERCASE_SHA'
release_sha="$2"
backup_env_file="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
[[ -f "$backup_env_file" && ! -L "$backup_env_file" && -r "$backup_env_file" ]] || refuse 'backup environment is missing or unsafe'
# shellcheck disable=SC1090
source "$backup_env_file"

fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
contract_file="${BACKUP_EVIDENCE_CONTRACT_FILE:-}"
backup_root="${BACKUP_ROOT:-}"
age_identity="${BACKUP_AGE_IDENTITY_FILE:-}"
rehearsal_verify="${REHEARSAL_VERIFY_COMMAND:-}"
trusted_key="${REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY:-}"
[[ "$contract_file" == /* && "$contract_file" != / && -f "$contract_file" && ! -L "$contract_file" && -r "$contract_file" ]] || refuse 'structured backup evidence contract is missing or unsafe'
[[ "$backup_root" == /* && "$backup_root" != / && -d "$backup_root" && ! -L "$backup_root" ]] || refuse 'backup root is missing or unsafe'
[[ "$age_identity" == /* && -f "$age_identity" && ! -L "$age_identity" && -r "$age_identity" ]] || refuse 'backup age identity is missing or unsafe'
[[ "$rehearsal_verify" == /* && -x "$rehearsal_verify" && ! -L "$rehearsal_verify" ]] || refuse 'rehearsal verifier is missing or unsafe'
[[ "$trusted_key" == /* && -f "$trusted_key" && ! -L "$trusted_key" && -r "$trusted_key" ]] || refuse 'rehearsal verification key is missing or unsafe'

if [[ "$fixture_mode" != 1 ]]; then
  [[ "$contract_file" == /var/lib/quest-esports/backup-evidence/release.env ]] || refuse 'backup evidence contract path is not canonical'
  [[ "$rehearsal_verify" == /var/www/QuestEsports/ops/rehearsal/verify-rehearsal-evidence.sh ]] || refuse 'rehearsal verifier path is not canonical'
  deploy_gid="$(id -g deploy 2>/dev/null)" || refuse 'deploy group is unavailable'
  [[ "$(stat -c '%u:%g %a' "$contract_file" 2>/dev/null)" == "0:${deploy_gid} 640" ]] || refuse 'backup evidence contract must be root:deploy mode 0640'
fi

declare -A contract=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || refuse 'structured evidence contract is malformed'
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  [[ -z "${contract[$key]+x}" ]] || refuse 'structured evidence contract contains a duplicate field'
  case "$key" in
    format_version|record_type|release_sha|archive_name|archive_sha256|checksum_sha256|backup_result_sha256|remote_labels|rehearsal_evidence_dir|freshness_status|archive_status|decryption_status|remote_status|rehearsal_status) ;;
    *) refuse 'structured evidence contract contains an unknown field' ;;
  esac
  [[ "$value" != *://* && "$value" != *'@'* ]] || refuse 'structured evidence contract contains a URL or credential'
  contract["$key"]="$value"
done < "$contract_file"
for key in format_version record_type release_sha archive_name archive_sha256 checksum_sha256 backup_result_sha256 remote_labels rehearsal_evidence_dir freshness_status archive_status decryption_status remote_status rehearsal_status; do
  [[ -n "${contract[$key]:-}" ]] || refuse "structured evidence contract is missing $key"
done
[[ "${contract[format_version]}" == 1 && "${contract[record_type]}" == quest-release-backup-evidence && "${contract[release_sha]}" == "$release_sha" ]] || refuse 'structured evidence contract is not bound to the requested release'
[[ "${contract[archive_name]}" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ ]] || refuse 'structured evidence archive name is invalid'
for key in archive_sha256 checksum_sha256 backup_result_sha256; do [[ "${contract[$key]}" =~ ^[a-fA-F0-9]{64}$ ]] || refuse "structured evidence $key is malformed"; done
[[ "${contract[freshness_status]}" == verified && "${contract[archive_status]}" == verified && "${contract[decryption_status]}" == verified && "${contract[remote_status]}" == verified && "${contract[rehearsal_status]}" == verified ]] || refuse 'structured evidence statuses are incomplete'

archive="$backup_root/${contract[archive_name]}"
checksum="$archive.sha256"
result="$archive.results"
[[ -f "$archive" && ! -L "$archive" && -f "$checksum" && ! -L "$checksum" && -f "$result" && ! -L "$result" ]] || refuse 'release-bound backup artifacts are missing or unsafe'
[[ "$(wc -l < "$checksum" | tr -d ' ')" == 1 ]] || refuse 'archive checksum must contain exactly one row'
checksum_line="$(tr -d '\r' < "$checksum")"
[[ "$checksum_line" =~ ^([a-fA-F0-9]{64})[[:space:]]+\*?${contract[archive_name]}$ ]] || refuse 'archive checksum does not name the selected archive'
actual_archive_sha="$(sha256sum -- "$archive" | awk '{print $1}')"
[[ "$actual_archive_sha" == "${BASH_REMATCH[1]}" && "$actual_archive_sha" == "${contract[archive_sha256]}" ]] || refuse 'archive checksum is not bound to the selected archive'
actual_checksum_sha="$(sha256sum -- "$checksum" | awk '{print $1}')"
[[ "$actual_checksum_sha" == "${contract[checksum_sha256]}" ]] || refuse 'checksum evidence hash does not match'

result_text="$(cat "$result")"
[[ "$result_text" == *$'\n'* ]] || true
grep -Fx "archive=${contract[archive_name]}" "$result" >/dev/null || refuse 'backup result names a different archive'
grep -Fx "release_sha=$release_sha" "$result" >/dev/null || refuse 'backup result is not release-bound'
grep -Fx 'status=success' "$result" >/dev/null || refuse 'backup result is not successful'
grep -Fx 'exit_status=0' "$result" >/dev/null || refuse 'backup result does not have terminal exit status zero'
actual_result_sha="$(sha256sum -- "$result" | awk '{print $1}')"
[[ "$actual_result_sha" == "${contract[backup_result_sha256]}" ]] || refuse 'backup result evidence hash does not match'

maximum_age_minutes="${BACKUP_MAX_AGE_MINUTES:-2160}"
[[ "$maximum_age_minutes" =~ ^[1-9][0-9]*$ ]] || refuse 'backup freshness limit is invalid'
archive_mtime="$(stat -c '%Y' -- "$archive" 2>/dev/null)" || refuse 'archive timestamp cannot be inspected'
now="$(date -u +%s)"
[[ "$archive_mtime" =~ ^[0-9]+$ && "$archive_mtime" -le "$now" && $((now - archive_mtime)) -le $((maximum_age_minutes * 60)) ]] || refuse 'archive is stale or from the future'

scratch="$(mktemp -d "${TMPDIR:-/tmp}/quest-backup-evidence.XXXXXXXX")" || refuse 'temporary verification directory could not be created'
cleanup() { local status=$?; rm -rf -- "$scratch"; exit "$status"; }
trap cleanup EXIT
age --decrypt --identity "$age_identity" --output "$scratch/payload.tar.gz" "$archive" >/dev/null 2>&1 || refuse 'archive decryption failed'
tar --list --gzip --file="$scratch/payload.tar.gz" >"$scratch/list" 2>/dev/null || refuse 'decrypted archive is not a gzip tar'
grep -Eq '(^|/)\.\.(\/|$)|^/' "$scratch/list" && refuse 'decrypted archive contains unsafe paths'
tar --extract --gzip --no-same-owner --no-same-permissions --file="$scratch/payload.tar.gz" --directory="$scratch" >/dev/null 2>&1 || refuse 'decrypted archive extraction failed'
manifest="$scratch/manifest.txt"
[[ -f "$manifest" && ! -L "$manifest" ]] || refuse 'decrypted archive manifest is missing'
manifest_value() { grep -m1 "^$1=" "$manifest" | cut -d= -f2-; }
[[ "$(manifest_value release_sha)" == "$release_sha" ]] || refuse 'decrypted archive manifest is not bound to the requested release'
[[ "$(manifest_value database_scope)" == application_public_and_valorant_schemas && "$(manifest_value valorant_schema_included)" == true ]] || refuse 'decrypted archive schema scope is incomplete'
[[ "$(manifest_value public_upload_inventory)" == public-upload-inventory.tsv && "$(manifest_value private_upload_inventory)" == private-upload-inventory.tsv ]] || refuse 'decrypted archive upload inventories are missing'
for root in public private; do [[ -d "$scratch/$root" && ! -L "$scratch/$root" ]] || refuse 'decrypted archive upload root is missing'; done
for inventory in public private; do
  file="$scratch/${inventory}-upload-inventory.tsv"
  [[ -f "$file" && ! -L "$file" ]] || refuse 'decrypted archive upload inventory is missing'
  expected="$(manifest_value "${inventory}_upload_inventory_sha256")"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "$(sha256sum "$file" | awk '{print $1}')" == "$expected" ]] || refuse 'decrypted archive upload inventory hash is invalid'
done

inventory_tree() {
  local root="$1" output="$2" entry relative digest bytes
  : > "$output"
  while IFS= read -r -d '' entry; do
    relative="${entry#"$root"/}"
    [[ "$relative" != *$'\n'* && "$relative" != *$'\r'* && "$relative" != *$'\t'* ]] || return 1
    if [[ -L "$entry" ]]; then return 1
    elif [[ -d "$entry" ]]; then printf 'directory\t%s\n' "$relative" >> "$output"
    elif [[ -f "$entry" ]]; then
      digest="$(sha256sum -- "$entry" | awk '{print $1}')" || return 1
      bytes="$(stat -c '%s' -- "$entry")" || return 1
      printf 'file\t%s\t%s\t%s\n' "$relative" "$bytes" "$digest" >> "$output"
    else return 1
    fi
  done < <(find -P "$root" -mindepth 1 -print0 | sort -z)
}
for inventory in public private; do
  inventory_tree "$scratch/$inventory" "$scratch/${inventory}.actual" || refuse 'decrypted upload tree cannot be inventoried'
  cmp -s "$scratch/${inventory}-upload-inventory.tsv" "$scratch/${inventory}.actual" || refuse 'decrypted upload tree does not match its source inventory'
done

declare -A remote_by_label=()
declare -A config_by_label=()
remote_entries="${BACKUP_RCLONE_REMOTES:-}"
[[ -n "$remote_entries" ]] || refuse 'configured backup remotes are missing'
config_entries="${BACKUP_RCLONE_CONFIGS:-}"
[[ -n "$config_entries" ]] || refuse 'configured remote credentials are missing'
while IFS= read -r config_entry || [[ -n "$config_entry" ]]; do
  [[ "$config_entry" == *=* ]] || refuse 'configured remote credential is malformed'
  label="${config_entry%%=*}"; config="${config_entry#*=}"
  [[ "$label" =~ ^[A-Za-z0-9._-]+$ && "$config" == /* && -r "$config" && ! -L "$config" ]] || refuse 'configured remote credential is unsafe'
  [[ -z "${config_by_label[$label]+x}" ]] || refuse 'configured remote credentials contain a duplicate label'
  config_by_label["$label"]="$config"
done <<< "$config_entries"
while IFS= read -r remote_entry || [[ -n "$remote_entry" ]]; do
  [[ "$remote_entry" == *=* ]] || refuse 'configured backup remote is malformed'
  label="${remote_entry%%=*}"; remote="${remote_entry#*=}"
  [[ "$label" =~ ^[A-Za-z0-9._-]+$ && "$remote" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]] || refuse 'configured backup remote is unsafe'
  [[ -z "${remote_by_label[$label]+x}" ]] || refuse 'configured backup remotes contain a duplicate label'
  remote_by_label["$label"]="$remote"
done <<< "$remote_entries"
IFS=',' read -ra contract_labels <<< "${contract[remote_labels]:-}"
# The contract intentionally lists the exact labels independently of remote
# destinations, so a missing, extra, or renamed configured remote fails closed.
[[ ${#contract_labels[@]} -eq ${#remote_by_label[@]} && ${#contract_labels[@]} -gt 0 ]] || refuse 'remote evidence label set is incomplete'
[[ ${#config_by_label[@]} -eq ${#remote_by_label[@]} ]] || refuse 'configured remote credential set is incomplete'
for label in "${contract_labels[@]}"; do
  [[ -n "${remote_by_label[$label]+x}" ]] || refuse 'remote evidence label set does not match configuration'
  remote="${remote_by_label[$label]}"
  config="${config_by_label[$label]:-}"
  [[ -r "$config" ]] || refuse 'remote configuration is unavailable'
  rclone check "$backup_root" "${remote%/}" --config "$config" --one-way --include "/${contract[archive_name]}" --include "/${contract[archive_name]}.sha256" --quiet >/dev/null 2>&1 || refuse 'configured remote does not contain the verified archive pair'
done

[[ "${contract[rehearsal_evidence_dir]}" == /* && "${contract[rehearsal_evidence_dir]}" != / && -d "${contract[rehearsal_evidence_dir]}" && ! -L "${contract[rehearsal_evidence_dir]}" ]] || refuse 'rehearsal evidence directory is missing or unsafe'
REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY="$trusted_key" "$rehearsal_verify" "$archive" "${contract[rehearsal_evidence_dir]}" >/dev/null 2>&1 || refuse 'signed rehearsal evidence verification failed'
echo "verified-complete release_sha=$release_sha schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified"
