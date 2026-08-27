#!/usr/bin/env bash
set -euo pipefail
umask 077

base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
restore="$base/restore-production-backup.sh"
fail() { echo "Restore rehearsal refused: $1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command unavailable: $1"; }
[[ $# -eq 1 ]] || fail "usage: postgres17-restore-rehearsal.sh /absolute/archive.tar.gz.enc"
archive="$1"
[[ "$archive" == /* && -f "$archive" && ! -L "$archive" ]] || fail "archive must be an absolute regular file"
[[ "$(basename "$archive")" =~ ^quest-production-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.enc$ ]] || fail "archive basename is not an expected production archive"
checksum="$archive.sha256"
[[ -f "$checksum" && ! -L "$checksum" ]] || fail "archive checksum is missing"
[[ "${REHEARSAL_CONFIRMATION:-}" == DISPOSABLE_QUEST_REHEARSAL ]] || fail "explicit disposable-target confirmation is required"

evidence="${REHEARSAL_EVIDENCE_DIR:-}"
env_file="${BACKUP_ENV_FILE:-}"
[[ "$evidence" == /* && "$evidence" != / && -d "$evidence" && ! -L "$evidence" ]] || fail "evidence directory must be an existing absolute non-root directory"
[[ "$env_file" == /* && -f "$env_file" && ! -L "$env_file" ]] || fail "BACKUP_ENV_FILE must be an absolute regular file"
mode() { stat -c '%a' -- "$1" 2>/dev/null; }
private() { local m; m="$(mode "$1")"; [[ "$m" =~ ^[0-7]+$ ]] && (( (8#$m & 077) == 0 )); }
private "$evidence" || fail "evidence directory is not private"
private "$env_file" || fail "BACKUP_ENV_FILE is not private"

declare -A cfg=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "BACKUP_ENV_FILE contains an unsafe line"
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "BACKUP_ENV_FILE contains a control character"
  case "$key" in
    DIRECT_URL|UPLOAD_ROOT|PRIVATE_UPLOAD_ROOT|BACKUP_AGE_IDENTITY_FILE) [[ -z "${cfg[$key]+x}" ]] || fail "BACKUP_ENV_FILE contains a duplicate"; cfg["$key"]="$value" ;;
    PATH) [[ "$value" =~ ^/[A-Za-z0-9._/-]+(:/[A-Za-z0-9._/-]+)*$ ]] || fail "BACKUP_ENV_FILE PATH is unsafe" ;;
    *) fail "BACKUP_ENV_FILE contains an unapproved setting" ;;
  esac
done < "$env_file"
for key in DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_AGE_IDENTITY_FILE; do [[ -n "${cfg[$key]:-}" ]] || fail "BACKUP_ENV_FILE is missing a required setting"; done
db_url="${cfg[DIRECT_URL]}"; public_root="${cfg[UPLOAD_ROOT]}"; private_root="${cfg[PRIVATE_UPLOAD_ROOT]}"; identity="${cfg[BACKUP_AGE_IDENTITY_FILE]}"

looks_production() {
  local x="${1,,}"
  case "$x" in *questesports*|*supabase*|*production*|*/prod/*|*"/prod"|*paris*|*/var/www/quest-esports*|*/srv/quest-esports*|*quest-prod*) return 1 ;; esac
  return 0
}
looks_production "$db_url" || fail "database URL looks like production"
[[ "$db_url" =~ ^postgres(ql)?:// && "$db_url" != *[[:space:]]* ]] || fail "target is not a safe PostgreSQL URL"
host="${db_url#*://}"; host="${host%%/*}"; host="${host##*@}"; host="${host%%:*}"
case "${host,,}" in ""|questesports*|api.*|*.lk|supabase*|*.supabase.*|production*|prod*|paris*) fail "database host looks like production" ;; esac

check_path() {
  local path="$1" label="$2" part current=/
  [[ "$path" == /* && "$path" != / ]] || fail "$label must be an absolute non-root path"
  if [[ "$label" != ARCHIVE_FILE && "$label" != ARCHIVE_CHECKSUM ]]; then looks_production "$path" || fail "$label looks like production"; fi
  while IFS= read -r part; do [[ -z "$part" ]] && continue; current="${current%/}/$part"; [[ ! -L "$current" ]] || fail "$label contains a symbolic link"; done < <(printf '%s\n' "$path" | tr / '\n')
}
check_path "$archive" ARCHIVE_FILE; check_path "$checksum" ARCHIVE_CHECKSUM; looks_production "$(dirname "$archive")" || fail "archive directory looks like production"
check_path "$public_root" UPLOAD_ROOT; check_path "$private_root" PRIVATE_UPLOAD_ROOT; check_path "$identity" BACKUP_AGE_IDENTITY_FILE
[[ -f "$identity" && ! -L "$identity" && -r "$identity" ]] || fail "age identity is missing or unreadable"
private "$identity" || fail "age identity is not private"
source_record="${SOURCE_VERSION_EVIDENCE_FILE:-}"
[[ "$source_record" == /* && -f "$source_record" && ! -L "$source_record" && -r "$source_record" ]] || fail "source-version evidence record is required"
check_path "$source_record" SOURCE_VERSION_EVIDENCE; private "$source_record" || fail "source-version evidence record is not private"
grep -Eq '://|/|@' "$source_record" && fail "source-version evidence contains a URL/path"
[[ "$(grep -c '^source_major=' "$source_record")" == 1 && "$(grep -c '^source_version=' "$source_record")" == 1 && "$(grep -c '^provenance=' "$source_record")" == 1 ]] || fail "source-version evidence record is incomplete"

for command in realpath sha256sum age tar mktemp date grep sed find sort stat curl python3 rsync sleep cp wc tr cut du awk; do need "$command"; done
[[ -r "$restore" ]] || fail "existing restore primitive is missing"
public_resolved="$(realpath -m -- "$public_root")"; private_resolved="$(realpath -m -- "$private_root")"
[[ "$public_resolved" != / && "$private_resolved" != / && "$public_resolved" != "$private_resolved" ]] || fail "upload roots must be distinct non-root paths"
[[ "$public_resolved" != "$private_resolved"/* && "$private_resolved" != "$public_resolved"/* ]] || fail "upload roots must not be nested"
[[ "$(basename "$public_resolved")" != "$(basename "$private_resolved")" ]] || fail "upload roots need distinct names"
for root in "$public_root" "$private_root"; do
  if [[ -e "$root" ]]; then [[ -d "$root" && -z "$(find -P "$root" -mindepth 1 -print -quit)" ]] || fail "upload roots must be fresh and empty"; else [[ -d "$(dirname "$root")" ]] || fail "upload root parent is missing"; fi
done

line="$(tr -d '\r' < "$checksum")"
[[ "$line" =~ ^[a-fA-F0-9]{64}[[:space:]]+\*?$(basename "$archive")$ ]] || fail "checksum does not identify the selected archive"
(cd -- "$(dirname "$archive")" && sha256sum --check --status "$(basename "$checksum")") || fail "archive checksum verification failed"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/quest-rehearsal.XXXXXXXX")"; chmod 700 "$scratch"
cleanup() { local s=$?; set +e; rm -rf -- "$scratch"; return "$s"; }; trap cleanup EXIT
age --decrypt --identity "$identity" --output "$scratch/payload.tar.gz" "$archive" >"$scratch/age.log" 2>&1 || fail "age decryption failed"
tar --list --gzip --file="$scratch/payload.tar.gz" >"$scratch/list" 2>/dev/null || fail "decrypted payload is not a gzip tar"
grep -Eq '(^|/)\.\.(\/|$)|^/' "$scratch/list" && fail "archive contains unsafe paths"
tar --extract --gzip --no-same-owner --no-same-permissions --file="$scratch/payload.tar.gz" --directory="$scratch" >/dev/null 2>&1 || fail "archive extraction failed"
manifest="$scratch/manifest.txt"; [[ -f "$manifest" && -f "$scratch/database.dump" ]] || fail "archive manifest or database dump is missing"
manifest_value() { grep -m1 "^$1=" "$manifest" | sed 's/^[^=]*=//'; }
scope="$(manifest_value database_scope)"; included="$(manifest_value valorant_schema_included)"
[[ "$scope" == application_public_and_valorant_schemas && "$included" == true ]] || fail "archive manifest is not the exact two-schema scope"
[[ "$(basename "$(manifest_value public_upload_root)")" == "$(basename "$public_root")" && "$(basename "$(manifest_value private_upload_root)")" == "$(basename "$private_root")" ]] || fail "archive manifest upload scope does not match targets"

source_major="$(grep -m1 '^source_major=' "$source_record" | cut -d= -f2-)"; source_version="$(grep -m1 '^source_version=' "$source_record" | cut -d= -f2-)"; source_provenance="$(grep -m1 '^provenance=' "$source_record" | cut -d= -f2-)"
[[ "$source_major" =~ ^[0-9]+$ && "$source_major" -gt 0 && "$source_version" =~ ^PostgreSQL_${source_major}([.][0-9]+)?$ && "$source_provenance" == operator_recorded ]] || fail "source-version evidence is incomplete or unsafe"
gate=none; if [[ "$source_major" != 17 ]]; then [[ "${SOURCE_MAJOR_MISMATCH_APPROVAL:-}" == approved ]] || fail "source-major mismatch lacks approved logical-migration gate"; gate=approved_logical_major_migration; fi

pg_stage="$scratch/pg17"; mkdir -p "$pg_stage"
if [[ -n "${POSTGRES17_BIN:-}" ]]; then
  bin="$POSTGRES17_BIN"; [[ "$bin" == /* && -d "$bin" && ! -L "$bin" ]] || fail "POSTGRES17_BIN is unsafe"
  for tool in psql pg_restore pg_dump; do [[ -x "$bin/$tool" ]] || fail "PostgreSQL 17 bin lacks $tool"; ln -s "$(realpath "$bin/$tool")" "$pg_stage/$tool"; done
else
  for tool in psql pg_restore pg_dump; do variable="${tool^^}_PATH"; path="${!variable:-}"; [[ "$path" == /* && -x "$path" ]] || fail "$variable must pin an executable"; ln -s "$(realpath "$path")" "$pg_stage/$tool"; done
fi
PATH="$pg_stage:$PATH"; export PATH
major() { [[ "$1" =~ [Pp]ostgreSQL[^0-9]*([0-9]+) ]] && printf '%s' "${BASH_REMATCH[1]}"; }
psql_major="$(major "$(psql --version 2>/dev/null)")" || fail "psql version unavailable"
restore_major="$(major "$(pg_restore --version 2>/dev/null)")" || fail "pg_restore version unavailable"
dump_major="$(major "$(pg_dump --version 2>/dev/null)")" || fail "pg_dump version unavailable"
[[ "$psql_major" == 17 && "$restore_major" == 17 && "$dump_major" == 17 ]] || fail "all PostgreSQL clients must be major 17"

isolated="$scratch/BACKUP_ENV_FILE"
{ printf 'DIRECT_URL='; printf '%q' "$db_url"; printf '\nUPLOAD_ROOT='; printf '%q' "$public_root"; printf '\nPRIVATE_UPLOAD_ROOT='; printf '%q' "$private_root"; printf '\nBACKUP_AGE_IDENTITY_FILE='; printf '%q' "$identity"; printf '\n'; } > "$isolated"; chmod 600 "$isolated"
[[ -x /usr/bin/time ]] || fail "/usr/bin/time is required for measured resource evidence"
start="$(date -u +%s)"; start_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
env -u BASH_ENV -u ENV RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION BACKUP_ENV_FILE="$isolated" RESTORE_COUNTDOWN_SECONDS=0 /usr/bin/time -f 'cpu_seconds=%U\npeak_memory_kb=%M' -o "$scratch/resource" bash "$restore" "$archive" >"$scratch/restore.log" 2>&1 || fail "existing restore primitive failed"
end="$(date -u +%s)"; end_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; duration=$((end-start))
cpu="$(grep -m1 '^cpu_seconds=' "$scratch/resource" | cut -d= -f2)"; memory="$(grep -m1 '^peak_memory_kb=' "$scratch/resource" | cut -d= -f2)"
[[ "$cpu" =~ ^[0-9]+([.][0-9]+)?$ && "$memory" =~ ^[0-9]+$ ]] || fail "resource measurement is incomplete"

psql_query() { psql -X -A -t -F '|' "$db_url" -c "$2" >"$1" 2>/dev/null; }
psql_query "$scratch/counts" "SELECT n.nspname || '|' || count(*) FILTER (WHERE c.relkind IN ('r','p','f')) || '|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','valorant') GROUP BY n.nspname ORDER BY n.nspname" || fail "schema/object query failed"
public_tables=0; valorant_tables=0; public_objects=0; valorant_objects=0
while IFS='|' read -r schema tables objects; do [[ "$tables" =~ ^[0-9]+$ && "$objects" =~ ^[0-9]+$ ]] || fail "schema/object output malformed"; [[ "$schema" == public ]] && public_tables="$tables" && public_objects="$objects"; [[ "$schema" == valorant ]] && valorant_tables="$tables" && valorant_objects="$objects"; done < "$scratch/counts"
(( public_tables > 0 && valorant_tables > 0 && public_objects > 0 && valorant_objects > 0 )) || fail "schema/object counts are not non-zero"
ledger() { local schema="$1" table="$2" out="$3" count; psql_query "$out" "SELECT count(*) FROM \"$schema\".\"$table\"" || return 1; count="$(tr -d '[:space:]' < "$out")"; [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] || return 1; printf '%s' "$count"; }
quest_migrations="$(ledger public _prisma_migrations "$scratch/q-ledger")" || fail "Quest migration ledger was not verified"
valorant_migrations="$(ledger valorant _migration_ledger "$scratch/v-ledger")" || fail "VALORANT _migration_ledger was not verified"
for pair in "roles|SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime')) AND EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='public' AND r.rolname='quest_migrator') AND EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='valorant' AND r.rolname='val_migrator') THEN 'verified' ELSE 'failed' END" "grants|SELECT CASE WHEN has_schema_privilege('quest_runtime','public','USAGE') AND has_schema_privilege('val_runtime','valorant','USAGE') AND NOT has_schema_privilege('quest_runtime','valorant','CREATE') AND NOT has_schema_privilege('val_runtime','public','CREATE') THEN 'verified' ELSE 'failed' END" "acl|SELECT CASE WHEN count(*) >= 2 THEN 'verified' ELSE 'failed' END FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN ('public','valorant')"; do name="${pair%%|*}" sql="${pair#*|}"; psql_query "$scratch/$name" "$sql" || fail "$name query failed"; [[ "$(tr -d '[:space:]' < "$scratch/$name")" == verified ]] || fail "$name was not verified"; done
psql_query "$scratch/roles" "SELECT rolname || '|' || rolcanlogin || '|' || rolinherit || '|' || rolsuper || '|' || rolcreatedb || '|' || rolcreaterole || '|' || rolreplication || '|' || rolbypassrls FROM pg_roles WHERE rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime') ORDER BY rolname" || fail "role attribute query failed"; [[ "$(wc -l < "$scratch/roles" | tr -d ' ')" == 4 ]] || fail "four database roles were not observed"; while IFS='|' read -r role login inherit super createdb createrole replication bypass; do [[ "$role" =~ ^(quest_migrator|quest_runtime|val_migrator|val_runtime)$ && "$login" == t && "$inherit" == f && "$super" == f && "$createdb" == f && "$createrole" == f && "$replication" == f && "$bypass" == f ]] || fail "role attributes are unsafe"; done < "$scratch/roles"
psql_query "$scratch/memberships" "SELECT count(*) FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE granted.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime') OR member.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime')" || fail "membership query failed"; [[ "$(tr -d '[:space:]' < "$scratch/memberships")" == 0 ]] || fail "unexpected role membership observed"
psql_query "$scratch/owners" "SELECT n.nspname || '|' || r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname IN ('public','valorant') ORDER BY n.nspname" || fail "schema owner query failed"; grep -qx 'public|quest_migrator' "$scratch/owners" && grep -qx 'valorant|val_migrator' "$scratch/owners" || fail "schema owners are incorrect"
psql_query "$scratch/grants" "SELECT CASE WHEN has_schema_privilege('quest_migrator','public','USAGE') AND has_schema_privilege('quest_migrator','public','CREATE') AND has_schema_privilege('quest_runtime','public','USAGE') AND has_schema_privilege('val_migrator','valorant','USAGE') AND has_schema_privilege('val_migrator','valorant','CREATE') AND has_schema_privilege('val_runtime','valorant','USAGE') AND NOT has_schema_privilege('quest_runtime','valorant','USAGE') AND NOT has_schema_privilege('val_runtime','public','USAGE') AND COALESCE((SELECT bool_and(has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','f')), false) AND COALESCE((SELECT bool_and(has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind IN ('r','p','f')), false) AND COALESCE((SELECT bool_and(has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'), false) AND COALESCE((SELECT bool_and(has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind='S'), false) THEN 'verified' ELSE 'failed' END" || fail "grant query failed"; [[ "$(tr -d '[:space:]' < "$scratch/grants")" == verified ]] || fail "runtime grants or cross-schema denials were not verified"
psql_query "$scratch/acl" "SELECT CASE WHEN count(*) >= 10 AND count(*) FILTER (WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname='quest_migrator') AND defaclnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')) >= 5 AND count(*) FILTER (WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname='val_migrator') AND defaclnamespace=(SELECT oid FROM pg_namespace WHERE nspname='valorant')) >= 5 THEN 'verified' ELSE 'failed' END FROM pg_default_acl" || fail "default ACL query failed"; [[ "$(tr -d '[:space:]' < "$scratch/acl")" == verified ]] || fail "both migrator default ACL sets were not verified"
psql_query "$scratch/ext" "SELECT extname || '|' || extversion FROM pg_extension ORDER BY extname" || fail "extension inventory query failed"; extensions_sha256="$(sha256sum "$scratch/ext" | cut -d' ' -f1)"; grep -Eq '^[a-zA-Z0-9_]+\|[^[:space:]]+$' "$scratch/ext" || fail "extension inventory was malformed"
psql_query "$scratch/settings" "SELECT name || '|' || regexp_replace(setting, '[^A-Za-z0-9_.:+*/-]', '_', 'g') FROM pg_settings WHERE name IN ('server_version','server_version_num','ssl','ssl_min_protocol_version','row_security','default_transaction_read_only','listen_addresses') ORDER BY name" || fail "settings inventory query failed"; settings_sha256="$(sha256sum "$scratch/settings" | cut -d' ' -f1)"; grep -Eq '^[a-z_]+\|[^[:space:]]+$' "$scratch/settings" || fail "settings inventory was malformed"; settings="$(grep '^server_version_num|' "$scratch/settings" | cut -d'|' -f2)"; [[ "$settings" =~ ^17[0-9]{4}$ ]] || fail "target PostgreSQL server is not major 17"; target_major=17
psql_query "$scratch/rls" "SELECT count(*) FILTER (WHERE c.relrowsecurity) || '|' || count(*) FILTER (WHERE c.relkind IN ('r','p','f')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','valorant')" || fail "RLS query failed"; IFS='|' read -r rls_enabled rls_tables < "$scratch/rls"; [[ "$rls_enabled" =~ ^[0-9]+$ && "$rls_tables" =~ ^[0-9]+$ && "$rls_enabled" -gt 0 ]] || fail "RLS evidence was not verified"

security_hook="${SECURITY_VERIFY_COMMAND:-}"
[[ "$security_hook" == /* && -x "$security_hook" && ! -L "$security_hook" ]] || fail "SECURITY_VERIFY_COMMAND must be an absolute executable hook"
check_path "$security_hook" SECURITY_VERIFY_COMMAND
security_output="$scratch/security-verifier.output"
env -u BASH_ENV -u ENV DIRECT_URL="$db_url" DATABASE_URL="$db_url" "$security_hook" >"$security_output" 2>&1 || fail "repository security verifier failed"
security_result="$(tr -d '\r' < "$security_output")"; [[ -n "$security_result" ]] || fail "repository security verifier produced no result"
security_output_sha256="$(sha256sum "$security_output" | cut -d' ' -f1)"

tree() { local root="$1" prefix="$2" count=0 bytes=0 file size digest; [[ -z "$(find -P "$root" -type l -print -quit)" ]] || fail "upload tree contains a symbolic link"; while IFS= read -r -d '' file; do count=$((count+1)); size="$(stat -c '%s' -- "$file")"; bytes=$((bytes+size)); done < <(find -P "$root" -type f -print0); digest="$(while IFS= read -r -d '' file; do sha256sum -- "$file"; done < <(find -P "$root" -type f -print0 | sort -z) | sha256sum | cut -d' ' -f1)"; printf -v "${prefix}_files" '%s' "$count"; printf -v "${prefix}_bytes" '%s' "$bytes"; printf -v "${prefix}_checksum" '%s' "$digest"; }
tree "$public_root" public; tree "$private_root" private

json_field() { python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f: value = json.load(f).get(sys.argv[2])
print(str(value).lower() if isinstance(value, bool) else value if value is not None else '')
PY
}
get_json() { local url="$1" out="$2" ca="${3:-}" code; if [[ -n "$ca" ]]; then code="$(curl --silent --show-error --max-time 15 --cacert "$ca" -o "$out" -w '%{http_code}' "$url" 2>/dev/null)"; else code="$(curl --silent --show-error --max-time 15 -o "$out" -w '%{http_code}' "$url" 2>/dev/null)"; fi; [[ "$code" == 200 ]] && python3 -m json.tool "$out" >/dev/null 2>&1; }
health() { local url="$1" name="$2" ca="${3:-}"; looks_production "$url" || fail "$name URL looks like production"; [[ "$url" =~ ^https?:// ]] || fail "$name URL is unsafe"; get_json "$url" "$scratch/$name.json" "$ca" || fail "$name health failed"; [[ "$(json_field "$scratch/$name.json" status)" == ok ]] || fail "$name status is not ok"; }
live="${QUEST_LIVENESS_URL:-}"; ready="${QUEST_READINESS_URL:-}"; val_health="${VALORANT_HEALTH_URL:-}"; ca="${VALORANT_CA_FILE:-}"
[[ -n "$live" && -n "$ready" && -n "$val_health" && "$val_health" =~ ^https:// ]] || fail "health URLs are incomplete or VALORANT is not HTTPS"
check_path "$ca" VALORANT_CA_FILE; [[ -f "$ca" && ! -L "$ca" && -r "$ca" ]] || fail "VALORANT CA file is missing"; health "$live" quest_liveness; health "$ready" quest_readiness; [[ "$(json_field "$scratch/quest_readiness.json" db)" == up ]] || fail "Quest database health is not up"; health "$val_health" valorant_health "$ca"; get_json "$val_health" "$scratch/valorant.json" "$ca" || fail "VALORANT health JSON failed"; [[ "$(json_field "$scratch/valorant.json" db)" == up ]] || fail "VALORANT database health is not up"
freeze="${FREEZE_STATUS_URL:-}"; mutation="${FREEZE_MUTATION_URL:-}"; callback="${FREEZE_CALLBACK_URL:-}"; [[ -n "$freeze" && -n "$mutation" && -n "$callback" ]] || fail "freeze and mutation/callback probes are required"; for url in "$freeze" "$mutation" "$callback"; do looks_production "$url" || fail "freeze probe URL looks like production"; done
get_json "$freeze" "$scratch/freeze.json" || fail "freeze status failed"; [[ "$(json_field "$scratch/freeze.json" mode)" == validation && "$(json_field "$scratch/freeze.json" writersEnabled)" == false ]] || fail "freeze was not acknowledged"
probe() { local url="$1" name="$2" h="$scratch/$name.h" b="$scratch/$name.b" code; code="$(curl --silent --show-error --max-time 15 -D "$h" -o "$b" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$url" 2>/dev/null)"; [[ "$code" == 503 ]] && grep -Eiq '^x-write-freeze:[[:space:]]*validation' "$h"; }; probe "$mutation" mutation || fail "mutation was admitted"; probe "$callback" callback || fail "callback was admitted"
run_exact_hook() { local path="$1" expected="$2" output="$3"; env -u BASH_ENV -u ENV DIRECT_URL="$db_url" DATABASE_URL="$db_url" "$path" >"$output" 2>&1 || return 1; [[ "$(tr -d '\r' < "$output")" == "$expected" ]]; }
no_admission_hook="${NO_WRITER_ADMISSION_COMMAND:-}"; [[ "$no_admission_hook" == /* && -x "$no_admission_hook" && ! -L "$no_admission_hook" ]] || fail "NO_WRITER_ADMISSION_COMMAND must be an absolute executable hook"; check_path "$no_admission_hook" NO_WRITER_ADMISSION_COMMAND
run_exact_hook "$no_admission_hook" verified "$scratch/no-admission.output" || fail "no-writer-admission hook did not return verified"
for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do
  var="FAILURE_INJECTION_${injection^^}_COMMAND"; hook="${!var:-}"
  [[ "$hook" == /* && -x "$hook" && ! -L "$hook" ]] || fail "failure injection $injection needs an executable hook"
  check_path "$hook" "$var"
  run_exact_hook "$hook" passed "$scratch/$injection.output" || fail "failure injection $injection did not return passed"
done
rto="${REHEARSAL_RTO_SECONDS:-}"; decision="${REHEARSAL_RTO_DECISION:-}"; [[ "$rto" =~ ^[0-9]+$ && "$rto" -gt 0 && ( "$decision" == met || "$decision" == not_met ) ]] || fail "measured RTO and explicit decision are required"
disk="$(du -sk -- "$public_root" "$private_root" | awk '{sum += $1} END {print sum * 1024}')"; [[ "$disk" =~ ^[0-9]+$ ]] || fail "disk resource measurement failed"

tmp="$evidence/.rehearsal-evidence.$$"
for artifact in roles memberships owners grants acl ext settings rls; do cp -- "$scratch/$artifact" "$evidence/rehearsal-${artifact}.tsv"; chmod 600 "$evidence/rehearsal-${artifact}.tsv"; done
cp -- "$source_record" "$evidence/rehearsal-source-version.env"; chmod 600 "$evidence/rehearsal-source-version.env"
source_record_sha256="$(sha256sum "$source_record" | cut -d' ' -f1)"
roles_sha256="$(sha256sum "$scratch/roles" | cut -d' ' -f1)"; memberships_sha256="$(sha256sum "$scratch/memberships" | cut -d' ' -f1)"; owners_sha256="$(sha256sum "$scratch/owners" | cut -d' ' -f1)"; grants_sha256="$(sha256sum "$scratch/grants" | cut -d' ' -f1)"; acl_sha256="$(sha256sum "$scratch/acl" | cut -d' ' -f1)"; rls_sha256="$(sha256sum "$scratch/rls" | cut -d' ' -f1)"
upload_checksum_scope=post_restore_tree; upload_source_equivalence=not_claimed_without_source_inventory
observations_tmp="$evidence/.rehearsal-observations.$$"
{ printf 'format_version=1\nobservation_status=complete\nrestore_command_status=verified\n'; printf 'checksum_command_status=verified\ndecryption_command_status=verified\n'; printf 'source_version_provenance=operator_recorded\nsource_version_record_sha256=%s\n' "$source_record_sha256"; printf 'source_postgres_major=%s\ntarget_postgres_major=%s\nclient_psql_major=%s\nclient_pg_restore_major=%s\nclient_pg_dump_major=%s\n' "$source_major" "$target_major" "$psql_major" "$restore_major" "$dump_major"; printf 'manifest_scope=%s\nmanifest_valorant_schema_included=true\npublic_table_count=%s\nvalorant_table_count=%s\npublic_object_count=%s\nvalorant_object_count=%s\nquest_migration_ledger_status=verified\nquest_migration_count=%s\nvalorant_migration_ledger_status=verified\nvalorant_migration_count=%s\n' "$scope" "$public_tables" "$valorant_tables" "$public_objects" "$valorant_objects" "$quest_migrations" "$valorant_migrations"; printf 'roles_command_status=verified\nmemberships_command_status=verified\nowners_command_status=verified\ngrants_command_status=verified\ndefault_acl_command_status=verified\nrls_command_status=verified\nroles_observations_sha256=%s\nmemberships_observations_sha256=%s\nowners_observations_sha256=%s\ngrants_observations_sha256=%s\ndefault_acl_observations_sha256=%s\nrls_observations_sha256=%s\nsecurity_verify_status=verified\nsecurity_verify_output_sha256=%s\nextensions_inventory_sha256=%s\nsettings_inventory_sha256=%s\n' "$roles_sha256" "$memberships_sha256" "$owners_sha256" "$grants_sha256" "$acl_sha256" "$rls_sha256" "$security_output_sha256" "$extensions_sha256" "$settings_sha256"; printf 'public_upload_file_count=%s\npublic_upload_byte_count=%s\npublic_upload_checksum=%s\nprivate_upload_file_count=%s\nprivate_upload_byte_count=%s\nprivate_upload_checksum=%s\nupload_checksum_scope=%s\nupload_source_equivalence=%s\n' "$public_files" "$public_bytes" "$public_checksum" "$private_files" "$private_bytes" "$private_checksum" "$upload_checksum_scope" "$upload_source_equivalence"; printf 'quest_liveness_status=ok\nquest_readiness_status=ok\nquest_database_status=up\nvalorant_health_status=ok\nvalorant_database_status=up\nvalorant_ca_status=verified\nfreeze_mode=validation\nwriters_disabled=true\nmutation_rejection=verified\nno_writer_admission=verified\n'; for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do printf 'failure_injection_%s=passed\n' "$injection"; done; printf 'resource_cpu_seconds=%s\nresource_peak_memory_kb=%s\nresource_disk_bytes=%s\nrto_seconds=%s\nrto_decision=%s\n' "$cpu" "$memory" "$disk" "$rto" "$decision"; } > "$observations_tmp"
chmod 600 "$observations_tmp"; observations_sha256="$(sha256sum "$observations_tmp" | cut -d' ' -f1)"; mv -f -- "$observations_tmp" "$evidence/rehearsal-observations.env"
{ printf 'format_version=1\nevidence_status=complete\nrehearsal_mode=disposable\nrestore_status=verified\n'; printf 'created_at_utc=%s\nrestore_start_utc=%s\nrestore_end_utc=%s\nrestore_duration_seconds=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$start_utc" "$end_utc" "$duration"; printf 'archive_name=%s\narchive_sha256=%s\nobservations_sha256=%s\nchecksum_status=verified\ndecryption_status=verified\nmanifest_database_scope=%s\nmanifest_valorant_schema_included=true\n' "$(basename "$archive")" "$(cut -d' ' -f1 < "$checksum")" "$observations_sha256" "$scope"; printf 'source_postgres_major=%s\ntarget_postgres_major=%s\nsource_major_gate=%s\nsource_version_provenance=operator_recorded\nsource_version_record_sha256=%s\nclient_psql_major=%s\nclient_pg_restore_major=%s\nclient_pg_dump_major=%s\n' "$source_major" "$target_major" "$gate" "$source_record_sha256" "$psql_major" "$restore_major" "$dump_major"; printf 'public_table_count=%s\nvalorant_table_count=%s\npublic_object_count=%s\nvalorant_object_count=%s\nquest_migration_ledger_status=verified\nquest_migration_count=%s\nvalorant_migration_ledger_status=verified\nvalorant_migration_count=%s\n' "$public_tables" "$valorant_tables" "$public_objects" "$valorant_objects" "$quest_migrations" "$valorant_migrations"; printf 'roles_status=verified\nowners_status=verified\ngrants_status=verified\ndefault_acl_status=verified\nmemberships_status=verified\nroles_observations_sha256=%s\nmemberships_observations_sha256=%s\nowners_observations_sha256=%s\ngrants_observations_sha256=%s\ndefault_acl_observations_sha256=%s\nrls_observations_sha256=%s\nsecurity_verify_status=verified\nsecurity_verify_output_sha256=%s\nextensions_status=verified\nextensions_inventory_sha256=%s\nsettings_status=verified\nsettings_inventory_sha256=%s\nrls_status=verified\nrls_enabled_table_count=%s\nrls_table_count=%s\n' "$roles_sha256" "$memberships_sha256" "$owners_sha256" "$grants_sha256" "$acl_sha256" "$rls_sha256" "$security_output_sha256" "$extensions_sha256" "$settings_sha256" "$rls_enabled" "$rls_tables"; printf 'public_upload_file_count=%s\npublic_upload_byte_count=%s\npublic_upload_checksum=%s\nprivate_upload_file_count=%s\nprivate_upload_byte_count=%s\nprivate_upload_checksum=%s\nupload_checksum_scope=%s\nupload_source_equivalence=%s\n' "$public_files" "$public_bytes" "$public_checksum" "$private_files" "$private_bytes" "$private_checksum" "$upload_checksum_scope" "$upload_source_equivalence"; printf 'quest_liveness_status=ok\nquest_readiness_status=ok\nquest_database_status=up\nvalorant_health_status=ok\nvalorant_database_status=up\nvalorant_ca_status=verified\nfreeze_mode=validation\nwriters_disabled=true\nmutation_rejection=verified\nno_writer_admission=verified\n'; for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do printf 'failure_injection_%s=passed\n' "$injection"; done; printf 'resource_cpu_seconds=%s\nresource_peak_memory_kb=%s\nresource_disk_bytes=%s\nrto_seconds=%s\nrto_decision=%s\n' "$cpu" "$memory" "$disk" "$rto" "$decision"; } > "$tmp"
chmod 600 "$tmp"; mv -f -- "$tmp" "$evidence/rehearsal-evidence.env"
echo "Restore rehearsal completed; evidence written to the supplied disposable evidence directory."
