#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { echo "Restore rehearsal evidence refused: $1" >&2; exit 1; }
[[ $# -eq 1 ]] || fail "usage: verify-rehearsal-evidence.sh /absolute/evidence-directory"
dir="$1"
[[ "$dir" == /* && "$dir" != / && -d "$dir" && ! -L "$dir" ]] || fail "evidence directory is missing or unsafe"
mode="$(stat -c '%a' -- "$dir" 2>/dev/null)"; [[ "$mode" =~ ^[0-7]+$ ]] && (( (8#$mode & 077) == 0 )) || fail "evidence directory is not private"
case "${dir,,}" in *questesports*|*supabase*|*production*|*/var/www/*|*/srv/quest-esports/*) fail "evidence directory looks like production" ;; esac
file="$dir/rehearsal-evidence.env"; [[ -f "$file" && ! -L "$file" ]] || fail "machine-readable evidence is missing"
mode="$(stat -c '%a' -- "$file" 2>/dev/null)"; [[ "$mode" =~ ^[0-7]+$ ]] && (( (8#$mode & 077) == 0 )) || fail "evidence file is not private"
declare -A e=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || fail "evidence has a malformed line"
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"; [[ -z "${e[$key]+x}" ]] || fail "evidence contains duplicate fields"; e["$key"]="$value"
  [[ "$key" == archive_name || ( "$value" != *://* && "$value" != */* && "$value" != *@* ) ]] || fail "evidence contains a URL/path"
  case "${value,,}" in *questesports*|*supabase*|*production*|*paris*|*/var/www/*|*/srv/quest-esports/*) [[ "$key" == archive_name ]] || fail "evidence looks like production" ;; esac
done < "$file"
required=(format_version evidence_status rehearsal_mode restore_status created_at_utc restore_start_utc restore_end_utc restore_duration_seconds archive_name archive_sha256 checksum_status decryption_status manifest_database_scope manifest_valorant_schema_included source_postgres_major target_postgres_major source_major_gate client_psql_major client_pg_restore_major client_pg_dump_major public_table_count valorant_table_count public_object_count valorant_object_count quest_migration_ledger_status quest_migration_count valorant_migration_ledger_status valorant_migration_count roles_status owners_status grants_status default_acl_status extensions_status extensions_count settings_status rls_status rls_enabled_table_count rls_table_count public_upload_file_count public_upload_byte_count public_upload_checksum private_upload_file_count private_upload_byte_count private_upload_checksum quest_liveness_status quest_readiness_status quest_database_status valorant_health_status valorant_database_status valorant_ca_status freeze_mode writers_disabled mutation_rejection no_writer_admission failure_injection_bad_checksum failure_injection_bad_decryption failure_injection_wrong_ca failure_injection_blocked_network failure_injection_failed_service_health failure_injection_attempted_mutation_callback resource_cpu_seconds resource_peak_memory_kb resource_disk_bytes rto_seconds rto_decision)
for key in "${required[@]}"; do [[ -n "${e[$key]:-}" ]] || fail "required field missing: $key"; done
for key in "${!e[@]}"; do found=false; for known in "${required[@]}"; do [[ "$key" == "$known" ]] && found=true; done; [[ "$found" == true ]] || fail "unknown evidence field: $key"; done
[[ "${e[format_version]}" == 1 && "${e[evidence_status]}" == complete && "${e[rehearsal_mode]}" == disposable && "${e[restore_status]}" == verified ]] || fail "evidence is not complete disposable runtime evidence"
[[ "${e[manifest_database_scope]}" == application_public_and_valorant_schemas && "${e[manifest_valorant_schema_included]}" == true ]] || fail "manifest scope is incomplete"
[[ "${e[checksum_status]}" == verified && "${e[decryption_status]}" == verified && "${e[archive_sha256]}" =~ ^[a-fA-F0-9]{64}$ ]] || fail "archive integrity evidence is incomplete"
[[ "${e[source_postgres_major]}" =~ ^[0-9]+$ && "${e[source_postgres_major]}" -gt 0 ]] || fail "source major is invalid"
if [[ "${e[source_postgres_major]}" == 17 ]]; then [[ "${e[source_major_gate]}" == none ]] || fail "unexpected major-migration gate"; else [[ "${e[source_major_gate]}" == approved_logical_major_migration ]] || fail "source-major migration gate is missing"; fi
for key in client_psql_major client_pg_restore_major client_pg_dump_major; do [[ "${e[$key]}" == 17 ]] || fail "client is not PostgreSQL 17: $key"; done
[[ "${e[target_postgres_major]}" == 17 ]] || fail "target server is not PostgreSQL 17"
for key in public_table_count valorant_table_count public_object_count valorant_object_count quest_migration_count valorant_migration_count rls_enabled_table_count rls_table_count; do [[ "${e[$key]}" =~ ^[0-9]+$ && "${e[$key]}" -gt 0 ]] || fail "non-zero runtime evidence is missing: $key"; done
for key in roles_status owners_status grants_status default_acl_status extensions_status settings_status rls_status quest_migration_ledger_status valorant_migration_ledger_status valorant_ca_status; do [[ "${e[$key]}" == verified ]] || fail "status is not verified: $key"; done
for key in public_upload_file_count public_upload_byte_count private_upload_file_count private_upload_byte_count resource_peak_memory_kb resource_disk_bytes rto_seconds; do [[ "${e[$key]}" =~ ^[0-9]+$ ]] || fail "numeric evidence is malformed: $key"; done
for key in public_upload_checksum private_upload_checksum; do [[ "${e[$key]}" =~ ^[a-fA-F0-9]{64}$ ]] || fail "upload checksum is malformed: $key"; done
for key in quest_liveness_status quest_readiness_status valorant_health_status; do [[ "${e[$key]}" == ok ]] || fail "health status is not ok: $key"; done
[[ "${e[quest_database_status]}" == up && "${e[valorant_database_status]}" == up ]] || fail "database health is not up"
[[ "${e[freeze_mode]}" == validation && "${e[writers_disabled]}" == true && "${e[mutation_rejection]}" == verified && "${e[no_writer_admission]}" == verified ]] || fail "freeze evidence is incomplete"
for key in failure_injection_bad_checksum failure_injection_bad_decryption failure_injection_wrong_ca failure_injection_blocked_network failure_injection_failed_service_health failure_injection_attempted_mutation_callback; do [[ "${e[$key]}" == passed ]] || fail "failure injection is not passed: $key"; done
[[ "${e[resource_cpu_seconds]}" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail "CPU resource evidence is malformed"
[[ "${e[rto_decision]}" == met || "${e[rto_decision]}" == not_met ]] || fail "RTO decision is missing"
for key in created_at_utc restore_start_utc restore_end_utc; do [[ "${e[$key]}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail "timestamp is malformed: $key"; date -u -d "${e[$key]}" +%s >/dev/null 2>&1 || fail "timestamp is invalid: $key"; done
now="$(date -u +%s)"; end="$(date -u -d "${e[restore_end_utc]}" +%s)"; age=$((now-end)); max_age="${REHEARSAL_EVIDENCE_MAX_AGE_SECONDS:-604800}"
[[ "$max_age" =~ ^[0-9]+$ && "$age" -ge 0 && "$age" -le "$max_age" ]] || fail "evidence is stale or from the future"
[[ "${e[restore_duration_seconds]}" =~ ^[0-9]+$ ]] || fail "restore duration is malformed"
echo "Restore rehearsal evidence verified: complete disposable PostgreSQL 17 two-schema evidence."
