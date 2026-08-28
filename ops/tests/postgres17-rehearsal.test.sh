#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"; rehearsal="$root/ops/rehearsal/postgres17-restore-rehearsal.sh"; verify="$root/ops/rehearsal/verify-rehearsal-evidence.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/quest-rehearsal-test.XXXXXXXX")"; trap 'rm -rf -- "$tmp"' EXIT
archive_scope_binding="$(grep -F 'archive_scope="$(manifest_value database_scope)"' "$rehearsal" 2>/dev/null || true)"
[[ -n "$archive_scope_binding" ]] || { echo "FAIL: archive manifest scope must be bound to a distinct variable" >&2; exit 1; }
grant_scope_loop="$(grep -F "while IFS='|' read -r kind grant_scope role privilege granted;" "$rehearsal" 2>/dev/null || true)"
[[ -n "$grant_scope_loop" ]] || { echo "FAIL: grant loop must not overwrite archive scope" >&2; exit 1; }
raw_scope_emission="$(grep -F "'manifest_scope=%s" "$rehearsal" 2>/dev/null || true)"
[[ "$raw_scope_emission" == *'"$archive_scope"'* ]] || { echo "FAIL: raw observations must emit the preserved archive scope" >&2; exit 1; }
summary_scope_emission="$(grep -F 'manifest_database_scope=%s' "$rehearsal" 2>/dev/null || true)"
[[ "$summary_scope_emission" == *'"$archive_scope"'* ]] || { echo "FAIL: summary must emit the preserved archive scope" >&2; exit 1; }
for restore_flag in --no-owner --no-acl --single-transaction --exit-on-error; do
  grep -F -- "$restore_flag" "$root/ops/restore-production-backup.sh" >/dev/null || { echo "FAIL: restore primitive is missing $restore_flag" >&2; exit 1; }
done
grep -F 'part" != ..' "$rehearsal" >/dev/null || { echo "FAIL: rehearsal paths must reject traversal components" >&2; exit 1; }
grep -F 'REHEARSAL_RPO_SECONDS' "$rehearsal" >/dev/null || { echo "FAIL: rehearsal must require an approved RPO" >&2; exit 1; }
grep -F 'quest_migration_ledger_before_status' "$verify" >/dev/null || { echo "FAIL: verifier must require pre-restore ledger evidence" >&2; exit 1; }
role_query="$(grep -F 'psql_query "$scratch/roles"' "$rehearsal" 2>/dev/null || true)"; for attribute in rolcanlogin rolinherit rolsuper rolcreatedb rolcreaterole rolreplication rolbypassrls; do [[ "$role_query" == *"CASE WHEN $attribute THEN 't' ELSE 'f' END"* ]] || { echo "FAIL: role query does not emit canonical t/f for $attribute" >&2; exit 1; }; done
[[ "$role_query" == *"ORDER BY rolname"* ]] || { echo "FAIL: role inventory ordering changed" >&2; exit 1; }
membership_query="$(grep -F 'psql_query "$scratch/memberships"' "$rehearsal" 2>/dev/null || true)"
[[ "$membership_query" == *'SELECT count(*) FROM'* ]] || { echo "FAIL: membership query must emit an explicit count" >&2; exit 1; }
for role in quest_migrator quest_runtime val_migrator val_runtime; do [[ "$membership_query" == *"'$role'"* ]] || { echo "FAIL: membership query is not restricted to the four database roles" >&2; exit 1; }; done
[[ "$membership_query" == *"WHERE granted.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime') OR member.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime')"* ]] || { echo "FAIL: membership query role restriction changed" >&2; exit 1; }
membership_count_validation="$(grep -F 'membership_count="$(tr -d '\''[:space:]'\'' < "$scratch/memberships")"' "$rehearsal" 2>/dev/null || true)"
[[ "$membership_count_validation" == *'[[ "$membership_count" == 0 ]]'* ]] || { echo "FAIL: membership count must validate an explicit zero" >&2; exit 1; }
for aggregate_query in "$(grep -F 'psql_query "$scratch/grants-status"' "$rehearsal" 2>/dev/null || true)" "$(grep -F 'psql_query "$scratch/grant-aggregate"' "$rehearsal" 2>/dev/null || true)"; do
  [[ "$aggregate_query" == *"WHERE n.nspname='public' AND c.relkind='S'), true)"* && "$aggregate_query" == *"WHERE n.nspname='valorant' AND c.relkind='S'), true)"* ]] || { echo "FAIL: empty sequence aggregates must default to true" >&2; exit 1; }
  [[ "$aggregate_query" == *"WHERE n.nspname='public' AND c.relkind IN ('r','p','f')), false)"* && "$aggregate_query" == *"WHERE n.nspname='valorant' AND c.relkind IN ('r','p','f')), false)"* ]] || { echo "FAIL: empty table aggregates must default to false" >&2; exit 1; }
done
grant_inventory_query="$(grep -F 'psql_query "$scratch/grants"' "$rehearsal" 2>/dev/null || true)"
for privilege in \
  "has_schema_privilege('quest_migrator','public','USAGE')" \
  "has_schema_privilege('quest_migrator','public','CREATE')" \
  "has_schema_privilege('quest_runtime','public','USAGE')" \
  "has_schema_privilege('val_migrator','valorant','USAGE')" \
  "has_schema_privilege('val_migrator','valorant','CREATE')" \
  "has_schema_privilege('val_runtime','valorant','USAGE')"; do
  [[ "$grant_inventory_query" == *"CASE WHEN $privilege THEN 't' ELSE 'f' END"* ]] || { echo "FAIL: detailed grant inventory does not emit canonical t/f for $privilege" >&2; exit 1; }
done
for denied_privilege in \
  "has_schema_privilege('quest_runtime','valorant','USAGE')" \
  "has_schema_privilege('val_runtime','public','USAGE')"; do
  [[ "$grant_inventory_query" == *"CASE WHEN NOT $denied_privilege THEN 't' ELSE 'f' END"* ]] || { echo "FAIL: denied grant inventory does not emit canonical t/f for $denied_privilege" >&2; exit 1; }
done
grant_aggregate_query="$(grep -F 'psql_query "$scratch/grant-aggregate"' "$rehearsal" 2>/dev/null || true)"
for aggregate_prefix in \
  'table|public|quest_runtime|all' \
  'table|valorant|val_runtime|all' \
  'sequence|public|quest_runtime|usage_select' \
  'sequence|valorant|val_runtime|usage_select'; do
  [[ "$grant_aggregate_query" == *"SELECT '$aggregate_prefix|' || CASE WHEN COALESCE((SELECT bool_and("* ]] || { echo "FAIL: grant aggregate does not emit canonical t/f for $aggregate_prefix" >&2; exit 1; }
done
[[ "$(grep -o "THEN 't' ELSE 'f' END" <<< "$grant_aggregate_query" | wc -l | tr -d ' ')" == 4 ]] || { echo "FAIL: grant aggregate must canonicalize all four boolean fields" >&2; exit 1; }
acl_query="$(grep -F 'psql_query "$scratch/acl"' "$rehearsal" 2>/dev/null || true)"
[[ "$acl_query" == *"d.defaclobjtype::text"* ]] || { echo "FAIL: default ACL inventory must cast defaclobjtype to text" >&2; exit 1; }
[[ "$acl_query" == *"COALESCE(array_to_string(d.defaclacl,','),'')"* && "$acl_query" == *"ORDER BY r.rolname,n.nspname,d.defaclobjtype"* ]] || { echo "FAIL: default ACL inventory behavior changed" >&2; exit 1; }
rls_policy_check="$(grep -F 'VALORANT table lacks its val_runtime RLS policy' "$rehearsal" 2>/dev/null || true)"
[[ "$rls_policy_check" == *'"$command" == '\''ALL'\'''* ]] || { echo "FAIL: VALORANT RLS policy command must use canonical ALL" >&2; exit 1; }
extension_count_computation="$(grep -F 'extensions_count="$(wc -l < "$scratch/ext"' "$rehearsal" 2>/dev/null || true)"
[[ -n "$extension_count_computation" ]] || { echo "FAIL: extension count must be computed from the inventory" >&2; exit 1; }
summary_extension_count="$(grep -F 'extensions_count=%s' "$rehearsal" 2>/dev/null || true)"
[[ "$summary_extension_count" == *'"$extensions_count"'* ]] || { echo "FAIL: summary must emit the computed extension count" >&2; exit 1; }
mkdir -p "$tmp/bin" "$tmp/evidence" "$tmp/public" "$tmp/private" "$tmp/ca"; chmod 700 "$tmp" "$tmp/evidence" "$tmp/public" "$tmp/private" "$tmp/ca"
printf 'fixture identity\n' > "$tmp/identity"; printf 'fixture ca\n' > "$tmp/ca/ca.crt"; chmod 600 "$tmp/identity" "$tmp/ca/ca.crt"
printf 'source_major=17\nsource_version=PostgreSQL_17.4\nprovenance=operator_recorded\n' > "$tmp/source-version.env"; chmod 600 "$tmp/source-version.env"
printf 'not an archive\n' > "$tmp/quest-production-20260827T000000Z.tar.gz.enc"; cat > "$tmp/recovery.env" <<EOF
DIRECT_URL=postgresql://restore:fixture@127.0.0.1:55432/quest_restore
UPLOAD_ROOT=$tmp/public
PRIVATE_UPLOAD_ROOT=$tmp/private
BACKUP_AGE_IDENTITY_FILE=$tmp/identity
EOF
chmod 600 "$tmp/recovery.env"; printf '0%.0s' {1..64} > "$tmp/quest-production-20260827T000000Z.tar.gz.enc.sha256"; printf '  %s\n' "$(basename "$tmp/quest-production-20260827T000000Z.tar.gz.enc")" >> "$tmp/quest-production-20260827T000000Z.tar.gz.enc.sha256"
for command in age psql pg_restore pg_dump rsync; do printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$1" == --version ]]; then echo "fixture (PostgreSQL) 17.4"; exit 0; fi' '[[ "$(basename "$0")" == age ]] && exit 1' 'exit 0' > "$tmp/bin/$command"; chmod 700 "$tmp/bin/$command"; done
refused() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then echo "FAIL: $label accepted" >&2; exit 1; fi; echo "ok: $label"; }
refused "missing confirmation" env REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
sed 's#127.0.0.1:55432#prod-db.example:5432#' "$tmp/recovery.env" > "$tmp/production.env"; chmod 600 "$tmp/production.env"
refused "production-looking target" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/production.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
cp "$tmp/recovery.env" "$tmp/nested.env"; sed -i "s#PRIVATE_UPLOAD_ROOT=.*#PRIVATE_UPLOAD_ROOT=$tmp/public/nested#" "$tmp/nested.env"; chmod 600 "$tmp/nested.env"
refused "nested roots" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/nested.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
cp "$tmp/recovery.env" "$tmp/traversal.env"; sed -i "s#PRIVATE_UPLOAD_ROOT=.*#PRIVATE_UPLOAD_ROOT=$tmp/private/../private-target#" "$tmp/traversal.env"; chmod 600 "$tmp/traversal.env"
refused "traversal target" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/traversal.env" SOURCE_VERSION_EVIDENCE_FILE="$tmp/source-version.env" POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
refused "bad checksum" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" SOURCE_POSTGRES_MAJOR=17 POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
printf '%s  %s\n' "$(sha256sum "$tmp/quest-production-20260827T000000Z.tar.gz.enc" | cut -d' ' -f1)" "$(basename "$tmp/quest-production-20260827T000000Z.tar.gz.enc")" > "$tmp/quest-production-20260827T000000Z.tar.gz.enc.sha256"
refused "decryption failure" env REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL REHEARSAL_EVIDENCE_DIR="$tmp/evidence" BACKUP_ENV_FILE="$tmp/recovery.env" SOURCE_VERSION_EVIDENCE_FILE="$tmp/source-version.env" POSTGRES17_BIN="$tmp/bin" bash "$rehearsal" "$tmp/quest-production-20260827T000000Z.tar.gz.enc"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; sha() { for _ in {1..64}; do printf '%s' "$1"; done; }
printf '%s\n' "format_version=1" "evidence_status=complete" "rehearsal_mode=disposable" "restore_status=verified" "created_at_utc=$now" "restore_start_utc=$now" "restore_end_utc=$now" "restore_duration_seconds=12" "archive_name=quest-production-fixture.tar.gz.enc" "archive_sha256=$(sha a)" "checksum_status=verified" "decryption_status=verified" "manifest_database_scope=application_public_and_valorant_schemas" "manifest_valorant_schema_included=true" "source_postgres_major=17" "source_major_gate=none" "client_psql_major=17" "client_pg_restore_major=17" "client_pg_dump_major=17" "public_table_count=2" "valorant_table_count=2" "public_object_count=3" "valorant_object_count=3" "quest_migration_ledger_status=verified" "quest_migration_count=4" "valorant_migration_ledger_status=verified" "valorant_migration_count=4" "roles_status=verified" "owners_status=verified" "grants_status=verified" "default_acl_status=verified" "extensions_status=verified" "extensions_count=1" "settings_status=verified" "rls_status=verified" "rls_enabled_table_count=2" "rls_table_count=2" "public_upload_file_count=1" "public_upload_byte_count=10" "public_upload_checksum=$(sha b)" "private_upload_file_count=1" "private_upload_byte_count=10" "private_upload_checksum=$(sha c)" "quest_liveness_status=ok" "quest_readiness_status=ok" "quest_database_status=up" "valorant_health_status=ok" "valorant_database_status=up" "valorant_ca_status=verified" "freeze_mode=validation" "writers_disabled=true" "mutation_rejection=verified" "no_writer_admission=verified" "failure_injection_bad_checksum=passed" "failure_injection_bad_decryption=passed" "failure_injection_wrong_ca=passed" "failure_injection_blocked_network=passed" "failure_injection_failed_service_health=passed" "failure_injection_attempted_mutation_callback=passed" "resource_cpu_seconds=1.2" "resource_peak_memory_kb=2048" "resource_disk_bytes=4096" "rto_seconds=30" "rto_decision=met" > "$tmp/evidence/rehearsal-evidence.env"; chmod 600 "$tmp/evidence/rehearsal-evidence.env"
sed -i 's/quest-production-fixture.tar.gz.enc/quest-production-20260827T000000Z.tar.gz.enc/; s/restore_duration_seconds=12/restore_duration_seconds=0/; s/source_major_gate=none/source_major_gate=none\ntarget_postgres_major=17/' "$tmp/evidence/rehearsal-evidence.env"
printf '%s\n' "source_version_provenance=operator_recorded" "source_version_record_sha256=$(sha256sum "$tmp/source-version.env" | cut -d' ' -f1)" "observations_sha256=PLACEHOLDER" "memberships_status=verified" "security_verify_status=verified" "security_verify_output_sha256=$(printf security-verified | sha256sum | cut -d' ' -f1)" "extensions_inventory_sha256=PLACEHOLDER" "settings_inventory_sha256=PLACEHOLDER" "roles_observations_sha256=PLACEHOLDER" "memberships_observations_sha256=PLACEHOLDER" "owners_observations_sha256=PLACEHOLDER" "grants_observations_sha256=PLACEHOLDER" "default_acl_observations_sha256=PLACEHOLDER" "rls_observations_sha256=PLACEHOLDER" "upload_checksum_scope=post_restore_tree" "upload_source_equivalence=not_claimed_without_source_inventory" >> "$tmp/evidence/rehearsal-evidence.env"
printf '%s\n' 'quest_migrator|t|f|f|f|f|f|f' 'quest_runtime|t|f|f|f|f|f|f' 'val_migrator|t|f|f|f|f|f|f' 'val_runtime|t|f|f|f|f|f|f' > "$tmp/evidence/rehearsal-roles.tsv"
printf 'public\tusers\tt\tusers_runtime_all\tquest_runtime\tALL\ttrue\ttrue\nvalorant\tmatches\tt\tmatches_runtime_all\tval_runtime\tALL\ttrue\ttrue\nvalorant\t_migration_ledger\tf\t<none>\t<none>\t<none>\t<none>\t<none>\n' > "$tmp/evidence/rehearsal-rls.tsv"
printf '%s\n' 'schema|public|quest_migrator|USAGE|t' 'schema|public|quest_migrator|CREATE|t' 'schema|public|quest_runtime|USAGE|t' 'schema|valorant|val_migrator|USAGE|t' 'schema|valorant|val_migrator|CREATE|t' 'schema|valorant|val_runtime|USAGE|t' 'schema|valorant|quest_runtime|USAGE_DENIED|t' 'schema|public|val_runtime|USAGE_DENIED|t' 'table|public|quest_runtime|all|t' 'table|valorant|val_runtime|all|t' 'sequence|public|quest_runtime|usage_select|t' 'sequence|valorant|val_runtime|usage_select|t' > "$tmp/evidence/rehearsal-grants.tsv"
printf '%s\n' 'quest_migrator|public|r|fixture' 'quest_migrator|public|S|fixture' 'quest_migrator|public|f|fixture' 'quest_migrator|public|T|fixture' 'val_migrator|valorant|r|fixture' 'val_migrator|valorant|S|fixture' 'val_migrator|valorant|f|fixture' 'val_migrator|valorant|T|fixture' > "$tmp/evidence/rehearsal-acl.tsv"
cp "$tmp/source-version.env" "$tmp/evidence/rehearsal-source-version.env"
printf '0\n' > "$tmp/evidence/rehearsal-memberships.tsv"; printf '%s\n' 'public|quest_migrator' 'valorant|val_migrator' > "$tmp/evidence/rehearsal-owners.tsv"; printf 'verified\n' > "$tmp/evidence/rehearsal-grants.tsv"; printf 'verified\n' > "$tmp/evidence/rehearsal-acl.tsv"; printf 'plpgsql|1.0\n' > "$tmp/evidence/rehearsal-ext.tsv"; printf '%s\n' 'server_version|17.4' 'server_version_num|170004' 'ssl|on' 'ssl_min_protocol_version|TLSv1.2' 'row_security|on' 'default_transaction_read_only|off' 'listen_addresses|*' > "$tmp/evidence/rehearsal-settings.tsv"; printf '2|2\n' > "$tmp/evidence/rehearsal-rls.tsv"
printf '0\n' > "$tmp/evidence/rehearsal-memberships.tsv"; printf '%s\n' 'schema|public|quest_migrator|USAGE|t' 'schema|public|quest_migrator|CREATE|t' 'schema|public|quest_runtime|USAGE|t' 'schema|valorant|val_migrator|USAGE|t' 'schema|valorant|val_migrator|CREATE|t' 'schema|valorant|val_runtime|USAGE|t' 'schema|valorant|quest_runtime|USAGE_DENIED|t' 'schema|public|val_runtime|USAGE_DENIED|t' 'table|public|quest_runtime|all|t' 'table|valorant|val_runtime|all|t' 'sequence|public|quest_runtime|usage_select|t' 'sequence|valorant|val_runtime|usage_select|t' > "$tmp/evidence/rehearsal-grants.tsv"; printf '%s\n' 'quest_migrator|public|r|fixture' 'quest_migrator|public|S|fixture' 'quest_migrator|public|f|fixture' 'quest_migrator|public|T|fixture' 'val_migrator|valorant|r|fixture' 'val_migrator|valorant|S|fixture' 'val_migrator|valorant|f|fixture' 'val_migrator|valorant|T|fixture' > "$tmp/evidence/rehearsal-acl.tsv"; printf 'public\tusers\tt\tusers_runtime_all\tquest_runtime\tALL\ttrue\ttrue\nvalorant\tmatches\tt\tmatches_runtime_all\tval_runtime\tALL\ttrue\ttrue\nvalorant\t_migration_ledger\tf\t<none>\t<none>\t<none>\t<none>\t<none>\n' > "$tmp/evidence/rehearsal-rls.tsv"
for artifact in roles memberships owners grants acl ext settings rls; do field="${artifact}_observations_sha256"; [[ "$artifact" == acl ]] && field=default_acl_observations_sha256; hash="$(sha256sum "$tmp/evidence/rehearsal-${artifact}.tsv" | cut -d' ' -f1)"; sed -i "s/^${field}=PLACEHOLDER$/${field}=$hash/" "$tmp/evidence/rehearsal-evidence.env"; done
ext_hash="$(sha256sum "$tmp/evidence/rehearsal-ext.tsv" | cut -d' ' -f1)"; settings_hash="$(sha256sum "$tmp/evidence/rehearsal-settings.tsv" | cut -d' ' -f1)"; sed -i "s/extensions_inventory_sha256=PLACEHOLDER/extensions_inventory_sha256=$ext_hash/; s/settings_inventory_sha256=PLACEHOLDER/settings_inventory_sha256=$settings_hash/" "$tmp/evidence/rehearsal-evidence.env"
{ printf '%s\n' 'format_version=1' 'observation_status=complete' 'restore_command_status=verified' 'checksum_command_status=verified' 'decryption_command_status=verified' 'source_version_provenance=operator_recorded'; grep -E '^(source_version_record_sha256|source_postgres_major|target_postgres_major|client_psql_major|client_pg_restore_major|client_pg_dump_major|public_table_count|valorant_table_count|public_object_count|valorant_object_count|quest_migration_ledger_status|quest_migration_count|valorant_migration_ledger_status|valorant_migration_count|public_upload_file_count|public_upload_byte_count|public_upload_checksum|private_upload_file_count|private_upload_byte_count|private_upload_checksum|quest_liveness_status|quest_readiness_status|quest_database_status|valorant_health_status|valorant_database_status|valorant_ca_status|freeze_mode|writers_disabled|mutation_rejection|no_writer_admission|failure_injection_[a-z_]+|resource_cpu_seconds|resource_peak_memory_kb|resource_disk_bytes|rto_seconds|rto_decision|upload_checksum_scope|upload_source_equivalence|extensions_inventory_sha256|settings_inventory_sha256|security_verify_status|security_verify_output_sha256)=' "$tmp/evidence/rehearsal-evidence.env"; printf '%s\n' 'manifest_scope=application_public_and_valorant_schemas' 'manifest_valorant_schema_included=true' 'roles_command_status=verified' 'memberships_command_status=verified' 'owners_command_status=verified' 'grants_command_status=verified' 'default_acl_command_status=verified' 'rls_command_status=verified'; for artifact in roles memberships owners grants acl rls; do field="${artifact}_observations_sha256"; [[ "$artifact" == acl ]] && field=default_acl_observations_sha256; grep "^${field}=" "$tmp/evidence/rehearsal-evidence.env"; done; } > "$tmp/evidence/rehearsal-observations.env"
chmod 600 "$tmp/evidence"/rehearsal-*.tsv; printf 'security-verified' > "$tmp/evidence/rehearsal-security-verifier.output"; chmod 600 "$tmp/evidence/rehearsal-security-verifier.output"; obs_hash="$(sha256sum "$tmp/evidence/rehearsal-observations.env" | cut -d' ' -f1)"; archive_hash="$(sha256sum "$tmp/quest-production-20260827T000000Z.tar.gz.enc" | cut -d' ' -f1)"; sed -i "s/observations_sha256=PLACEHOLDER/observations_sha256=$obs_hash/; s/^archive_sha256=.*/archive_sha256=$archive_hash/" "$tmp/evidence/rehearsal-evidence.env"
printf '%s\n' 'quest_migration_ledger_before_status=absent' 'valorant_migration_ledger_before_status=absent' 'rpo_seconds=86400' 'rpo_decision=met' >> "$tmp/evidence/rehearsal-evidence.env"
printf '%s\n' 'quest_migration_ledger_before_status=absent' 'valorant_migration_ledger_before_status=absent' 'rpo_seconds=86400' 'rpo_decision=met' >> "$tmp/evidence/rehearsal-observations.env"
obs_hash="$(sha256sum "$tmp/evidence/rehearsal-observations.env" | cut -d' ' -f1)"; sed -i "s/^observations_sha256=.*/observations_sha256=$obs_hash/" "$tmp/evidence/rehearsal-evidence.env"
verify_fixture() { env REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY="$tmp/signing-public.pem" bash "$verify" "$tmp/quest-production-20260827T000000Z.tar.gz.enc" "$tmp/evidence"; }
if command -v openssl >/dev/null 2>&1; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/signing-private.pem" >/dev/null 2>&1; openssl pkey -in "$tmp/signing-private.pem" -pubout -out "$tmp/signing-public.pem" >/dev/null 2>&1; chmod 600 "$tmp/signing-private.pem" "$tmp/signing-public.pem"
  (cd "$tmp/evidence" && for artifact in rehearsal-evidence.env rehearsal-observations.env rehearsal-source-version.env rehearsal-security-verifier.output rehearsal-roles.tsv rehearsal-memberships.tsv rehearsal-owners.tsv rehearsal-grants.tsv rehearsal-acl.tsv rehearsal-ext.tsv rehearsal-settings.tsv rehearsal-rls.tsv; do sha256sum "$artifact"; done) > "$tmp/evidence/rehearsal-evidence.manifest"; chmod 600 "$tmp/evidence/rehearsal-evidence.manifest"; openssl dgst -sha256 -sign "$tmp/signing-private.pem" -out "$tmp/evidence/rehearsal-evidence.sig" "$tmp/evidence/rehearsal-evidence.manifest"; chmod 600 "$tmp/evidence/rehearsal-evidence.sig"
  verify_fixture >/dev/null; echo "ok: valid signed evidence"
else
  refused "missing signature tool" bash "$verify" "$tmp/quest-production-20260827T000000Z.tar.gz.enc" "$tmp/evidence"; echo "skipped valid signed evidence: openssl unavailable"
fi
if command -v openssl >/dev/null 2>&1; then mv "$tmp/evidence/rehearsal-observations.env" "$tmp/evidence/rehearsal-observations.env.missing"; refused "summary without raw observations" verify_fixture; mv "$tmp/evidence/rehearsal-observations.env.missing" "$tmp/evidence/rehearsal-observations.env"; fi
sed -i 's/manifest_valorant_schema_included=true/manifest_valorant_schema_included=false/' "$tmp/evidence/rehearsal-evidence.env"; refused "incomplete manifest evidence" verify_fixture
sed -i 's/manifest_valorant_schema_included=false/manifest_valorant_schema_included=true/; s/valorant_health_status=ok/valorant_health_status=failed/' "$tmp/evidence/rehearsal-evidence.env"; refused "wrong health evidence" verify_fixture
sed -i 's/valorant_health_status=failed/valorant_health_status=ok/; s/valorant_ca_status=verified/valorant_ca_status=failed/' "$tmp/evidence/rehearsal-evidence.env"; refused "wrong CA evidence" verify_fixture
sed -i 's/valorant_ca_status=failed/valorant_ca_status=verified/; s/freeze_mode=validation/freeze_mode=off/' "$tmp/evidence/rehearsal-evidence.env"; refused "blocked writer/freeze evidence" verify_fixture
echo "PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted)."
