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
sentinel="${REHEARSAL_TARGET_SENTINEL_FILE:-}"
[[ "$evidence" == /* && "$evidence" != / && -d "$evidence" && ! -L "$evidence" ]] || fail "evidence directory must be an existing absolute non-root directory"
[[ "$env_file" == /* && -f "$env_file" && ! -L "$env_file" ]] || fail "BACKUP_ENV_FILE must be an absolute regular file"
[[ "$sentinel" == /* && -f "$sentinel" && ! -L "$sentinel" ]] || fail "REHEARSAL_TARGET_SENTINEL_FILE must be an absolute regular file"
mode() { stat -c '%a' -- "$1" 2>/dev/null; }
private() { local m; m="$(mode "$1")"; [[ "$m" =~ ^[0-7]+$ ]] && (( (8#$m & 077) == 0 )); }
private "$evidence" || fail "evidence directory is not private"
private "$env_file" || fail "BACKUP_ENV_FILE is not private"
private "$sentinel" || fail "target sentinel is not private"
[[ "$(mode "$sentinel")" == 600 ]] || fail "target sentinel must have exact mode 600"

declare -A cfg=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "BACKUP_ENV_FILE contains an unsafe line"
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "BACKUP_ENV_FILE contains a control character"
  case "$key" in
    DIRECT_URL|QUEST_RUNTIME_DATABASE_URL|UPLOAD_ROOT|PRIVATE_UPLOAD_ROOT|BACKUP_AGE_IDENTITY_FILE) [[ -z "${cfg[$key]+x}" ]] || fail "BACKUP_ENV_FILE contains a duplicate"; cfg["$key"]="$value" ;;
    PATH) [[ "$value" =~ ^/[A-Za-z0-9._/-]+(:/[A-Za-z0-9._/-]+)*$ ]] || fail "BACKUP_ENV_FILE PATH is unsafe" ;;
    *) fail "BACKUP_ENV_FILE contains an unapproved setting" ;;
  esac
done < "$env_file"
for key in DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_AGE_IDENTITY_FILE; do [[ -n "${cfg[$key]:-}" ]] || fail "BACKUP_ENV_FILE is missing a required setting"; done
db_url="${cfg[DIRECT_URL]}"; runtime_db_url="${cfg[QUEST_RUNTIME_DATABASE_URL]:-}"; public_root="${cfg[UPLOAD_ROOT]}"; private_root="${cfg[PRIVATE_UPLOAD_ROOT]}"; identity="${cfg[BACKUP_AGE_IDENTITY_FILE]}"

looks_production() {
  local x="${1,,}"
  case "$x" in *questesports*|*supabase*|*production*|*/prod/*|*"/prod"|*paris*|*/var/www/quest-esports*|*/srv/quest-esports*|*quest-prod*) return 1 ;; esac
  return 0
}
looks_production "$db_url" || fail "database URL looks like production"
[[ "$db_url" =~ ^postgres(ql)?:// && "$db_url" != *[[:space:]]* ]] || fail "target is not a safe PostgreSQL URL"
[[ "$db_url" != *\?* && "$db_url" != *\#* ]] || fail "DIRECT_URL query/fragment overrides are not allowed"
host="${db_url#*://}"; host="${host%%/*}"; host="${host##*@}"; host="${host%%:*}"
case "${host,,}" in ""|questesports*|api.*|*.lk|supabase*|*.supabase.*|production*|prod*|paris*) fail "database host looks like production" ;; esac
[[ "$runtime_db_url" =~ ^postgres(ql)?:// && "$runtime_db_url" != *[[:space:]]* ]] || fail "QUEST_RUNTIME_DATABASE_URL is required and unsafe"
[[ "$runtime_db_url" != *\?* && "$runtime_db_url" != *\#* ]] || fail "QUEST_RUNTIME_DATABASE_URL query/fragment overrides are not allowed"
looks_production "$runtime_db_url" || fail "runtime database URL looks like production"
need python3
runtime_endpoint="$(python3 - "$db_url" "$runtime_db_url" <<'PY'
from urllib.parse import urlsplit
import sys
direct, runtime = map(urlsplit, sys.argv[1:])
if (runtime.scheme not in ("postgres", "postgresql") or runtime.username != "quest_runtime"
        or runtime.hostname != direct.hostname or runtime.port != direct.port
        or runtime.path != direct.path):
    raise SystemExit(1)
print(f"{runtime.hostname}|{runtime.port}|{runtime.path.lstrip('/')}")
PY
)" || fail "runtime database URL must target the same database endpoint as DIRECT_URL"

check_path() {
  local path="$1" label="$2" part current=/
  [[ "$path" == /* && "$path" != / ]] || fail "$label must be an absolute non-root path"
  if [[ "$label" != ARCHIVE_FILE && "$label" != ARCHIVE_CHECKSUM ]]; then looks_production "$path" || fail "$label looks like production"; fi
  while IFS= read -r part; do
    [[ -z "$part" ]] && continue
    [[ "$part" != . && "$part" != .. ]] || fail "$label contains a traversal component"
    current="${current%/}/$part"
    [[ ! -L "$current" ]] || fail "$label contains a symbolic link"
  done < <(printf '%s\n' "$path" | tr / '\n')
}
check_path "$archive" ARCHIVE_FILE; check_path "$checksum" ARCHIVE_CHECKSUM; looks_production "$(dirname "$archive")" || fail "archive directory looks like production"
check_path "$evidence" REHEARSAL_EVIDENCE_DIR; check_path "$env_file" BACKUP_ENV_FILE; check_path "$sentinel" REHEARSAL_TARGET_SENTINEL_FILE
check_path "$public_root" UPLOAD_ROOT; check_path "$private_root" PRIVATE_UPLOAD_ROOT; check_path "$identity" BACKUP_AGE_IDENTITY_FILE
[[ -f "$identity" && ! -L "$identity" && -r "$identity" ]] || fail "age identity is missing or unreadable"
private "$identity" || fail "age identity is not private"
source_record="${SOURCE_VERSION_EVIDENCE_FILE:-}"
[[ "$source_record" == /* && -f "$source_record" && ! -L "$source_record" && -r "$source_record" ]] || fail "source-version evidence record is required"
check_path "$source_record" SOURCE_VERSION_EVIDENCE; private "$source_record" || fail "source-version evidence record is not private"
grep -Eq '://|/|@' "$source_record" && fail "source-version evidence contains a URL/path"
[[ "$(grep -c '^source_major=' "$source_record")" == 1 && "$(grep -c '^source_version=' "$source_record")" == 1 && "$(grep -c '^provenance=' "$source_record")" == 1 ]] || fail "source-version evidence record is incomplete"
signing_key="${REHEARSAL_SIGNING_PRIVATE_KEY:-}"
[[ "$signing_key" == /* && -f "$signing_key" && ! -L "$signing_key" && -r "$signing_key" ]] || fail "REHEARSAL_SIGNING_PRIVATE_KEY is required"
check_path "$signing_key" REHEARSAL_SIGNING_PRIVATE_KEY; private "$signing_key" || fail "signing key is not private"

for command in realpath sha256sum age tar mktemp date grep sed find sort stat curl python3 rsync sleep cp wc tr cut du awk cat openssl docker; do need "$command"; done
[[ -r "$restore" ]] || fail "existing restore primitive is missing"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/quest-rehearsal.XXXXXXXX")"; chmod 700 "$scratch"
binding_pid=""
stop_binding_session() { if [[ -n "${binding_pid:-}" ]] && kill -0 "$binding_pid" 2>/dev/null; then kill "$binding_pid" 2>/dev/null || true; wait "$binding_pid" 2>/dev/null || true; fi; binding_pid=""; }
upload_parent_created=0
cleanup_upload_parent() { if (( ${upload_parent_created:-0} )); then rmdir -- "$private_resolved" "$public_resolved" "$upload_parent" 2>/dev/null || true; fi; }
cleanup() { local s=$?; set +e; stop_binding_session; rm -f -- "$evidence"/.rehearsal-failure-hook-*.sh; rm -rf -- "$scratch"; cleanup_upload_parent; return "$s"; }; trap cleanup EXIT
public_resolved="$(realpath -m -- "$public_root")"; private_resolved="$(realpath -m -- "$private_root")"
[[ "$public_resolved" != / && "$private_resolved" != / && "$public_resolved" != "$private_resolved" ]] || fail "upload roots must be distinct non-root paths"
[[ "$public_resolved" != "$private_resolved"/* && "$private_resolved" != "$public_resolved"/* ]] || fail "upload roots must not be nested"
[[ "$(basename "$public_resolved")" != "$(basename "$private_resolved")" ]] || fail "upload roots need distinct names"
upload_parent="$(dirname "$public_resolved")"
[[ "$(dirname "$private_resolved")" == "$upload_parent" ]] || fail "upload roots must share one disposable parent"
[[ ! -e "$upload_parent" && ! -L "$upload_parent" ]] || fail "upload parent must not already exist"
mkdir -- "$upload_parent" || fail "disposable upload parent could not be created atomically"
chmod 700 -- "$upload_parent"; upload_parent_created=1
mkdir -- "$public_resolved" "$private_resolved" || fail "disposable upload roots could not be created"
chmod 700 -- "$public_resolved" "$private_resolved"
parent_device="$(stat -c '%d' -- "$upload_parent")"; parent_uid="$(stat -c '%u' -- "$upload_parent")"; parent_gid="$(stat -c '%g' -- "$upload_parent")"
[[ "$parent_device" =~ ^[0-9]+$ && "$parent_uid" == "$(id -u)" && "$parent_gid" == "$(id -g)" ]] || fail "disposable upload parent ownership/device is unsafe"
for root in "$public_resolved" "$private_resolved"; do [[ -d "$root" && ! -L "$root" && "$(stat -c '%d' -- "$root")" == "$parent_device" && "$(stat -c '%u' -- "$root")" == "$(id -u)" && "$(stat -c '%g' -- "$root")" == "$(id -g)" && "$(stat -c '%a' -- "$root")" == 700 && -z "$(find -P "$root" -mindepth 1 -print -quit)" ]] || fail "disposable upload root ownership/device/freshness is unsafe"; done

declare -A sentinel_cfg=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([a-z_]+)=([^[:space:]]+)$ ]] || fail "target sentinel contains an unsafe line"
  key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
  [[ -z "${sentinel_cfg[$key]+x}" ]] || fail "target sentinel contains a duplicate"
  case "$key" in
    target_kind|target_id|container_id|public_root|private_root) sentinel_cfg["$key"]="$value" ;;
    *) fail "target sentinel contains an unapproved setting" ;;
  esac
done < "$sentinel"
for key in target_kind target_id container_id public_root private_root; do [[ -n "${sentinel_cfg[$key]:-}" ]] || fail "target sentinel is incomplete"; done
[[ "${sentinel_cfg[target_kind]}" == disposable_postgresql17 ]] || fail "target sentinel is not for a disposable PostgreSQL 17 target"
[[ "${sentinel_cfg[target_id]}" =~ ^[a-z0-9][a-z0-9-]{7,63}$ ]] || fail "target sentinel ID is malformed"
[[ "${sentinel_cfg[container_id]}" =~ ^[a-f0-9]{64}$ ]] || fail "target container ID is malformed"
[[ "$(realpath -m -- "${sentinel_cfg[public_root]}")" == "$public_resolved" && "$(realpath -m -- "${sentinel_cfg[private_root]}")" == "$private_resolved" ]] || fail "target sentinel upload roots do not match targets"
sentinel_sha256="$(sha256sum "$sentinel" | cut -d' ' -f1)"
for root in "$public_root" "$private_root"; do
  if [[ -e "$root" ]]; then [[ -d "$root" && -z "$(find -P "$root" -mindepth 1 -print -quit)" ]] || fail "upload roots must be fresh and empty"; else [[ -d "$(dirname "$root")" ]] || fail "upload root parent is missing"; fi
done

line="$(tr -d '\r' < "$checksum")"
[[ "$line" =~ ^[a-fA-F0-9]{64}[[:space:]]+\*?$(basename "$archive")$ ]] || fail "checksum does not identify the selected archive"
(cd -- "$(dirname "$archive")" && sha256sum --check --status "$(basename "$checksum")") || fail "archive checksum verification failed"
age --decrypt --identity "$identity" --output "$scratch/payload.tar.gz" "$archive" >"$scratch/age.log" 2>&1 || fail "age decryption failed"
tar --list --gzip --file="$scratch/payload.tar.gz" >"$scratch/list" 2>/dev/null || fail "decrypted payload is not a gzip tar"
grep -Eq '(^|/)\.\.(\/|$)|^/' "$scratch/list" && fail "archive contains unsafe paths"
tar --extract --gzip --no-same-owner --no-same-permissions --file="$scratch/payload.tar.gz" --directory="$scratch" >/dev/null 2>&1 || fail "archive extraction failed"
manifest="$scratch/manifest.txt"; [[ -f "$manifest" && -f "$scratch/database.dump" ]] || fail "archive manifest or database dump is missing"
manifest_value() { grep -m1 "^$1=" "$manifest" | sed 's/^[^=]*=//'; }
archive_scope="$(manifest_value database_scope)"; included="$(manifest_value valorant_schema_included)"
[[ "$archive_scope" == application_public_and_valorant_schemas && "$included" == true ]] || fail "archive manifest is not the exact two-schema scope"
[[ "$(basename "$(manifest_value public_upload_root)")" == "$(basename "$public_root")" && "$(basename "$(manifest_value private_upload_root)")" == "$(basename "$private_root")" ]] || fail "archive manifest upload scope does not match targets"

start="$(date -u +%s)"; start_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

pg_stage="$scratch/pg17"; mkdir -p "$pg_stage"
if [[ -n "${POSTGRES17_BIN:-}" ]]; then
  bin="$POSTGRES17_BIN"; [[ "$bin" == /* && -d "$bin" && ! -L "$bin" ]] || fail "POSTGRES17_BIN is unsafe"
  for tool in psql pg_restore pg_dump; do [[ -x "$bin/$tool" ]] || fail "PostgreSQL 17 bin lacks $tool"; ln -s "$(realpath "$bin/$tool")" "$pg_stage/$tool"; done
else
  for tool in psql pg_restore pg_dump; do variable="${tool^^}_PATH"; path="${!variable:-}"; [[ "$path" == /* && -x "$path" ]] || fail "$variable must pin an executable"; ln -s "$(realpath "$path")" "$pg_stage/$tool"; done
fi
PATH="$pg_stage:$PATH"; export PATH
major() { [[ "$1" =~ [Pp]ostgreSQL[^0-9]*([0-9]+) ]] && printf '%s' "${BASH_REMATCH[1]}"; }
psql_major="$(psql --version 2>/dev/null | { read -r version; major "$version"; })" || fail "psql version unavailable"
restore_major="$(pg_restore --version 2>/dev/null | { read -r version; major "$version"; })" || fail "pg_restore version unavailable"
dump_major="$(pg_dump --version 2>/dev/null | { read -r version; major "$version"; })" || fail "pg_dump version unavailable"
[[ "$psql_major" == 17 && "$restore_major" == 17 && "$dump_major" == 17 ]] || fail "all PostgreSQL clients must be major 17"
psql_query() { env -u PGUSER -u PGDATABASE -u PGHOST -u PGPORT -u PGSERVICE -u PGOPTIONS -u PGPASSWORD PGAPPNAME="${rehearsal_app_name:-}" psql -X -A -t -F '|' "$db_url" -c "$2" >"$1" 2>/dev/null; }
runtime_psql_query() { env -u PGUSER -u PGDATABASE -u PGHOST -u PGPORT -u PGSERVICE -u PGOPTIONS -u PGPASSWORD PGAPPNAME="${rehearsal_app_name:-quest-rehearsal-read-probe}" psql -X -A -t -F '|' "$runtime_db_url" -c "$2" >"$1" 2>/dev/null; }
start_binding_session() {
  local app_name="$1" output="$2" errors="$3" attempt
  : > "$output"; : > "$errors"
  env -u PGUSER -u PGDATABASE -u PGHOST -u PGPORT -u PGSERVICE -u PGOPTIONS -u PGPASSWORD PGAPPNAME="$app_name" psql -X -A -t -F '|' -v ON_ERROR_STOP=1 "$db_url" >"$output" 2>"$errors" <<SQL &
SELECT current_setting('application_name') || '|' || current_database() || '|' || session_user || '|' || current_user || '|' || inet_server_port() || '|' || pg_backend_pid();
SELECT pg_sleep(60);
SQL
  binding_pid=$!
  for attempt in {1..100}; do
    if [[ -s "$output" ]] && grep -Eq '^quest-rehearsal-[0-9a-f]{64}\|[^|]+\|[^|]+\|[^|]+\|[0-9]+\|[0-9]+$' "$output"; then return 0; fi
    if ! kill -0 "$binding_pid" 2>/dev/null; then wait "$binding_pid" 2>/dev/null || true; binding_pid=""; return 1; fi
    sleep 0.1
  done
  return 1
}
validate_binding_output() {
  local output="$1" expected_app="$2" app database session_user current_user server_port backend_pid
  IFS='|' read -r app database session_user current_user server_port backend_pid < "$output"
  [[ "$app" == "$expected_app" && "$database" == "$target_database" && "$session_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$current_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$server_port" == 5432 && "$backend_pid" =~ ^[0-9]+$ ]] || return 1
  binding_database="$database"; binding_session_user="$session_user"; binding_current_user="$current_user"; binding_server_port="$server_port"; binding_backend_pid="$backend_pid"
}
target_identity="$(docker container inspect --size --format '{{.Id}}|{{.Name}}|{{.State.Running}}|{{.Config.Image}}|{{.SizeRw}}' "${sentinel_cfg[container_id]}" 2>/dev/null)" || fail "disposable target container identity could not be verified"
printf '%s\n' "$target_identity" > "$scratch/target-docker-before"
IFS='|' read -r inspected_id inspected_name inspected_running inspected_image container_disk_bytes <<< "$target_identity"
[[ "$inspected_id" == "${sentinel_cfg[container_id]}" && "$inspected_name" == /quest-rehearsal-* && "$inspected_running" == true && "$inspected_image" =~ ^postgres:17([.][0-9]+)?(-bookworm)?@sha256:[0-9a-f]{64}$ && "$container_disk_bytes" =~ ^[0-9]+$ ]] || fail "disposable target container identity and immutable PostgreSQL 17 image are unsafe"
url_endpoint="$(python3 - "$db_url" <<'PY'
from urllib.parse import urlsplit
import sys
u = urlsplit(sys.argv[1])
if u.scheme not in ("postgres", "postgresql") or u.hostname != "127.0.0.1" or u.port is None:
    raise SystemExit(1)
print(f"{u.hostname}|{u.port}")
PY
)" || fail "DIRECT_URL must use the exact disposable loopback endpoint"
IFS='|' read -r url_host url_port <<< "$url_endpoint"
mapping_json="$(docker container inspect --format '{{json .NetworkSettings.Ports}}' "${sentinel_cfg[container_id]}" 2>/dev/null)" || fail "disposable target port mapping could not be inspected"
printf '%s\n' "$mapping_json" > "$scratch/target-port-mapping"
mapping="$(python3 - "$mapping_json" <<'PY'
import json, sys
ports = json.loads(sys.argv[1])
bindings = ports.get("5432/tcp") or []
if len(bindings) != 1 or bindings[0].get("HostIp") != "127.0.0.1":
    raise SystemExit(1)
print(f"{bindings[0].get('HostIp')}|{bindings[0].get('HostPort')}")
PY
)" || fail "DIRECT_URL cannot be bound to one loopback PostgreSQL container port"
IFS='|' read -r mapped_host mapped_port <<< "$mapping"
[[ "$mapped_host" == "$url_host" && "$mapped_port" == "$url_port" && "$url_port" =~ ^[0-9]+$ ]] || fail "DIRECT_URL does not match the inspected container port mapping"
target_database="${runtime_endpoint##*|}"
rehearsal_nonce="$(openssl rand -hex 32)" || fail "fresh target-binding nonce could not be generated"
rehearsal_app_name="quest-rehearsal-$rehearsal_nonce"; export PGAPPNAME="$rehearsal_app_name"
start_binding_session "$rehearsal_app_name" "$scratch/connection-binding" "$scratch/connection-binding.stderr" || fail "target connection binding session could not be held open"
validate_binding_output "$scratch/connection-binding" "$rehearsal_app_name" || fail "DIRECT_URL active connection binding is malformed"
docker_psql_query() { docker container exec --user postgres "${sentinel_cfg[container_id]}" psql -X -A -t -F '|' -d postgres -c "$2" >"$1" 2>/dev/null; }
docker_psql_query "$scratch/docker-connection-binding" "SELECT application_name || '|' || datname || '|' || usename || '|' || COALESCE(state,'') || '|' || COALESCE(inet_server_port(),0) || '|' || pid FROM pg_stat_activity WHERE application_name='$rehearsal_app_name' AND backend_type='client backend'" || fail "independent container connection binding probe failed"
[[ "$(wc -l < "$scratch/docker-connection-binding" | tr -d ' ')" == 1 ]] || fail "independent container connection binding did not observe exactly one active session"
stop_binding_session
nonce_sha256="$(printf '%s' "$rehearsal_nonce" | sha256sum | cut -d' ' -f1)"
psql_query "$scratch/target-sentinel" "SELECT current_setting('quest.rehearsal_target_id', true)" || fail "disposable target sentinel query failed"
[[ "$(tr -d '[:space:]' < "$scratch/target-sentinel")" == "${sentinel_cfg[target_id]}" ]] || fail "database sentinel does not match disposable target"
psql_query "$scratch/target-server-version" "SELECT current_setting('server_version_num')" || fail "target server version query failed"
target_server_version="$(tr -d '[:space:]' < "$scratch/target-server-version")"; [[ "$target_server_version" =~ ^17[0-9]{4}$ ]] || fail "disposable target server is not PostgreSQL 17"
validate_extensions() { local file="$1" count; count="$(wc -l < "$file" | tr -d ' ')"; [[ "$count" == 1 ]] && grep -qx 'plpgsql|1.0' "$file"; }
validate_settings() { local file="$1" count; count="$(wc -l < "$file" | tr -d ' ')"; [[ "$count" == 7 ]] && grep -Eq '^server_version\|PostgreSQL_17([.][0-9]+)?$' "$file" && grep -Eq '^server_version_num\|17[0-9]{4}$' "$file" && grep -qx 'ssl|on' "$file" && grep -Eq '^ssl_min_protocol_version\|TLSv1\.(2|3)$' "$file" && grep -qx 'row_security|on' "$file" && grep -qx 'default_transaction_read_only|off' "$file" && grep -Eq '^listen_addresses\|([*]|localhost|127\.0\.0\.1)$' "$file"; }
psql_query "$scratch/ext-before" "SELECT extname || '|' || extversion FROM pg_extension ORDER BY extname" || fail "pre-restore extension inventory query failed"
validate_extensions "$scratch/ext-before" || fail "pre-restore extension inventory is missing required PostgreSQL extensions"
extensions_before_sha256="$(sha256sum "$scratch/ext-before" | cut -d' ' -f1)"; extensions_before_count="$(wc -l < "$scratch/ext-before" | tr -d ' ')"
psql_query "$scratch/settings-before" "SELECT name || '|' || regexp_replace(setting, '[^A-Za-z0-9_.:+*/-]', '_', 'g') FROM pg_settings WHERE name IN ('server_version','server_version_num','ssl','ssl_min_protocol_version','row_security','default_transaction_read_only','listen_addresses') ORDER BY name" || fail "pre-restore settings inventory query failed"
validate_settings "$scratch/settings-before" || fail "pre-restore PostgreSQL settings are unsafe or unknown"
settings_before_sha256="$(sha256sum "$scratch/settings-before" | cut -d' ' -f1)"
ledger_presence() {
  local schema="$1" table="$2" output="$3" presence
  psql_query "$output" "SELECT CASE WHEN to_regclass('${schema}.${table}') IS NULL THEN 'absent' ELSE 'present' END" || return 1
  presence="$(tr -d '[:space:]' < "$output")"
  [[ "$presence" == absent ]] || fail "application ledger already exists before destructive restore: ${schema}.${table}"
  printf 'status|absent\n' > "${output}.inventory"
  printf '%s' "$presence"
}
quest_migrations_before="$(ledger_presence public _prisma_migrations "$scratch/public-ledger-before")" || fail "Quest migration ledger pre-restore probe failed"
valorant_migrations_before="$(ledger_presence valorant _migration_ledger "$scratch/valorant-ledger-before")" || fail "VALORANT migration ledger pre-restore probe failed"
cp -- "$scratch/public-ledger-before.inventory" "$scratch/quest-migrations-before.tsv"
cp -- "$scratch/valorant-ledger-before.inventory" "$scratch/valorant-migrations-before.tsv"

source_major="$(grep -m1 '^source_major=' "$source_record" | cut -d= -f2-)"; source_version="$(grep -m1 '^source_version=' "$source_record" | cut -d= -f2-)"; source_provenance="$(grep -m1 '^provenance=' "$source_record" | cut -d= -f2-)"
[[ "$source_major" =~ ^[0-9]+$ && "$source_major" -gt 0 && "$source_version" =~ ^PostgreSQL_${source_major}([.][0-9]+)?$ && "$source_provenance" == operator_recorded ]] || fail "source-version evidence is incomplete or unsafe"
gate=none; if [[ "$source_major" != 17 ]]; then [[ "${SOURCE_MAJOR_MISMATCH_APPROVAL:-}" == approved ]] || fail "source-major mismatch lacks approved logical-migration gate"; gate=approved_logical_major_migration; fi

isolated="$scratch/BACKUP_ENV_FILE"
{ printf 'DIRECT_URL='; printf '%q' "$db_url"; printf '\nUPLOAD_ROOT='; printf '%q' "$public_root"; printf '\nPRIVATE_UPLOAD_ROOT='; printf '%q' "$private_root"; printf '\nBACKUP_AGE_IDENTITY_FILE='; printf '%q' "$identity"; printf '\n'; } > "$isolated"; chmod 600 "$isolated"
[[ -x /usr/bin/time ]] || fail "/usr/bin/time is required for measured resource evidence"
env -u BASH_ENV -u ENV RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION BACKUP_ENV_FILE="$isolated" RESTORE_COUNTDOWN_SECONDS=0 /usr/bin/time -f 'cpu_seconds=%U\npeak_memory_kb=%M' -o "$scratch/resource" bash "$restore" "$archive" >"$scratch/restore.log" 2>&1 || fail "existing restore primitive failed"
cpu="$(grep -m1 '^cpu_seconds=' "$scratch/resource" | cut -d= -f2)"; memory="$(grep -m1 '^peak_memory_kb=' "$scratch/resource" | cut -d= -f2)"
[[ "$cpu" =~ ^[0-9]+([.][0-9]+)?$ && "$memory" =~ ^[0-9]+$ ]] || fail "resource measurement is incomplete"
target_identity_after="$(docker container inspect --size --format '{{.Id}}|{{.Name}}|{{.State.Running}}|{{.Config.Image}}|{{.SizeRw}}' "${sentinel_cfg[container_id]}" 2>/dev/null)" || fail "disposable target container could not be re-inspected"
printf '%s\n' "$target_identity_after" > "$scratch/target-docker-after"
IFS='|' read -r inspected_id_after inspected_name_after inspected_running_after inspected_image_after container_disk_bytes_after <<< "$target_identity_after"
[[ "$inspected_id_after" == "${sentinel_cfg[container_id]}" && "$inspected_name_after" == /quest-rehearsal-* && "$inspected_running_after" == true && "$inspected_image_after" =~ ^postgres:17([.][0-9]+)?(-bookworm)?@sha256:[0-9a-f]{64}$ && "$container_disk_bytes_after" =~ ^[0-9]+$ ]] || fail "post-restore target container identity and immutable PostgreSQL 17 image are unsafe"
mapping_json_after="$(docker container inspect --format '{{json .NetworkSettings.Ports}}' "${sentinel_cfg[container_id]}" 2>/dev/null)" || fail "post-restore target port mapping could not be inspected"
printf '%s\n' "$mapping_json_after" > "$scratch/target-port-mapping-after"
mapping_after="$(python3 - "$mapping_json_after" <<'PY'
import json, sys
ports = json.loads(sys.argv[1])
bindings = ports.get("5432/tcp") or []
if len(bindings) != 1 or bindings[0].get("HostIp") != "127.0.0.1":
    raise SystemExit(1)
print(f"{bindings[0].get('HostIp')}|{bindings[0].get('HostPort')}")
PY
)" || fail "post-restore target port mapping is unsafe"
[[ "$mapping_after" == "$mapping" && "$mapping_after" == "$url_host|$url_port" ]] || fail "post-restore target port mapping changed"
rehearsal_nonce_after="$(openssl rand -hex 32)" || fail "fresh post-restore target-binding nonce could not be generated"
rehearsal_app_name_after="quest-rehearsal-$rehearsal_nonce_after"; export PGAPPNAME="$rehearsal_app_name_after"
start_binding_session "$rehearsal_app_name_after" "$scratch/connection-binding-after" "$scratch/connection-binding-after.stderr" || fail "post-restore connection binding session could not be held open"
validate_binding_output "$scratch/connection-binding-after" "$rehearsal_app_name_after" || fail "post-restore active connection binding is malformed"
docker_psql_query "$scratch/docker-connection-binding-after" "SELECT application_name || '|' || datname || '|' || usename || '|' || COALESCE(state,'') || '|' || COALESCE(inet_server_port(),0) || '|' || pid FROM pg_stat_activity WHERE application_name='$rehearsal_app_name_after' AND backend_type='client backend'" || fail "post-restore independent container connection binding probe failed"
[[ "$(wc -l < "$scratch/docker-connection-binding-after" | tr -d ' ')" == 1 ]] || fail "post-restore independent container connection binding did not observe exactly one active session"
stop_binding_session
nonce_after_sha256="$(printf '%s' "$rehearsal_nonce_after" | sha256sum | cut -d' ' -f1)"
psql_query "$scratch/database-size" "SELECT pg_database_size(current_database())" || fail "database size query failed"
database_size_bytes="$(tr -d '[:space:]' < "$scratch/database-size")"; [[ "$database_size_bytes" =~ ^[0-9]+$ && "$database_size_bytes" -gt 0 ]] || fail "database size evidence is invalid"

psql_tsv() { psql -X -A -t -F $'\t' "$db_url" -c "$2" >"$1" 2>/dev/null; }
psql_query "$scratch/counts" "SELECT n.nspname || '|' || count(*) FILTER (WHERE c.relkind IN ('r','p','f')) || '|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','valorant') GROUP BY n.nspname ORDER BY n.nspname" || fail "schema/object query failed"
public_tables=0; valorant_tables=0; public_objects=0; valorant_objects=0
while IFS='|' read -r schema tables objects; do [[ "$tables" =~ ^[0-9]+$ && "$objects" =~ ^[0-9]+$ ]] || fail "schema/object output malformed"; [[ "$schema" == public ]] && public_tables="$tables" && public_objects="$objects"; [[ "$schema" == valorant ]] && valorant_tables="$tables" && valorant_objects="$objects"; done < "$scratch/counts"
(( public_tables > 0 && valorant_tables > 0 && public_objects > 0 && valorant_objects > 0 )) || fail "schema/object counts are not non-zero"
ledger() {
  local schema="$1" table="$2" out="$3" count id completion
  psql_query "$out" "SELECT COALESCE(j->>'id',j->>'migration_id',j->>'migration_name',j->>'name','') || '|' || CASE WHEN COALESCE(j->>'finished_at',j->>'completed_at',j->>'applied_at') IS NOT NULL OR COALESCE(j->>'applied','') IN ('t','true') THEN 'complete' ELSE 'incomplete' END FROM (SELECT to_jsonb(t) AS j FROM \"$schema\".\"$table\" t) rows ORDER BY 1" || return 1
  count=0
  while IFS='|' read -r id completion; do
    [[ "$id" =~ ^[A-Za-z0-9_.-]+$ && "$completion" == complete ]] || return 1
    count=$((count+1))
  done < "$out"
  (( count > 0 )) || return 1
  printf '%s' "$count"
}
quest_migrations="$(ledger public _prisma_migrations "$scratch/q-ledger")" || fail "Quest migration ledger was not verified"
valorant_migrations="$(ledger valorant _migration_ledger "$scratch/v-ledger")" || fail "VALORANT _migration_ledger was not verified"
cp -- "$scratch/q-ledger" "$scratch/quest-migrations.tsv"
cp -- "$scratch/v-ledger" "$scratch/valorant-migrations.tsv"
for pair in "roles|SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime')) AND EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='public' AND r.rolname='quest_migrator') AND EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='valorant' AND r.rolname='val_migrator') THEN 'verified' ELSE 'failed' END" "grants|SELECT CASE WHEN has_schema_privilege('quest_runtime','public','USAGE') AND has_schema_privilege('val_runtime','valorant','USAGE') AND NOT has_schema_privilege('quest_runtime','valorant','CREATE') AND NOT has_schema_privilege('val_runtime','public','CREATE') THEN 'verified' ELSE 'failed' END" "acl|SELECT CASE WHEN count(*) >= 2 THEN 'verified' ELSE 'failed' END FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN ('public','valorant')"; do name="${pair%%|*}" sql="${pair#*|}"; psql_query "$scratch/$name" "$sql" || fail "$name query failed"; [[ "$(tr -d '[:space:]' < "$scratch/$name")" == verified ]] || fail "$name was not verified"; done
psql_query "$scratch/roles" "SELECT rolname || '|' || CASE WHEN rolcanlogin THEN 't' ELSE 'f' END || '|' || CASE WHEN rolinherit THEN 't' ELSE 'f' END || '|' || CASE WHEN rolsuper THEN 't' ELSE 'f' END || '|' || CASE WHEN rolcreatedb THEN 't' ELSE 'f' END || '|' || CASE WHEN rolcreaterole THEN 't' ELSE 'f' END || '|' || CASE WHEN rolreplication THEN 't' ELSE 'f' END || '|' || CASE WHEN rolbypassrls THEN 't' ELSE 'f' END FROM pg_roles WHERE rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime') ORDER BY rolname" || fail "role attribute query failed"; [[ "$(wc -l < "$scratch/roles" | tr -d ' ')" == 4 ]] || fail "four database roles were not observed"; while IFS='|' read -r role login inherit super createdb createrole replication bypass; do [[ "$role" =~ ^(quest_migrator|quest_runtime|val_migrator|val_runtime)$ && "$login" == t && "$inherit" == f && "$super" == f && "$createdb" == f && "$createrole" == f && "$replication" == f && "$bypass" == f ]] || fail "role attributes are unsafe"; done < "$scratch/roles"
psql_query "$scratch/memberships" "SELECT count(*) FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE granted.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime') OR member.rolname IN ('quest_migrator','quest_runtime','val_migrator','val_runtime')" || fail "membership query failed"; membership_count="$(tr -d '[:space:]' < "$scratch/memberships")"; [[ "$membership_count" == 0 ]] || fail "unexpected role membership observed"
psql_query "$scratch/owners" "SELECT n.nspname || '|' || r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname IN ('public','valorant') ORDER BY n.nspname" || fail "schema owner query failed"; grep -qx 'public|quest_migrator' "$scratch/owners" && grep -qx 'valorant|val_migrator' "$scratch/owners" || fail "schema owners are incorrect"
psql_query "$scratch/grants-status" "SELECT CASE WHEN has_schema_privilege('quest_migrator','public','USAGE') AND has_schema_privilege('quest_migrator','public','CREATE') AND has_schema_privilege('quest_runtime','public','USAGE') AND has_schema_privilege('val_migrator','valorant','USAGE') AND has_schema_privilege('val_migrator','valorant','CREATE') AND has_schema_privilege('val_runtime','valorant','USAGE') AND NOT has_schema_privilege('quest_runtime','valorant','USAGE') AND NOT has_schema_privilege('val_runtime','public','USAGE') AND COALESCE((SELECT bool_and(has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','f')), false) AND COALESCE((SELECT bool_and(has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind IN ('r','p','f')), false) AND COALESCE((SELECT bool_and(has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'), true) AND COALESCE((SELECT bool_and(has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind='S'), true) THEN 'verified' ELSE 'failed' END" || fail "grant query failed"; [[ "$(tr -d '[:space:]' < "$scratch/grants-status")" == verified ]] || fail "runtime grants or cross-schema denials were not verified"
bootstrap_sql="$base/docker/postgres/init/001-bootstrap-roles.sql"; [[ -f "$bootstrap_sql" && ! -L "$bootstrap_sql" ]] || fail "canonical bootstrap SQL is missing"; bootstrap_sql_sha256="$(sha256sum "$bootstrap_sql" | cut -d' ' -f1)"
for contract in 'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;' 'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE USAGE ON TYPES FROM PUBLIC;' 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quest_runtime;' 'GRANT USAGE, SELECT ON SEQUENCES TO quest_runtime;' 'GRANT EXECUTE ON FUNCTIONS TO quest_migrator;' 'GRANT USAGE ON TYPES TO quest_migrator;' 'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;' 'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE USAGE ON TYPES FROM PUBLIC;' 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO val_runtime;' 'GRANT USAGE, SELECT ON SEQUENCES TO val_runtime;' 'GRANT EXECUTE ON FUNCTIONS TO val_migrator;' 'GRANT USAGE ON TYPES TO val_migrator;'; do grep -F "$contract" "$bootstrap_sql" >/dev/null || fail "canonical bootstrap ACL contract is incomplete"; done
psql_query "$scratch/acl-public-status" "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl,'{}')) x WHERE x.grantee=0) THEN 'failed' ELSE 'verified' END" || fail "default ACL PUBLIC check failed"; [[ "$(tr -d '[:space:]' < "$scratch/acl-public-status")" == verified ]] || fail "default ACL contains a PUBLIC grant"
psql_query "$scratch/grants" "SELECT 'schema|public|quest_migrator|USAGE|' || CASE WHEN has_schema_privilege('quest_migrator','public','USAGE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|public|quest_migrator|CREATE|' || CASE WHEN has_schema_privilege('quest_migrator','public','CREATE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|public|quest_runtime|USAGE|' || CASE WHEN has_schema_privilege('quest_runtime','public','USAGE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|valorant|val_migrator|USAGE|' || CASE WHEN has_schema_privilege('val_migrator','valorant','USAGE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|valorant|val_migrator|CREATE|' || CASE WHEN has_schema_privilege('val_migrator','valorant','CREATE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|valorant|val_runtime|USAGE|' || CASE WHEN has_schema_privilege('val_runtime','valorant','USAGE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|valorant|quest_runtime|USAGE_DENIED|' || CASE WHEN NOT has_schema_privilege('quest_runtime','valorant','USAGE') THEN 't' ELSE 'f' END UNION ALL SELECT 'schema|public|val_runtime|USAGE_DENIED|' || CASE WHEN NOT has_schema_privilege('val_runtime','public','USAGE') THEN 't' ELSE 'f' END ORDER BY 1" || fail "grant inventory query failed"
psql_query "$scratch/grant-aggregate" "SELECT 'table|public|quest_runtime|all|' || CASE WHEN COALESCE((SELECT bool_and(has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','f')), false) THEN 't' ELSE 'f' END UNION ALL SELECT 'table|valorant|val_runtime|all|' || CASE WHEN COALESCE((SELECT bool_and(has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'INSERT') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'UPDATE') AND has_table_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind IN ('r','p','f')), false) THEN 't' ELSE 'f' END UNION ALL SELECT 'sequence|public|quest_runtime|usage_select|' || CASE WHEN COALESCE((SELECT bool_and(has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('quest_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'), true) THEN 't' ELSE 'f' END UNION ALL SELECT 'sequence|valorant|val_runtime|usage_select|' || CASE WHEN COALESCE((SELECT bool_and(has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'USAGE') AND has_sequence_privilege('val_runtime', format('%I.%I', n.nspname,c.relname), 'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='valorant' AND c.relkind='S'), true) THEN 't' ELSE 'f' END" || fail "table/sequence grant inventory query failed"; cat "$scratch/grant-aggregate" >> "$scratch/grants"
psql_query "$scratch/acl" "SELECT r.rolname || '|' || n.nspname || '|' || d.defaclobjtype::text || '|' || COALESCE(array_to_string(d.defaclacl,','),'') FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE r.rolname IN ('quest_migrator','val_migrator') AND n.nspname IN ('public','valorant') ORDER BY r.rolname,n.nspname,d.defaclobjtype" || fail "default ACL inventory query failed"
psql_query "$scratch/acl-global" "SELECT r.rolname || '|<global>|' || d.defaclobjtype::text || '|' || COALESCE(array_to_string(d.defaclacl,','),'') FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole WHERE r.rolname IN ('quest_migrator','val_migrator') AND d.defaclnamespace IS NULL ORDER BY r.rolname,d.defaclobjtype" || fail "global default ACL inventory query failed"
cat "$scratch/acl-global" >> "$scratch/acl"
[[ "$(wc -l < "$scratch/grants" | tr -d ' ')" -ge 12 ]] || fail "grant inventory is incomplete"
[[ "$(wc -l < "$scratch/acl" | tr -d ' ')" == 12 ]] || fail "default ACL inventory contains unexpected extra rows"
while IFS='|' read -r kind grant_scope role privilege granted; do [[ "$granted" == t ]] || fail "grant inventory contains a denied expected privilege"; if [[ "$kind" == schema ]]; then [[ "$role" =~ ^(quest_migrator|quest_runtime|val_migrator|val_runtime)$ ]]; else [[ "$kind" == table || "$kind" == sequence ]] || fail "grant inventory kind is unsafe"; fi; done < "$scratch/grants"
for expected in 'quest_migrator|public' 'val_migrator|valorant'; do grep -q "^${expected}|r|" "$scratch/acl" || fail "default ACL table entry is missing"; grep -q "^${expected}|S|" "$scratch/acl" || fail "default ACL sequence entry is missing"; grep -q "^${expected}|f|" "$scratch/acl" || fail "default ACL function entry is missing"; grep -q "^${expected}|T|" "$scratch/acl" || fail "default ACL type entry is missing"; done
for expected in 'quest_migrator|<global>|f|' 'quest_migrator|<global>|T|' 'val_migrator|<global>|f|' 'val_migrator|<global>|T|'; do grep -q "^${expected}" "$scratch/acl" || fail "global default ACL entry is missing"; done
grep -Eq '(^|[{,])=' "$scratch/acl" && fail "default ACL payload contains a PUBLIC grant"
psql_query "$scratch/ext" "SELECT extname || '|' || extversion FROM pg_extension ORDER BY extname" || fail "extension inventory query failed"; extensions_sha256="$(sha256sum "$scratch/ext" | cut -d' ' -f1)"; validate_extensions "$scratch/ext" || fail "post-restore extension inventory is missing required PostgreSQL extensions"; extensions_count="$(wc -l < "$scratch/ext" | tr -d ' ')"
[[ "$extensions_before_sha256" == "$(sha256sum "$scratch/ext-before" | cut -d' ' -f1)" ]] || fail "pre-restore extension inventory binding failed"
psql_query "$scratch/settings" "SELECT name || '|' || regexp_replace(setting, '[^A-Za-z0-9_.:+*/-]', '_', 'g') FROM pg_settings WHERE name IN ('server_version','server_version_num','ssl','ssl_min_protocol_version','row_security','default_transaction_read_only','listen_addresses') ORDER BY name" || fail "settings inventory query failed"; settings_sha256="$(sha256sum "$scratch/settings" | cut -d' ' -f1)"; validate_settings "$scratch/settings" || fail "post-restore PostgreSQL settings are unsafe or unknown"; settings="$(grep '^server_version_num|' "$scratch/settings" | cut -d'|' -f2)"; [[ "$settings" =~ ^17[0-9]{4}$ ]] || fail "target PostgreSQL server is not major 17"; target_major=17
cmp -s "$scratch/ext-before" "$scratch/ext" || fail "extension inventory changed during restore"
cmp -s "$scratch/settings-before" "$scratch/settings" || fail "PostgreSQL settings changed during restore"
runtime_psql_query "$scratch/quest-read-probe" "SELECT session_user || '|' || current_user || '|' || count(*) FROM public.\"users\"" || fail "Quest runtime database-backed read probe failed"
IFS='|' read -r quest_read_probe_session_user quest_read_probe_current_user quest_read_probe_count < "$scratch/quest-read-probe"
[[ "$quest_read_probe_session_user" == quest_runtime && "$quest_read_probe_current_user" == quest_runtime && "$quest_read_probe_count" =~ ^[0-9]+$ ]] || fail "Quest database-backed read probe returned an invalid authenticated role or count"
psql_tsv "$scratch/rls" "SELECT n.nspname, c.relname, c.relrowsecurity, COALESCE(p.policyname,'<none>'), COALESCE(array_to_string(p.roles,','),'<none>'), COALESCE(p.cmd,'<none>'), COALESCE(replace(replace(p.qual,E'\\t','_'),E'\\n','_'),'<none>'), COALESCE(replace(replace(p.with_check,E'\\t','_'),E'\\n','_'),'<none>') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname WHERE n.nspname IN ('public','valorant') AND c.relkind IN ('r','p','f') ORDER BY n.nspname,c.relname,p.policyname" || fail "RLS query failed"
rls_enabled="$(awk -F '\t' '$3 == "t" { n++ } END { print n + 0 }' "$scratch/rls")"; rls_tables="$(wc -l < "$scratch/rls" | tr -d ' ')"; [[ "$rls_enabled" =~ ^[0-9]+$ && "$rls_tables" =~ ^[0-9]+$ && "$rls_enabled" -gt 0 ]] || fail "RLS evidence was not verified"
while IFS=$'\t' read -r schema table protected policy roles command qual with_check; do [[ "$schema" == public || "$schema" == valorant ]] || fail "RLS schema is unsafe"; [[ -n "$table" && "$protected" == t || "$protected" == f ]] || fail "RLS table row is malformed"; if [[ "$schema" == valorant && "$table" != _migration_ledger ]]; then [[ "$protected" == t && "$policy" == "${table}_runtime_all" && "$roles" == *val_runtime* && "$command" == 'ALL' ]] || fail "VALORANT table lacks its val_runtime RLS policy"; fi; done < "$scratch/rls"

security_hook="${SECURITY_VERIFY_COMMAND:-}"
[[ "$security_hook" == /* && -x "$security_hook" && ! -L "$security_hook" ]] || fail "SECURITY_VERIFY_COMMAND must be an absolute executable hook"
check_path "$security_hook" SECURITY_VERIFY_COMMAND
security_output="$scratch/security-verifier.output"
env -u BASH_ENV -u ENV DIRECT_URL="$db_url" DATABASE_URL="$db_url" "$security_hook" >"$security_output" 2>&1 || fail "repository security verifier failed"
security_result="$(tr -d '\r' < "$security_output")"; [[ "$security_result" == security-verified ]] || fail "repository security verifier did not return the exact security-verified token"
security_output_sha256="$(sha256sum "$security_output" | cut -d' ' -f1)"

tree() { local root="$1" prefix="$2" count=0 bytes=0 file size digest; [[ -z "$(find -P "$root" -type l -print -quit)" ]] || fail "upload tree contains a symbolic link"; while IFS= read -r -d '' file; do count=$((count+1)); size="$(stat -c '%s' -- "$file")"; bytes=$((bytes+size)); done < <(find -P "$root" -type f -print0); digest="$(while IFS= read -r -d '' file; do sha256sum -- "$file"; done < <(find -P "$root" -type f -print0 | sort -z) | sha256sum | cut -d' ' -f1)"; printf -v "${prefix}_files" '%s' "$count"; printf -v "${prefix}_bytes" '%s' "$bytes"; printf -v "${prefix}_checksum" '%s' "$digest"; }
tree "$public_root" public; tree "$private_root" private
(( public_files > 0 && private_files > 0 && public_bytes > 0 && private_bytes > 0 )) || fail "restored public/private upload roots are empty"

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
validate_failure_output() {
  local injection="$1" output="$2" expected_endpoint_id="$3" expected_endpoint_sha256="$4" expected_class
  local expected_service expected_pre_state expected_post_state
  case "$injection" in
    bad_checksum) expected_class=archive_checksum_failed; expected_service=quest-backup; expected_pre_state=running; expected_post_state=running ;; bad_decryption) expected_class=age_decryption_failed; expected_service=quest-backup; expected_pre_state=running; expected_post_state=running ;; wrong_ca) expected_class=certificate_verification_failed; expected_service=valorant-health; expected_pre_state=running; expected_post_state=running ;;
    blocked_network) expected_class=network_blocked; expected_service=valorant-health; expected_pre_state=running; expected_post_state=blocked ;; failed_service_health) expected_class=service_health_failed; expected_service=valorant-health; expected_pre_state=running; expected_post_state=stopped ;; attempted_mutation_callback) expected_class=writer_mutation_rejected; expected_service=quest-api; expected_pre_state=running; expected_post_state=blocked ;;
  esac
  declare -A failure=()
  while IFS= read -r line || [[ -n "$line" ]]; do [[ "$line" =~ ^([a-z][a-z0-9_]*)=([^[:space:]]+)$ ]] || return 1; key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"; [[ -z "${failure[$key]+x}" ]] || return 1; failure["$key"]="$value"; done < "$output"
  for key in result failure_class service_identity endpoint_id endpoint_sha256 pre_state post_state containment unaffected_service; do [[ -n "${failure[$key]:-}" ]] || return 1; done
  [[ "${failure[result]}" == passed && "${failure[failure_class]}" == "$expected_class" && "${failure[service_identity]}" == "$expected_service" && "${failure[endpoint_id]}" == "$expected_endpoint_id" && "${failure[endpoint_sha256]}" == "$expected_endpoint_sha256" && "${failure[pre_state]}" == "$expected_pre_state" && "${failure[post_state]}" == "$expected_post_state" && "${failure[containment]}" == verified && "${failure[unaffected_service]}" == verified ]]
}
no_admission_hook="${NO_WRITER_ADMISSION_COMMAND:-}"; [[ "$no_admission_hook" == /* && -x "$no_admission_hook" && ! -L "$no_admission_hook" ]] || fail "NO_WRITER_ADMISSION_COMMAND must be an absolute executable hook"; check_path "$no_admission_hook" NO_WRITER_ADMISSION_COMMAND
run_exact_hook "$no_admission_hook" verified "$scratch/no-admission.output" || fail "no-writer-admission hook did not return verified"
for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do
  var="FAILURE_INJECTION_${injection^^}_COMMAND"; hook="${!var:-}"
  [[ "$hook" == /* && -x "$hook" && ! -L "$hook" ]] || fail "failure injection $injection needs an executable hook"
  check_path "$hook" "$var"
  case "$injection" in
    bad_checksum) endpoint_id=archive-checksum; endpoint_sha256="$(sha256sum "$checksum" | cut -d' ' -f1)" ;;
    bad_decryption) endpoint_id=archive-decryption; endpoint_sha256="$(sha256sum "$archive" | cut -d' ' -f1)" ;;
    wrong_ca|blocked_network|failed_service_health) endpoint_id=valorant-health; endpoint_sha256="$(printf '%s' "$val_health" | sha256sum | cut -d' ' -f1)" ;;
    attempted_mutation_callback) endpoint_id=quest-api; endpoint_sha256="$(printf '%s' "$callback" | sha256sum | cut -d' ' -f1)" ;;
  esac
  export FAILURE_ENDPOINT_ID="$endpoint_id" FAILURE_ENDPOINT_SHA256="$endpoint_sha256"
  staged_hook="$evidence/.rehearsal-failure-hook-$injection.sh"
  [[ ! -e "$staged_hook" && ! -L "$staged_hook" ]] || fail "failure injection $injection staged path already exists"
  cp -- "$hook" "$staged_hook"; chmod 700 "$staged_hook"
  configured_hook_sha256="$(sha256sum "$hook" | cut -d' ' -f1)"; staged_hook_sha256_before="$(sha256sum "$staged_hook" | cut -d' ' -f1)"
  [[ "$configured_hook_sha256" == "$staged_hook_sha256_before" ]] || fail "failure injection $injection staging hash mismatch"
  env -u BASH_ENV -u ENV DIRECT_URL="$db_url" DATABASE_URL="$db_url" "$staged_hook" >"$scratch/$injection.output" 2>&1 || fail "failure injection $injection hook failed"
  [[ "$(sha256sum "$staged_hook" | cut -d' ' -f1)" == "$staged_hook_sha256_before" ]] || fail "failure injection $injection staged executable changed during execution"
  mv -f -- "$staged_hook" "$evidence/rehearsal-failure-hook-$injection.sh"
  validate_failure_output "$injection" "$scratch/$injection.output" "$endpoint_id" "$endpoint_sha256" || fail "failure injection $injection evidence is not structured or contained"
done
failure_inventory="$scratch/failure-injections.tsv"
: > "$failure_inventory"
for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do
  var="FAILURE_INJECTION_${injection^^}_COMMAND"; hook="${!var}"
  case "$injection" in
    bad_checksum) endpoint_id=archive-checksum; endpoint_sha256="$(sha256sum "$checksum" | cut -d' ' -f1)" ;;
    bad_decryption) endpoint_id=archive-decryption; endpoint_sha256="$(sha256sum "$archive" | cut -d' ' -f1)" ;;
    wrong_ca|blocked_network|failed_service_health) endpoint_id=valorant-health; endpoint_sha256="$(printf '%s' "$val_health" | sha256sum | cut -d' ' -f1)" ;;
    attempted_mutation_callback) endpoint_id=quest-api; endpoint_sha256="$(printf '%s' "$callback" | sha256sum | cut -d' ' -f1)" ;;
  esac
  staged_hook="$evidence/rehearsal-failure-hook-$injection.sh"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$injection" "$hook" "$(sha256sum "$hook" | cut -d' ' -f1)" "$staged_hook" "$(sha256sum "$staged_hook" | cut -d' ' -f1)" "$endpoint_id" "$endpoint_sha256" passed "$(sha256sum "$scratch/$injection.output" | cut -d' ' -f1)" >> "$failure_inventory"
done
rpo="${REHEARSAL_RPO_SECONDS:-}"; rpo_decision="${REHEARSAL_RPO_DECISION:-}"
rto="${REHEARSAL_RTO_SECONDS:-}"; rto_decision="${REHEARSAL_RTO_DECISION:-}"
[[ "$rpo" =~ ^[0-9]+$ && "$rpo" -gt 0 && ( "$rpo_decision" == met || "$rpo_decision" == not_met ) ]] || fail "approved RPO and explicit decision are required"
[[ "$rto" =~ ^[0-9]+$ && "$rto" -gt 0 && ( "$rto_decision" == met || "$rto_decision" == not_met ) ]] || fail "approved RTO and explicit decision are required"
decision="$rto_decision"
disk="$(du -sk -- "$public_root" "$private_root" | awk '{sum += $1} END {print sum * 1024}')"; [[ "$disk" =~ ^[0-9]+$ ]] || fail "disk resource measurement failed"
end="$(date -u +%s)"; end_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; duration=$((end-start))

tmp="$evidence/.rehearsal-evidence.$$"
for artifact in roles memberships owners grants acl ext settings rls quest-migrations-before valorant-migrations-before quest-migrations valorant-migrations; do cp -- "$scratch/$artifact" "$evidence/rehearsal-${artifact}.tsv"; chmod 600 "$evidence/rehearsal-${artifact}.tsv"; done
cp -- "$scratch/ext-before" "$evidence/rehearsal-ext-before.tsv"; cp -- "$scratch/settings-before" "$evidence/rehearsal-settings-before.tsv"; chmod 600 "$evidence/rehearsal-ext-before.tsv" "$evidence/rehearsal-settings-before.tsv"
for artifact in target-docker-before target-port-mapping target-port-mapping-after connection-binding docker-connection-binding target-docker-after connection-binding-after docker-connection-binding-after; do cp -- "$scratch/$artifact" "$evidence/rehearsal-${artifact}.txt"; chmod 600 "$evidence/rehearsal-${artifact}.txt"; done
cp -- "$scratch/quest-read-probe" "$evidence/rehearsal-quest-read-probe.tsv"; chmod 600 "$evidence/rehearsal-quest-read-probe.tsv"
cp -- "$failure_inventory" "$evidence/rehearsal-failure-injections.tsv"; chmod 600 "$evidence/rehearsal-failure-injections.tsv"
for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do cp -- "$scratch/$injection.output" "$evidence/rehearsal-failure-${injection}.output"; chmod 600 "$evidence/rehearsal-failure-${injection}.output"; done
cp -- "$source_record" "$evidence/rehearsal-source-version.env"; chmod 600 "$evidence/rehearsal-source-version.env"
cp -- "$security_output" "$evidence/rehearsal-security-verifier.output"; chmod 600 "$evidence/rehearsal-security-verifier.output"
cp -- "$sentinel" "$evidence/rehearsal-target-sentinel.env"; chmod 600 "$evidence/rehearsal-target-sentinel.env"
source_record_sha256="$(sha256sum "$source_record" | cut -d' ' -f1)"
roles_sha256="$(sha256sum "$scratch/roles" | cut -d' ' -f1)"; memberships_sha256="$(sha256sum "$scratch/memberships" | cut -d' ' -f1)"; owners_sha256="$(sha256sum "$scratch/owners" | cut -d' ' -f1)"; grants_sha256="$(sha256sum "$scratch/grants" | cut -d' ' -f1)"; acl_sha256="$(sha256sum "$scratch/acl" | cut -d' ' -f1)"; rls_sha256="$(sha256sum "$scratch/rls" | cut -d' ' -f1)"
target_docker_before_sha256="$(sha256sum "$scratch/target-docker-before" | cut -d' ' -f1)"; target_mapping_sha256="$(sha256sum "$scratch/target-port-mapping" | cut -d' ' -f1)"; target_mapping_after_sha256="$(sha256sum "$scratch/target-port-mapping-after" | cut -d' ' -f1)"; target_connection_before_sha256="$(sha256sum "$scratch/connection-binding" | cut -d' ' -f1)"; target_docker_connection_before_sha256="$(sha256sum "$scratch/docker-connection-binding" | cut -d' ' -f1)"; target_docker_after_sha256="$(sha256sum "$scratch/target-docker-after" | cut -d' ' -f1)"; target_connection_after_sha256="$(sha256sum "$scratch/connection-binding-after" | cut -d' ' -f1)"; target_docker_connection_after_sha256="$(sha256sum "$scratch/docker-connection-binding-after" | cut -d' ' -f1)"
upload_checksum_scope=post_restore_tree; upload_source_equivalence=not_claimed_without_source_inventory
observations_tmp="$evidence/.rehearsal-observations.$$"
{ printf 'format_version=1\nobservation_status=complete\nrestore_command_status=verified\n'; printf 'checksum_command_status=verified\ndecryption_command_status=verified\n'; printf 'source_version_provenance=operator_recorded\nsource_version_record_sha256=%s\n' "$source_record_sha256"; printf 'source_postgres_major=%s\ntarget_postgres_major=%s\nclient_psql_major=%s\nclient_pg_restore_major=%s\nclient_pg_dump_major=%s\n' "$source_major" "$target_major" "$psql_major" "$restore_major" "$dump_major"; printf 'manifest_scope=%s\nmanifest_valorant_schema_included=true\npublic_table_count=%s\nvalorant_table_count=%s\npublic_object_count=%s\nvalorant_object_count=%s\nquest_migration_ledger_status=verified\nquest_migration_count=%s\nvalorant_migration_ledger_status=verified\nvalorant_migration_count=%s\n' "$archive_scope" "$public_tables" "$valorant_tables" "$public_objects" "$valorant_objects" "$quest_migrations" "$valorant_migrations"; printf 'roles_command_status=verified\nmemberships_command_status=verified\nowners_command_status=verified\ngrants_command_status=verified\ndefault_acl_command_status=verified\nrls_command_status=verified\nroles_observations_sha256=%s\nmemberships_observations_sha256=%s\nowners_observations_sha256=%s\ngrants_observations_sha256=%s\ndefault_acl_observations_sha256=%s\nrls_observations_sha256=%s\nsecurity_verify_status=verified\nsecurity_verify_output_sha256=%s\nextensions_inventory_sha256=%s\nsettings_inventory_sha256=%s\n' "$roles_sha256" "$memberships_sha256" "$owners_sha256" "$grants_sha256" "$acl_sha256" "$rls_sha256" "$security_output_sha256" "$extensions_sha256" "$settings_sha256"; printf 'public_upload_file_count=%s\npublic_upload_byte_count=%s\npublic_upload_checksum=%s\nprivate_upload_file_count=%s\nprivate_upload_byte_count=%s\nprivate_upload_checksum=%s\nupload_checksum_scope=%s\nupload_source_equivalence=%s\n' "$public_files" "$public_bytes" "$public_checksum" "$private_files" "$private_bytes" "$private_checksum" "$upload_checksum_scope" "$upload_source_equivalence"; printf 'quest_liveness_status=ok\nquest_readiness_status=ok\nquest_database_status=up\nvalorant_health_status=ok\nvalorant_database_status=up\nvalorant_ca_status=verified\nfreeze_mode=validation\nwriters_disabled=true\nmutation_rejection=verified\nno_writer_admission=verified\n'; for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do printf 'failure_injection_%s=passed\n' "$injection"; done; printf 'resource_cpu_seconds=%s\nresource_peak_memory_kb=%s\nresource_disk_bytes=%s\nrto_seconds=%s\nrto_decision=%s\n' "$cpu" "$memory" "$disk" "$rto" "$decision"; } > "$observations_tmp"
printf 'quest_migration_ledger_before_status=%s\nvalorant_migration_ledger_before_status=%s\nrpo_seconds=%s\nrpo_decision=%s\n' "$quest_migrations_before" "$valorant_migrations_before" "$rpo" "$rpo_decision" >> "$observations_tmp"
printf 'target_kind=%s\ntarget_id=%s\ntarget_container_id=%s\ntarget_sentinel_sha256=%s\ntarget_container_disk_bytes_before=%s\ntarget_container_disk_bytes_after=%s\ntarget_database_size_bytes=%s\n' "${sentinel_cfg[target_kind]}" "${sentinel_cfg[target_id]}" "${sentinel_cfg[container_id]}" "$sentinel_sha256" "$container_disk_bytes" "$container_disk_bytes_after" "$database_size_bytes" >> "$observations_tmp"
printf 'target_host=%s\ntarget_port=%s\ntarget_database_name=%s\ntarget_nonce_sha256=%s\ntarget_nonce_after_sha256=%s\nbootstrap_sql_sha256=%s\nextensions_before_status=verified\nextensions_before_count=%s\nextensions_before_inventory_sha256=%s\nsettings_before_status=verified\nsettings_before_inventory_sha256=%s\nquest_read_probe_status=verified\nquest_read_probe_count=%s\nquest_read_probe_session_user=%s\nquest_read_probe_current_user=%s\n' "$url_host" "$url_port" "$target_database" "$nonce_sha256" "$nonce_after_sha256" "$bootstrap_sql_sha256" "$extensions_before_count" "$extensions_before_sha256" "$settings_before_sha256" "$quest_read_probe_count" "$quest_read_probe_session_user" "$quest_read_probe_current_user" >> "$observations_tmp"
printf 'target_docker_before_sha256=%s\ntarget_mapping_sha256=%s\ntarget_mapping_after_sha256=%s\ntarget_connection_before_sha256=%s\ntarget_docker_connection_before_sha256=%s\ntarget_docker_after_sha256=%s\ntarget_connection_after_sha256=%s\ntarget_docker_connection_after_sha256=%s\n' "$target_docker_before_sha256" "$target_mapping_sha256" "$target_mapping_after_sha256" "$target_connection_before_sha256" "$target_docker_connection_before_sha256" "$target_docker_after_sha256" "$target_connection_after_sha256" "$target_docker_connection_after_sha256" >> "$observations_tmp"
chmod 600 "$observations_tmp"; observations_sha256="$(sha256sum "$observations_tmp" | cut -d' ' -f1)"; mv -f -- "$observations_tmp" "$evidence/rehearsal-observations.env"
{ printf 'format_version=1\nevidence_status=complete\nrehearsal_mode=disposable\nrestore_status=verified\n'; printf 'created_at_utc=%s\nrestore_start_utc=%s\nrestore_end_utc=%s\nrestore_duration_seconds=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$start_utc" "$end_utc" "$duration"; printf 'archive_name=%s\narchive_sha256=%s\nobservations_sha256=%s\nchecksum_status=verified\ndecryption_status=verified\nmanifest_database_scope=%s\nmanifest_valorant_schema_included=true\n' "$(basename "$archive")" "$(cut -d' ' -f1 < "$checksum")" "$observations_sha256" "$archive_scope"; printf 'source_postgres_major=%s\ntarget_postgres_major=%s\nsource_major_gate=%s\nsource_version_provenance=operator_recorded\nsource_version_record_sha256=%s\nclient_psql_major=%s\nclient_pg_restore_major=%s\nclient_pg_dump_major=%s\n' "$source_major" "$target_major" "$gate" "$source_record_sha256" "$psql_major" "$restore_major" "$dump_major"; printf 'public_table_count=%s\nvalorant_table_count=%s\npublic_object_count=%s\nvalorant_object_count=%s\nquest_migration_ledger_status=verified\nquest_migration_count=%s\nvalorant_migration_ledger_status=verified\nvalorant_migration_count=%s\n' "$public_tables" "$valorant_tables" "$public_objects" "$valorant_objects" "$quest_migrations" "$valorant_migrations"; printf 'roles_status=verified\nowners_status=verified\ngrants_status=verified\ndefault_acl_status=verified\nmemberships_status=verified\nroles_observations_sha256=%s\nmemberships_observations_sha256=%s\nowners_observations_sha256=%s\ngrants_observations_sha256=%s\ndefault_acl_observations_sha256=%s\nrls_observations_sha256=%s\nsecurity_verify_status=verified\nsecurity_verify_output_sha256=%s\nextensions_status=verified\nextensions_count=%s\nextensions_inventory_sha256=%s\nsettings_status=verified\nsettings_inventory_sha256=%s\nrls_status=verified\nrls_enabled_table_count=%s\nrls_table_count=%s\n' "$roles_sha256" "$memberships_sha256" "$owners_sha256" "$grants_sha256" "$acl_sha256" "$rls_sha256" "$security_output_sha256" "$extensions_count" "$extensions_sha256" "$settings_sha256" "$rls_enabled" "$rls_tables"; printf 'public_upload_file_count=%s\npublic_upload_byte_count=%s\npublic_upload_checksum=%s\nprivate_upload_file_count=%s\nprivate_upload_byte_count=%s\nprivate_upload_checksum=%s\nupload_checksum_scope=%s\nupload_source_equivalence=%s\n' "$public_files" "$public_bytes" "$public_checksum" "$private_files" "$private_bytes" "$private_checksum" "$upload_checksum_scope" "$upload_source_equivalence"; printf 'quest_liveness_status=ok\nquest_readiness_status=ok\nquest_database_status=up\nvalorant_health_status=ok\nvalorant_database_status=up\nvalorant_ca_status=verified\nfreeze_mode=validation\nwriters_disabled=true\nmutation_rejection=verified\nno_writer_admission=verified\n'; for injection in bad_checksum bad_decryption wrong_ca blocked_network failed_service_health attempted_mutation_callback; do printf 'failure_injection_%s=passed\n' "$injection"; done; printf 'resource_cpu_seconds=%s\nresource_peak_memory_kb=%s\nresource_disk_bytes=%s\nrto_seconds=%s\nrto_decision=%s\n' "$cpu" "$memory" "$disk" "$rto" "$decision"; } > "$tmp"
printf 'quest_migration_ledger_before_status=%s\nvalorant_migration_ledger_before_status=%s\nrpo_seconds=%s\nrpo_decision=%s\n' "$quest_migrations_before" "$valorant_migrations_before" "$rpo" "$rpo_decision" >> "$tmp"
printf 'target_kind=%s\ntarget_id=%s\ntarget_container_id=%s\ntarget_sentinel_sha256=%s\ntarget_container_disk_bytes_before=%s\ntarget_container_disk_bytes_after=%s\ntarget_database_size_bytes=%s\n' "${sentinel_cfg[target_kind]}" "${sentinel_cfg[target_id]}" "${sentinel_cfg[container_id]}" "$sentinel_sha256" "$container_disk_bytes" "$container_disk_bytes_after" "$database_size_bytes" >> "$tmp"
printf 'target_host=%s\ntarget_port=%s\ntarget_database_name=%s\ntarget_nonce_sha256=%s\ntarget_nonce_after_sha256=%s\nbootstrap_sql_sha256=%s\nextensions_before_status=verified\nextensions_before_count=%s\nextensions_before_inventory_sha256=%s\nsettings_before_status=verified\nsettings_before_inventory_sha256=%s\nquest_read_probe_status=verified\nquest_read_probe_count=%s\nquest_read_probe_session_user=%s\nquest_read_probe_current_user=%s\n' "$url_host" "$url_port" "$target_database" "$nonce_sha256" "$nonce_after_sha256" "$bootstrap_sql_sha256" "$extensions_before_count" "$extensions_before_sha256" "$settings_before_sha256" "$quest_read_probe_count" "$quest_read_probe_session_user" "$quest_read_probe_current_user" >> "$tmp"
printf 'target_docker_before_sha256=%s\ntarget_mapping_sha256=%s\ntarget_mapping_after_sha256=%s\ntarget_connection_before_sha256=%s\ntarget_docker_connection_before_sha256=%s\ntarget_docker_after_sha256=%s\ntarget_connection_after_sha256=%s\ntarget_docker_connection_after_sha256=%s\n' "$target_docker_before_sha256" "$target_mapping_sha256" "$target_mapping_after_sha256" "$target_connection_before_sha256" "$target_docker_connection_before_sha256" "$target_docker_after_sha256" "$target_connection_after_sha256" "$target_docker_connection_after_sha256" >> "$tmp"
chmod 600 "$tmp"; mv -f -- "$tmp" "$evidence/rehearsal-evidence.env"
manifest="$evidence/rehearsal-evidence.manifest"; signature="$evidence/rehearsal-evidence.sig"
artifact_list=(rehearsal-evidence.env rehearsal-observations.env rehearsal-source-version.env rehearsal-security-verifier.output rehearsal-target-sentinel.env rehearsal-failure-injections.tsv rehearsal-failure-bad_checksum.output rehearsal-failure-bad_decryption.output rehearsal-failure-wrong_ca.output rehearsal-failure-blocked_network.output rehearsal-failure-failed_service_health.output rehearsal-failure-attempted_mutation_callback.output rehearsal-roles.tsv rehearsal-memberships.tsv rehearsal-owners.tsv rehearsal-grants.tsv rehearsal-acl.tsv rehearsal-ext-before.tsv rehearsal-ext.tsv rehearsal-settings-before.tsv rehearsal-settings.tsv rehearsal-rls.tsv rehearsal-quest-migrations-before.tsv rehearsal-valorant-migrations-before.tsv rehearsal-quest-migrations.tsv rehearsal-valorant-migrations.tsv rehearsal-target-docker-before.txt rehearsal-target-port-mapping.txt rehearsal-target-port-mapping-after.txt rehearsal-connection-binding.txt rehearsal-docker-connection-binding.txt rehearsal-target-docker-after.txt rehearsal-connection-binding-after.txt rehearsal-docker-connection-binding-after.txt rehearsal-quest-read-probe.tsv)
(cd -- "$evidence" && for artifact in "${artifact_list[@]}"; do [[ -f "$artifact" && ! -L "$artifact" ]] || exit 1; sha256sum -- "$artifact"; done) > "$manifest" || fail "evidence manifest creation failed"
chmod 600 "$manifest"; openssl dgst -sha256 -sign "$signing_key" -out "$signature" "$manifest" >/dev/null 2>&1 || fail "evidence bundle signature failed"; chmod 600 "$signature"
echo "Restore rehearsal completed; evidence written to the supplied disposable evidence directory."
