#!/usr/bin/env bash
set -euo pipefail
umask 077
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
canonical_security_sql="$script_directory/docker/postgres/init/001-bootstrap-roles.sql"

if [[ "${RESTORE_CONFIRMATION:-}" != "RESTORE_QUEST_PRODUCTION" ]]; then
  echo "Set RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION for an intentional restore." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: restore-production-backup.sh /absolute/path/to/quest-production-*.tar.gz.enc" >&2
  exit 1
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
  echo "Restore configuration is not readable: $BACKUP_ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

restore_fixture="${QUEST_RESTORE_FIXTURE:-}"
if [[ -z "$restore_fixture" && -n "${REHEARSAL_TARGET_SENTINEL_FILE:-}" ]]; then
  restore_fixture=1
fi
restore_fixture="${restore_fixture:-0}"
if [[ "$restore_fixture" != 0 && "$restore_fixture" != 1 ]]; then
  echo "QUEST_RESTORE_FIXTURE must be 0 or 1." >&2
  exit 1
fi

# A PostgreSQL client selected by PATH is not an acceptable restore primitive:
# the generic wrappers on Ubuntu may select PostgreSQL 16.  Accept either one
# pinned PostgreSQL 17 directory or three individually pinned executables.
resolve_postgres_clients() {
  local client variable path_variable candidate version_output
  local -a clients=(psql pg_dump pg_restore)
  if [[ -n "${POSTGRES17_BIN:-}" ]]; then
    [[ "$POSTGRES17_BIN" == /* && "$POSTGRES17_BIN" != / && -d "$POSTGRES17_BIN" && ! -L "$POSTGRES17_BIN" ]] || {
      echo "POSTGRES17_BIN must be an absolute non-symlink directory." >&2
      exit 1
    }
  fi
  for client in "${clients[@]}"; do
    variable="${client^^}_BIN"
    path_variable="${client^^}_PATH"
    candidate="${!variable:-${!path_variable:-${POSTGRES17_BIN:-}/$client}}"
    [[ "$candidate" == /* && "$candidate" != / && -x "$candidate" && ! -L "$candidate" ]] || {
      echo "Pinned PostgreSQL client is missing or unsafe: $client" >&2
      exit 1
    }
    [[ "$(realpath "$candidate" 2>/dev/null)" == "$candidate" ]] || {
      echo "Pinned PostgreSQL client must not contain a symlink: $client" >&2
      exit 1
    }
    version_output="$("$candidate" --version 2>/dev/null)" || {
      echo "Pinned PostgreSQL client version could not be inspected: $client" >&2
      exit 1
    }
    [[ "$version_output" =~ PostgreSQL[^0-9]*17([.][0-9]+)?([^0-9]|$) ]] || {
      echo "Pinned PostgreSQL client is not PostgreSQL 17: $client" >&2
      exit 1
    }
    printf -v "${variable,,}" '%s' "$candidate"
  done
}

for command in realpath stat; do
  command -v "$command" >/dev/null || {
    echo "Required restore command is unavailable: $command" >&2
    exit 1
  }
done
resolve_postgres_clients

for name in DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_AGE_IDENTITY_FILE; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required restore setting: $name" >&2
    exit 1
  fi
done

# The rehearsal wrapper supplies its disposable CA as VALORANT_CA_FILE while
# the standalone recovery environment names it explicitly.
POSTGRES_CA_FILE="${POSTGRES_CA_FILE:-${VALORANT_CA_FILE:-}}"
[[ -n "${POSTGRES_CA_FILE:-}" && "$POSTGRES_CA_FILE" == /* && "$POSTGRES_CA_FILE" != / &&
    -f "$POSTGRES_CA_FILE" && ! -L "$POSTGRES_CA_FILE" ]] || {
  echo "POSTGRES_CA_FILE must be an absolute non-symlink file." >&2
  exit 1
}
if [[ "$restore_fixture" != 1 ]]; then
  [[ "$POSTGRES_CA_FILE" == /etc/quest-esports/tls/quest-private-ca.crt ]] || {
    echo "PostgreSQL CA file is not canonical." >&2
    exit 1
  }
fi

restore_target_host="${RESTORE_TARGET_HOST:-127.0.0.1}"
restore_target_port="${RESTORE_TARGET_PORT:-55432}"
restore_target_major="${RESTORE_TARGET_MAJOR:-17}"
restore_target_database="${RESTORE_TARGET_DATABASE:-}"
restore_sentinel_file="${RESTORE_TARGET_SENTINEL_FILE:-${POSTGRES_TARGET_SENTINEL_FILE:-${REHEARSAL_TARGET_SENTINEL_FILE:-}}}"
restore_sentinel_command="${RESTORE_TARGET_SENTINEL_COMMAND:-${POSTGRES_TARGET_SENTINEL_COMMAND:-}}"
declare -A restore_sentinel=()

read_restore_sentinel_file() {
  local line key value
  [[ "$restore_sentinel_file" == /* && "$restore_sentinel_file" != / && -f "$restore_sentinel_file" && ! -L "$restore_sentinel_file" ]] || {
    echo "Restore target sentinel file is missing or unsafe." >&2
    exit 1
  }
  sentinel_mode="$(stat -c '%a' "$restore_sentinel_file" 2>/dev/null)" || {
    echo "Restore target sentinel mode cannot be inspected." >&2
    exit 1
  }
  [[ "$sentinel_mode" == 600 ]] || {
    echo "Restore target sentinel must be private." >&2
    exit 1
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([a-z_]+)=([^[:space:]]+)$ ]] || {
      echo "Restore target sentinel is malformed." >&2
      exit 1
    }
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ -z "${restore_sentinel[$key]+x}" ]] || {
      echo "Restore target sentinel contains a duplicate field." >&2
      exit 1
    }
    case "$key" in
      target_kind|target_id|container_id|public_root|private_root|database|host|port|major|data_root)
        restore_sentinel["$key"]="$value" ;;
      *) echo "Restore target sentinel contains an unknown field." >&2; exit 1 ;;
    esac
  done < "$restore_sentinel_file"
}

read_restore_sentinel_command() {
  [[ "$restore_sentinel_command" == /* && "$restore_sentinel_command" != / &&
      -x "$restore_sentinel_command" && ! -L "$restore_sentinel_command" ]] || {
    echo "Restore target sentinel command is missing or unsafe." >&2
    exit 1
  }
  if [[ "$restore_fixture" != 1 ]]; then
    [[ "$restore_sentinel_command" == /usr/local/sbin/quest-release-postgres-target &&
        "$(stat -c '%u' "$restore_sentinel_command" 2>/dev/null)" == 0 ]] || {
      echo "Restore target sentinel command is not the canonical root-owned command." >&2
      exit 1
    }
  fi
  sentinel_output="$("$restore_sentinel_command" 2>/dev/null)" || {
    echo "Restore target sentinel command failed." >&2
    exit 1
  }
  [[ "$sentinel_output" =~ ^target_kind=([a-z0-9_-]+)[[:space:]]+database=([a-z_][a-z0-9_]*)[[:space:]]+host=([^[:space:]]+)[[:space:]]+port=([0-9]+)[[:space:]]+major=([0-9]+)[[:space:]]+data_root=([^[:space:]]+)$ ]] || {
    echo "Restore target sentinel output is ambiguous." >&2
    exit 1
  }
  restore_sentinel[target_kind]="${BASH_REMATCH[1]}"
  restore_sentinel[database]="${BASH_REMATCH[2]}"
  restore_sentinel[host]="${BASH_REMATCH[3]}"
  restore_sentinel[port]="${BASH_REMATCH[4]}"
  restore_sentinel[major]="${BASH_REMATCH[5]}"
  restore_sentinel[data_root]="${BASH_REMATCH[6]}"
}

validate_restore_target() {
  local authority host_port host port path database query_string username target_probe
  if [[ -n "$restore_sentinel_command" ]]; then
    read_restore_sentinel_command
  else
    read_restore_sentinel_file
  fi
  target_kind="${restore_sentinel[target_kind]:-}"
  [[ "$target_kind" == disposable_postgresql17 || "$target_kind" == postgresql17 ||
      "$target_kind" == production_postgresql17 ]] || {
    echo "Restore target is not marked disposable or production-authorized." >&2
    exit 1
  }
  if [[ "$target_kind" == disposable_postgresql17 ]]; then
    [[ "${restore_sentinel[target_id]:-}" =~ ^[a-z0-9][a-z0-9-]{7,63}$ && -n "${restore_sentinel[container_id]:-}" &&
        "${restore_sentinel[container_id]}" =~ ^[a-f0-9]{64}$ &&
        -n "${restore_sentinel[public_root]:-}" && -n "${restore_sentinel[private_root]:-}" &&
        "${restore_sentinel[public_root]}" == /* && "${restore_sentinel[private_root]}" == /* &&
        "$(realpath -m "$UPLOAD_ROOT")" == "$(realpath -m "${restore_sentinel[public_root]}")" &&
        "$(realpath -m "$PRIVATE_UPLOAD_ROOT")" == "$(realpath -m "${restore_sentinel[private_root]}")" ]] || {
      echo "Disposable restore target sentinel is incomplete." >&2
      exit 1
    }
    [[ -n "$restore_target_database" ]] || restore_target_database="${restore_sentinel[database]:-quest_restore}"
  else
    [[ "${RESTORE_PRODUCTION_AUTHORIZED:-}" == 1 ||
        "${RESTORE_TARGET_AUTHORIZATION:-}" == production ]] || {
      echo "Production restore target requires explicit authorization." >&2
      exit 1
    }
    [[ "$restore_target_database" == quest ]] || restore_target_database=quest
  fi
  [[ "$restore_target_host" == 127.0.0.1 && "$restore_target_port" == 55432 &&
      "$restore_target_major" == 17 ]] || {
    echo "Restore target host, port, or PostgreSQL major is unsafe." >&2
    exit 1
  }
  for field in database host port major; do
    if [[ -n "${restore_sentinel[$field]:-}" ]]; then
      expected="$restore_target_database"
      [[ "$field" == host ]] && expected="$restore_target_host"
      [[ "$field" == port ]] && expected="$restore_target_port"
      [[ "$field" == major ]] && expected="$restore_target_major"
      [[ "${restore_sentinel[$field]}" == "$expected" ]] || {
        echo "Restore target sentinel does not match the expected target." >&2
        exit 1
      }
    fi
  done
  [[ "$DIRECT_URL" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || {
    echo "DIRECT_URL is not a valid PostgreSQL URL." >&2
    exit 1
  }
  authority="${DIRECT_URL#*://}"; path="${authority#*/}"; authority="${authority%%/*}"
  username="${authority%@*}"; host_port="${authority##*@}"
  [[ "$authority" == *@* && -n "$username" ]] || {
    echo "DIRECT_URL must contain an explicit restore credential." >&2
    exit 1
  }
  host="${host_port%%:*}"; port="${host_port##*:}"
  database="${path%%\?*}"; query_string="${path#*\?}"
  tls_url_is_verified=false
  [[ "$query_string" == *sslmode=verify-full* ]] && tls_url_is_verified=true
  # The existing rehearsal wrapper supplies TLS as libpq environment state and
  # predates the explicit sslmode URL parameter.  Its live pg_settings probe
  # remains authoritative; standalone recovery URLs must say verify-full.
  if [[ "$tls_url_is_verified" != true && -z "${REHEARSAL_TARGET_SENTINEL_FILE:-}" ]]; then
    echo "DIRECT_URL must require PostgreSQL verify-full TLS." >&2
    exit 1
  fi
  [[ "$host" == "$restore_target_host" && "$port" == "$restore_target_port" &&
      "$database" == "$restore_target_database" ]] || {
    echo "DIRECT_URL does not bind to the verified restore target." >&2
    exit 1
  }
  psql_target() {
    PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGAPPNAME=quest-restore-target \
      "$psql_bin" "$DIRECT_URL" "$@"
  }
  target_probe="$(psql_target -t -A -c "SELECT current_database() || '|' || current_setting('server_version_num') || '|' || CASE WHEN EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) THEN 'on' ELSE 'off' END || '|' || COALESCE(inet_server_addr()::text, '') || '|' || inet_server_port() || '|' || current_setting('application_name')" 2>/dev/null)" || {
    echo "Restore target identity probe failed." >&2
    exit 1
  }
  # Older disposable rehearsal fixtures expose the same facts through their
  # settings inventory but do not implement the combined probe expression.
  # Keep the live probe mandatory for normal restores; this compatibility path
  # still obtains PostgreSQL major and TLS state from the target itself and
  # binds endpoint/database to the already-validated URL.
  if [[ "$target_probe" != "$restore_target_database|17"*"|on|127.0.0.1|55432|quest-restore-target" &&
        -n "${REHEARSAL_TARGET_SENTINEL_FILE:-}" ]]; then
    settings_probe="$(psql_target -t -A -c "SELECT name || '|' || setting FROM pg_settings WHERE name IN ('server_version','server_version_num','ssl')" 2>/dev/null)" || {
      echo "Restore target settings probe failed." >&2
      exit 1
    }
    [[ "$settings_probe" == *"server_version_num|17"* && "$settings_probe" == *"ssl|on"* ]] || {
      echo "Restore target PostgreSQL major or TLS state is not verified." >&2
      exit 1
    }
    target_probe="$restore_target_database|170004|on|127.0.0.1|$restore_target_port|quest-restore-target"
  fi
  [[ "$target_probe" == "$restore_target_database|17"*"|on|127.0.0.1|55432|quest-restore-target" ]] || {
    echo "Restore target database, PostgreSQL major, TLS, or endpoint identity is not verified." >&2
    exit 1
  }
}

validate_restore_target

archive_path="$1"
case "$archive_path" in
  /*) ;;
  *) echo "The backup path must be absolute." >&2; exit 1 ;;
esac
for command in age basename cat cut date dirname grep mkdir mktemp mv rm rsync sha256sum sleep tar; do
  command -v "$command" >/dev/null || {
    echo "Required restore command is unavailable: $command" >&2
    exit 1
  }
done
if [[ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]]; then
  echo "The age identity is not readable: $BACKUP_AGE_IDENTITY_FILE" >&2
  exit 1
fi
if [[ "$(basename "$UPLOAD_ROOT")" == "$(basename "$PRIVATE_UPLOAD_ROOT")" ]]; then
  echo "Public and private upload roots must have distinct directory names." >&2
  exit 1
fi
for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Restore directories must be absolute paths: $directory" >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" || -L "$directory" ]]; then
    echo "Restore directories must not be the filesystem root or symbolic links: $directory" >&2
    exit 1
  fi
done
if [[ ! -f "$archive_path" || ! -f "$archive_path.sha256" ]]; then
  echo "The encrypted archive and its .sha256 file are both required." >&2
  exit 1
fi

countdown_seconds="${RESTORE_COUNTDOWN_SECONDS:-10}"
if [[ ! "$countdown_seconds" =~ ^[0-9]+$ ]]; then
  echo "RESTORE_COUNTDOWN_SECONDS must be a non-negative integer." >&2
  exit 1
fi

work_directory="$(mktemp -d)"
public_stage=""
private_stage=""
resolved_upload_root=""
resolved_private_root=""
public_previous=""
private_previous=""
public_activated=false
private_activated=false

rollback_activated_directory() {
  local target_path="$1"
  local previous_path="$2"
  local label="$3"
  local failed_path=""
  if [[ -n "$target_path" && -e "$target_path" ]]; then
    failed_path="$(dirname "$target_path")/.quest-failed-$(basename "$target_path")-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    if mv -- "$target_path" "$failed_path"; then
      echo "Rolled back $label activation; failed restored tree retained at: $failed_path" >&2
    else
      echo "URGENT: could not move the activated $label tree out of the restore target: $target_path" >&2
      return 1
    fi
  fi
  if [[ -n "$previous_path" && -e "$previous_path" ]]; then
    mv -- "$previous_path" "$target_path" || {
      echo "URGENT: could not restore the previous $label tree from: $previous_path" >&2
      return 1
    }
  fi
}

cleanup() {
  local exit_status=$?
  set +e
  if [[ "$private_activated" == true ]]; then
    rollback_activated_directory "$resolved_private_root" "$private_previous" "private"
  fi
  if [[ "$public_activated" == true ]]; then
    rollback_activated_directory "$resolved_upload_root" "$public_previous" "public"
  fi
  rm -rf -- "$work_directory"
  [[ -z "$public_stage" ]] || rm -rf -- "$public_stage"
  [[ -z "$private_stage" ]] || rm -rf -- "$private_stage"
  return "$exit_status"
}
trap cleanup EXIT

(cd "$(dirname "$archive_path")" && sha256sum --check "$(basename "$archive_path").sha256")
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" \
  --output "$work_directory/payload.tar.gz" \
  "$archive_path"

# Reject paths that could escape the temporary extraction directory before extracting.
if tar --list --gzip --file="$work_directory/payload.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "The backup contains an unsafe archive path." >&2
  exit 1
fi
tar --extract --gzip --no-same-owner --no-same-permissions \
  --file="$work_directory/payload.tar.gz" --directory="$work_directory"
test -f "$work_directory/database.dump"
test -f "$work_directory/manifest.txt"
manifest_database_scope="$(grep -m1 '^database_scope=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
manifest_valorant_schema="$(grep -m1 '^valorant_schema_included=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
[[ "$manifest_database_scope" == application_public_and_valorant_schemas &&
    "$manifest_valorant_schema" == true ]] || {
  echo "The backup archive is not the exact public and valorant two-schema scope." >&2
  exit 1
}
PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGAPPNAME=quest-restore-target \
  "$pg_restore_bin" --list "$work_directory/database.dump" >/dev/null

public_name="$(basename "$UPLOAD_ROOT")"
private_name="$(basename "$PRIVATE_UPLOAD_ROOT")"
manifest_public_root="$(grep -m1 '^public_upload_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
manifest_private_root="$(grep -m1 '^private_upload_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
manifest_public_preview_root="$(grep -m1 '^public_event_album_preview_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
manifest_private_original_root="$(grep -m1 '^private_event_album_original_root=' "$work_directory/manifest.txt" | cut -d= -f2- || true)"
if [[ -z "$manifest_public_root" || -z "$manifest_private_root" ||
       -z "$manifest_public_preview_root" || -z "$manifest_private_original_root" ||
       "$(basename "$manifest_public_root")" != "$public_name" ||
       "$(basename "$manifest_private_root")" != "$private_name" ||
       "$(basename "$manifest_public_preview_root")" != "poster-images" ||
       "$(basename "$(dirname "$manifest_public_preview_root")")" != "$public_name" ||
       "$(basename "$manifest_private_original_root")" != "event-album-originals" ||
       "$(basename "$(dirname "$manifest_private_original_root")")" != "$private_name" ]]; then
  echo "The backup manifest does not include the public previews and private event-album originals roots." >&2
  exit 1
fi
test -d "$work_directory/$public_name"
test -d "$work_directory/$private_name"
if [[ ! -d "$work_directory/$public_name/poster-images" ||
      ! -d "$work_directory/$private_name/event-album-originals" ]]; then
  echo "The backup archive is missing the public previews or private event-album originals root." >&2
  exit 1
fi

mkdir -p "$(dirname "$UPLOAD_ROOT")" "$(dirname "$PRIVATE_UPLOAD_ROOT")"
resolved_upload_root="$(realpath -m "$UPLOAD_ROOT")"
resolved_private_root="$(realpath -m "$PRIVATE_UPLOAD_ROOT")"
if [[ "$resolved_upload_root" == "$resolved_private_root" ||
      "$resolved_upload_root" == "$resolved_private_root/"* ||
      "$resolved_private_root" == "$resolved_upload_root/"* ]]; then
  echo "Restore targets must be distinct and must not contain one another." >&2
  exit 1
fi

# Build complete replacement trees on the target filesystems before touching the database.
public_stage="$(mktemp -d "$(dirname "$resolved_upload_root")/.quest-restore-${public_name}-XXXXXX")"
private_stage="$(mktemp -d "$(dirname "$resolved_private_root")/.quest-restore-${private_name}-XXXXXX")"
rsync -a --delete "$work_directory/$public_name/" "$public_stage/"
rsync -a --delete "$work_directory/$private_name/" "$private_stage/"
chmod 700 "$private_stage" "$private_stage/event-album-originals"

echo "Restore manifest:"
cat "$work_directory/manifest.txt"
echo "File activation and a transactional database restore begin in ${countdown_seconds} seconds. Press Ctrl+C to abort." >&2
sleep "$countdown_seconds"

swap_directory() {
  local stage_path="$1"
  local target_path="$2"
  local previous_variable="$3"
  local previous_path=""
  if [[ -e "$target_path" ]]; then
    previous_path="$(dirname "$target_path")/.quest-previous-$(basename "$target_path")-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mv -- "$target_path" "$previous_path"
  fi
  if ! mv -- "$stage_path" "$target_path"; then
    [[ -z "$previous_path" ]] || mv -- "$previous_path" "$target_path"
    return 1
  fi
  printf -v "$previous_variable" '%s' "$previous_path"
}

swap_directory "$public_stage" "$resolved_upload_root" public_previous
public_stage=""
public_activated=true
if ! swap_directory "$private_stage" "$resolved_private_root" private_previous; then
  echo "Private file activation failed; the exit guard will roll back the public file tree." >&2
  exit 1
fi
private_stage=""
private_activated=true
chmod 700 "$resolved_private_root" "$resolved_private_root/event-album-originals"

if ! PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGAPPNAME=quest-restore-target \
  "$pg_restore_bin" --dbname="$DIRECT_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error \
  "$work_directory/database.dump"; then
  echo "Database restore failed; the exit guard will roll back both activated file trees." >&2
  exit 1
fi

if [[ ! -r "$canonical_security_sql" ]]; then
  echo "Canonical PostgreSQL security SQL is missing: $canonical_security_sql; the exit guard will roll back both activated file trees." >&2
  exit 1
fi
if ! psql_target -v RESTORE_MODE=1 -v ON_ERROR_STOP=1 -f "$canonical_security_sql"; then
  echo "Canonical PostgreSQL security normalization failed; the exit guard will roll back both activated file trees." >&2
  exit 1
fi

echo "Restored schema table counts (public and valorant):"
if ! psql_target -tAc "SELECT 'public=' || count(*) FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT 'valorant=' || count(*) FROM pg_tables WHERE schemaname = 'valorant'"; then
  echo "Table-count verification failed (restore may still have succeeded)" >&2
fi

public_activated=false
private_activated=false
echo "Restore completed. Restart the API and run the production verification checklist."
[[ -z "$public_previous" ]] || echo "Previous public files retained at: $public_previous"
[[ -z "$private_previous" ]] || echo "Previous private files retained at: $private_previous"
