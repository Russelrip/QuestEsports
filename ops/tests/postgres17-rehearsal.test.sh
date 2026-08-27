#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"; rehearsal="$root/ops/rehearsal/postgres17-restore-rehearsal.sh"; verify="$root/ops/rehearsal/verify-rehearsal-evidence.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/quest-rehearsal-test.XXXXXXXX")"; trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/evidence" "$tmp/public" "$tmp/private" "$tmp/ca"; chmod 700 "$tmp" "$tmp/evidence" "$tmp/public" "$tmp/private" "$tmp/ca"
printf 'fixture identity\n' > "$tmp/identity"; printf 'fixture ca\n' > "$tmp/ca/ca.crt"; chmod 600 "$tmp/identity" "$tmp/ca/ca.crt"
printf 'not an archive\n' > "$tmp/archive.tar.gz.enc"; cat > "$tmp/recovery.env" <<EOF
DIRECT_URL=postgresql://restore:fixture@127.0.0.1:55432/quest_restore
UPLOAD_ROOT=$tmp/public
PRIVATE_UPLOAD_ROOT=$tmp/private
BACKUP_AGE_IDENTITY_FILE=$tmp/identity
EOF
chmod 600 "$tmp/recovery.env"; printf '0%.0s' {1..64} > "$tmp/archive.tar.gz.enc.sha256"; printf '  %s\n' "$(basename "$tmp/archive.tar.gz.enc")" >> "$tmp/archive.tar.gz.enc.sha256"
for command in age psql pg_restore pg_dump rsync; do printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$1" == --version ]]; then echo "fixture (PostgreSQL) 17.4"; exit 0; fi' '[[ "$(basename "$0")" == age ]] && exit 1' 'exit 0' > "$tmp/bin/$command"; chmod 700 "$tmp/bin/$command"; done
refused() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then echo "FAIL: $label accepted" >&2; exit 1; fi; echo "ok: $label"; }
refused "missing confirmation" env REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" bash "$rehearsal" "$tmp/archive.tar.gz.enc"
sed 's#127.0.0.1:55432#prod-db.example:5432#' "$tmp/recovery.env" > "$tmp/production.env"; chmod 600 "$tmp/production.env"
refused "production-looking target" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/production.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/archive.tar.gz.enc"
cp "$tmp/recovery.env" "$tmp/nested.env"; sed -i "s#PRIVATE_UPLOAD_ROOT=.*#PRIVATE_UPLOAD_ROOT=$tmp/public/nested#" "$tmp/nested.env"; chmod 600 "$tmp/nested.env"
refused "nested roots" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/nested.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/archive.tar.gz.enc"
refused "bad checksum" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/archive.tar.gz.enc"
printf '%s  %s\n' "$(sha256sum "$tmp/archive.tar.gz.enc" | cut -d' ' -f1)" "$(basename "$tmp/archive.tar.gz.enc")" > "$tmp/archive.tar.gz.enc.sha256"
refused "decryption failure" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/archive.tar.gz.enc"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; sha() { for _ in {1..64}; do printf '%s' "$1"; done; }
printf '%s\n' "format_version=1" "evidence_status=complete" "rehearsal_mode=disposable" "restore_status=verified" "created_at_utc=$now" "restore_start_utc=$now" "restore_end_utc=$now" "restore_duration_seconds=12" "archive_name=quest-production-fixture.tar.gz.enc" "archive_sha256=$(sha a)" "checksum_status=verified" "decryption_status=verified" "manifest_database_scope=application_public_and_valorant_schemas" "manifest_valorant_schema_included=true" "source_postgres_major=17" "source_major_gate=none" "client_psql_major=17" "client_pg_restore_major=17" "client_pg_dump_major=17" "public_table_count=2" "valorant_table_count=2" "public_object_count=3" "valorant_object_count=3" "quest_migration_ledger_status=verified" "quest_migration_count=4" "valorant_migration_ledger_status=verified" "valorant_migration_count=4" "roles_status=verified" "owners_status=verified" "grants_status=verified" "default_acl_status=verified" "extensions_status=verified" "extensions_count=1" "settings_status=verified" "rls_status=verified" "rls_enabled_table_count=2" "rls_table_count=2" "public_upload_file_count=1" "public_upload_byte_count=10" "public_upload_checksum=$(sha b)" "private_upload_file_count=1" "private_upload_byte_count=10" "private_upload_checksum=$(sha c)" "quest_liveness_status=ok" "quest_readiness_status=ok" "quest_database_status=up" "valorant_health_status=ok" "valorant_database_status=up" "valorant_ca_status=verified" "freeze_mode=validation" "writers_disabled=true" "mutation_rejection=verified" "no_writer_admission=verified" "failure_injection_bad_checksum=passed" "failure_injection_bad_decryption=passed" "failure_injection_wrong_ca=passed" "failure_injection_blocked_network=passed" "failure_injection_failed_service_health=passed" "failure_injection_attempted_mutation_callback=passed" "resource_cpu_seconds=1.2" "resource_peak_memory_kb=2048" "resource_disk_bytes=4096" "rto_seconds=30" "rto_decision=met" > "$tmp/evidence/rehearsal-evidence.env"; chmod 600 "$tmp/evidence/rehearsal-evidence.env"
sed -i 's/source_major_gate=none/source_major_gate=none\ntarget_postgres_major=17/' "$tmp/evidence/rehearsal-evidence.env"
bash "$verify" "$tmp/evidence" >/dev/null; echo "ok: valid evidence"
sed -i 's/manifest_valorant_schema_included=true/manifest_valorant_schema_included=false/' "$tmp/evidence/rehearsal-evidence.env"; refused "incomplete manifest evidence" bash "$verify" "$tmp/evidence"
sed -i 's/manifest_valorant_schema_included=false/manifest_valorant_schema_included=true/; s/valorant_health_status=ok/valorant_health_status=failed/' "$tmp/evidence/rehearsal-evidence.env"; refused "wrong health evidence" bash "$verify" "$tmp/evidence"
sed -i 's/valorant_health_status=failed/valorant_health_status=ok/; s/valorant_ca_status=verified/valorant_ca_status=failed/' "$tmp/evidence/rehearsal-evidence.env"; refused "wrong CA evidence" bash "$verify" "$tmp/evidence"
sed -i 's/valorant_ca_status=failed/valorant_ca_status=verified/; s/freeze_mode=validation/freeze_mode=off/' "$tmp/evidence/rehearsal-evidence.env"; refused "blocked writer/freeze evidence" bash "$verify" "$tmp/evidence"
echo "PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted)."
