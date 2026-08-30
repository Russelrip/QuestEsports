#!/usr/bin/env bash
set -euo pipefail
umask 077
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
canonical_security_sql="$script_directory/docker/postgres/init/001-bootstrap-roles.sql"

if [[ "${RESTORE_CONFIRMATION:-}" != "RESTORE_QUEST_PRODUCTION" ]]; then
  echo "Set RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION for an intentional restore." >&2
  exit 1
fi
restore_test_fixture=false
if [[ $# -eq 2 && "$1" == --test-fixture ]]; then
  restore_test_fixture=true
  shift
elif [[ $# -ne 1 ]]; then
  echo "Usage: restore-production-backup.sh [--test-fixture] /absolute/path/to/quest-production-*.tar.gz.enc" >&2
  exit 1
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
config_file="$BACKUP_ENV_FILE"
if [[ "$restore_test_fixture" == true && "$config_file" == /etc/quest-esports-backup.env ]]; then
  echo "Fixture mode is unavailable with the protected production configuration." >&2
  exit 1
fi
readonly config_file restore_test_fixture
if [[ ! -r "$config_file" ]]; then
  echo "Restore configuration is not readable." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$config_file"
set +a

if [[ "$restore_test_fixture" == false ]]; then
  [[ "$(stat -c '%u %a' "$config_file" 2>/dev/null)" =~ ^0\ (600|640)$ ]] || {
    echo "Restore configuration is not private." >&2
    exit 1
  }
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

for name in UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_AGE_IDENTITY_FILE; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required restore setting: $name" >&2
    exit 1
  fi
done

# Production restores and disposable rehearsals use the same dedicated recovery
# administrator credential. The runtime DIRECT_URL is never a restore input.
if [[ "$restore_test_fixture" == false ]]; then
  [[ -n "${RECOVERY_ADMIN_URL:-}" ]] || {
    echo "RECOVERY_ADMIN_URL is required for a production restore." >&2
    exit 1
  }
  [[ -z "${DIRECT_URL:-}" ]] || {
    echo "DIRECT_URL is not permitted in the production restore configuration; use RECOVERY_ADMIN_URL." >&2
    exit 1
  }
  restore_url="$RECOVERY_ADMIN_URL"
else
  restore_url="${RECOVERY_ADMIN_URL:-}"
fi
[[ -n "$restore_url" ]] || {
  echo "A restore administrator URL is required." >&2
  exit 1
}

# The rehearsal wrapper supplies its disposable CA as VALORANT_CA_FILE while
# the standalone recovery environment names it explicitly.
POSTGRES_CA_FILE="${POSTGRES_CA_FILE:-${VALORANT_CA_FILE:-}}"
[[ -n "${POSTGRES_CA_FILE:-}" && "$POSTGRES_CA_FILE" == /* && "$POSTGRES_CA_FILE" != / &&
    -f "$POSTGRES_CA_FILE" && ! -L "$POSTGRES_CA_FILE" ]] || {
  echo "POSTGRES_CA_FILE must be an absolute non-symlink file." >&2
  exit 1
}
if [[ "$restore_test_fixture" == true ]]; then
  recovery_client_cert_file="${RECOVERY_CLIENT_CERT_FILE:-${POSTGRES_CERT_FILE:-}}"
  recovery_client_key_file="${RECOVERY_CLIENT_KEY_FILE:-${POSTGRES_KEY_FILE:-}}"
else
  recovery_client_cert_file="${RECOVERY_CLIENT_CERT_FILE:-}"
  recovery_client_key_file="${RECOVERY_CLIENT_KEY_FILE:-}"
  [[ -n "$recovery_client_cert_file" && -n "$recovery_client_key_file" ]] || {
    echo "RECOVERY_CLIENT_CERT_FILE and RECOVERY_CLIENT_KEY_FILE are required for production restore." >&2
    exit 1
  }
fi
for tls_file in "$POSTGRES_CA_FILE" "$recovery_client_cert_file" "$recovery_client_key_file"; do
  [[ -z "$tls_file" ]] && continue
  tls_mode="$(stat -c '%a' "$tls_file" 2>/dev/null)" || {
    echo "PostgreSQL TLS material mode cannot be inspected." >&2
    exit 1
  }
  [[ "$tls_mode" =~ ^[0-7]{3,4}$ ]] || {
    echo "PostgreSQL TLS material mode is invalid." >&2
    exit 1
  }
  (( (8#$tls_mode & 022) == 0 )) || {
    echo "PostgreSQL TLS material must not be group/other-writable." >&2
    exit 1
  }
  [[ "$tls_mode" == 600 || "$tls_file" == "$POSTGRES_CA_FILE" ]] || {
    echo "Recovery client TLS material must be mode 0600." >&2
    exit 1
  }
done
if [[ "$restore_test_fixture" == false ]]; then
  [[ "$POSTGRES_CA_FILE" == /etc/quest-esports/tls/quest-private-ca.crt ]] || {
    echo "PostgreSQL CA file is not canonical." >&2
    exit 1
  }
  [[ "$recovery_client_cert_file" == /etc/quest-esports/secrets/recovery-client.crt &&
     "$recovery_client_key_file" == /etc/quest-esports/secrets/recovery-client.key &&
     -f "$recovery_client_cert_file" && -f "$recovery_client_key_file" &&
     ! -L "$recovery_client_cert_file" && ! -L "$recovery_client_key_file" &&
     "$(stat -c '%u %a' "$recovery_client_cert_file" 2>/dev/null)" == '0 600' &&
     "$(stat -c '%u %a' "$recovery_client_key_file" 2>/dev/null)" == '0 600' &&
     "$(stat -c '%u' "$POSTGRES_CA_FILE" 2>/dev/null)" == 0 &&
     "$(stat -c '%u' "$recovery_client_cert_file" 2>/dev/null)" == 0 ]] || {
    echo "PostgreSQL TLS certificate or key is not canonical and private." >&2
    exit 1
  }
fi

restore_target_host="${RESTORE_TARGET_HOST:-127.0.0.1}"
restore_target_port="${RESTORE_TARGET_PORT:-55432}"
restore_target_major="${RESTORE_TARGET_MAJOR:-17}"
restore_target_database="${RESTORE_TARGET_DATABASE:-quest}"
restore_target_data_root="${RESTORE_TARGET_DATA_ROOT:-${POSTGRES_TARGET_DATA_ROOT:-}}"
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
  sentinel_mode="$(stat -c '%a' "$restore_sentinel_command" 2>/dev/null)" || {
    echo "Restore target sentinel command mode cannot be inspected." >&2
    exit 1
  }
  [[ "$sentinel_mode" =~ ^[0-7]{3,4}$ ]] || {
    echo "Restore target sentinel command mode is invalid." >&2
    exit 1
  }
  case "$sentinel_mode" in
    *[2367][0-7]|*[0-7][2367])
      echo "Restore target sentinel command is writable by a group or other actor." >&2
      exit 1
      ;;
  esac
  if [[ "$restore_test_fixture" == false ]]; then
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
  local authority host_port host port path database username restore_role target_probe session_user server_addr server_port
  if [[ -n "$restore_sentinel_command" ]]; then
    read_restore_sentinel_command
  else
    read_restore_sentinel_file
  fi
  target_kind="${restore_sentinel[target_kind]:-}"
  if [[ "$restore_test_fixture" == false ]]; then
    [[ "$target_kind" == postgresql17 || "$target_kind" == production_postgresql17 ]] || {
      echo "Production restore requires the canonical PostgreSQL target sentinel." >&2
      exit 1
    }
    [[ "$restore_sentinel_command" == /usr/local/sbin/quest-release-postgres-target ]] || {
      echo "Production restore requires the canonical root-owned sentinel command." >&2
      exit 1
    }
  fi
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
    [[ -n "${RESTORE_TARGET_DATABASE:-}" ]] || restore_target_database="${restore_sentinel[database]:-quest_restore}"
  else
    [[ "${RESTORE_PRODUCTION_AUTHORIZED:-}" == 1 ||
        "${RESTORE_TARGET_AUTHORIZATION:-}" == production ]] || {
      echo "Production restore target requires explicit authorization." >&2
      exit 1
    }
    [[ "$restore_target_database" == quest ]] || {
      echo "Production restore target database must be quest; refusing configured mismatch." >&2
      exit 1
    }
    [[ "$restore_target_data_root" == /srv/quest-esports/postgres/17/data &&
       -d "$restore_target_data_root" && ! -L "$restore_target_data_root" &&
       "$(realpath "$restore_target_data_root" 2>/dev/null)" == "$restore_target_data_root" ]] || {
      echo "Production restore target data root is not canonical." >&2
      exit 1
    }
    [[ "${restore_sentinel[data_root]:-}" == "$restore_target_data_root" ]] || {
      echo "Production restore sentinel does not identify the canonical data root." >&2
      exit 1
    }
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
  [[ "$restore_url" =~ ^postgres(ql)?://[^[:space:]#]+$ && "$restore_url" != *\?* ]] || {
    echo "Recovery administrator URL is not a valid PostgreSQL URL." >&2
    exit 1
  }
  authority="${restore_url#*://}"; path="${authority#*/}"; authority="${authority%%/*}"
  username="${authority%@*}"; host_port="${authority##*@}"
  [[ "$authority" == *@* && -n "$username" && "$username" != *'@'* &&
      "$host_port" == *:* && "$host_port" != *:*:* ]] || {
    echo "Recovery administrator URL must contain an explicit restore credential." >&2
    exit 1
  }
  restore_role="${username%%:*}"
  [[ "$restore_role" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Recovery administrator URL credential has an invalid role." >&2
    exit 1
  }
  if [[ "$restore_test_fixture" == false ]]; then
    [[ "$restore_role" == quest_recovery_admin ]] || {
      echo "Production restore must use the dedicated quest_recovery_admin role." >&2
      exit 1
    }
  fi
  host="${host_port%%:*}"; port="${host_port##*:}"
  database="$path"
  [[ "$host" == "$restore_target_host" && "$port" == "$restore_target_port" &&
      "$database" == "$restore_target_database" ]] || {
    echo "Recovery administrator URL does not bind to the verified restore target." >&2
    exit 1
  }
  psql_target() {
    PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGSSLCERT="$recovery_client_cert_file" PGSSLKEY="$recovery_client_key_file" PGAPPNAME=quest-restore-target \
      "$psql_bin" -X "$restore_url" "$@"
  }
  target_probe="$(psql_target -t -A -c "SELECT current_database() || '|' || current_setting('server_version_num') || '|' || CASE WHEN EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) THEN 'on' ELSE 'off' END || '|' || session_user || '|' || COALESCE(inet_server_addr()::text, '') || '|' || inet_server_port() || '|' || current_setting('application_name')" 2>/dev/null)" || {
    echo "Restore target identity probe failed." >&2
    exit 1
  }
  IFS='|' read -r observed_database observed_version observed_ssl observed_session_user server_addr server_port observed_appname <<< "$target_probe"
  [[ "$observed_database" == "$restore_target_database" && "$observed_version" =~ ^17[0-9]*$ &&
      "$observed_ssl" == on &&
      "$observed_session_user" == "$restore_role" && -n "$server_addr" &&
      "$server_port" == 5432 && "$observed_appname" == quest-restore-target &&
      "$server_addr" =~ ^((10|192\.168)\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+)$ ]] || {
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
toc_path="$work_directory/database.toc"
if ! PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGSSLCERT="$recovery_client_cert_file" PGSSLKEY="$recovery_client_key_file" PGAPPNAME=quest-restore-target \
  "$pg_restore_bin" --list "$work_directory/database.dump" > "$toc_path"; then
  echo "The database archive TOC could not be inspected." >&2
  exit 1
fi
declare -A toc_schemas=()
public_object_count=0
valorant_object_count=0
while IFS= read -r toc_line || [[ -n "$toc_line" ]]; do
  [[ -z "$toc_line" || "$toc_line" == \;* ]] && continue
  [[ "$toc_line" =~ ^[[:space:]]*[0-9]+\;[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+ ]] || {
    echo "The database archive TOC contains a malformed entry." >&2
    exit 1
  }
  toc_entry="${toc_line#*;}"
  read -r -a toc_fields <<< "$toc_entry"
  toc_type="${toc_fields[2]:-}"
  toc_schema=""
  toc_object=false
  toc_scope_known=false
  case "$toc_type" in
    SCHEMA)
      [[ "${toc_fields[3]:-}" == - && -n "${toc_fields[4]:-}" ]] || {
        echo "The database archive TOC contains an ambiguous schema entry." >&2
        exit 1
      }
      toc_schema="${toc_fields[4]}"
      toc_scope_known=true
      [[ -z "${toc_schemas[$toc_schema]+x}" ]] || {
        echo "The database archive TOC contains an ambiguous duplicate schema entry." >&2
        exit 1
      }
      toc_schemas["$toc_schema"]=1
      ;;
    TABLE)
      if [[ "${toc_fields[3]:-}" == DATA || "${toc_fields[3]:-}" == ATTACH ]]; then
        toc_schema="${toc_fields[4]:-}"
      else
        toc_schema="${toc_fields[3]:-}"
      fi
      toc_object=true
      toc_scope_known=true
      ;;
    SEQUENCE)
      if [[ "${toc_fields[3]:-}" == OWNED && "${toc_fields[4]:-}" == BY ]]; then
        toc_schema="${toc_fields[5]:-}"
      elif [[ "${toc_fields[3]:-}" == SET ]]; then
        toc_schema="${toc_fields[4]:-}"
      else
        toc_schema="${toc_fields[3]:-}"
      fi
      toc_object=true
      toc_scope_known=true
      ;;
    FUNCTION|PROCEDURE|AGGREGATE|OPERATOR|COLLATION|CONVERSION|DOMAIN|INDEX|CONSTRAINT|TRIGGER|RULE|TYPE|VIEW|STATISTICS)
      if [[ "${toc_type}" == OPERATOR && ( "${toc_fields[3]:-}" == CLASS || "${toc_fields[3]:-}" == FAMILY ) ]]; then
        toc_schema="${toc_fields[4]:-}"
      elif [[ "${toc_fields[3]:-}" == ATTACH ]]; then
        toc_schema="${toc_fields[4]:-}"
      else
        toc_schema="${toc_fields[3]:-}"
      fi
      toc_object=true
      toc_scope_known=true
      ;;
    FOREIGN)
      [[ "${toc_fields[3]:-}" == TABLE ]] || {
        echo "The database archive TOC contains an unsupported FOREIGN entry." >&2
        exit 1
      }
      toc_schema="${toc_fields[4]:-}"
      toc_object=true
      toc_scope_known=true
      ;;
    MATERIALIZED)
      if [[ "${toc_fields[3]:-}" == VIEW ]]; then
        if [[ "${toc_fields[4]:-}" == DATA ]]; then
          # pg_restore lists this as "MATERIALIZED VIEW DATA schema name".
          toc_schema="${toc_fields[5]:-}"
        else
          toc_schema="${toc_fields[4]:-}"
        fi
        toc_object=true
        toc_scope_known=true
      fi
      ;;
    FK)
      [[ "${toc_fields[3]:-}" == CONSTRAINT ]] || {
        echo "The database archive TOC contains an unsupported FK entry." >&2
        exit 1
      }
      toc_schema="${toc_fields[4]:-}"
      toc_object=true
      toc_scope_known=true
      ;;
    POLICY|"ROW")
      if [[ "$toc_type" == ROW ]]; then
        [[ "${toc_fields[3]:-}" == SECURITY ]] || {
          echo "The database archive TOC contains an unsupported ROW entry." >&2
          exit 1
        }
        toc_schema="${toc_fields[4]:-}"
      else
        toc_schema="${toc_fields[3]:-}"
      fi
      toc_object=true
      toc_scope_known=true
      ;;
    COMMENT|ACL)
      # Object comments/ACLs use "COMMENT|ACL schema name ...".  Schema,
      # database, and extension comments/ACLs use "COMMENT|ACL - TARGET ...";
      # only the SCHEMA target carries an application schema scope.
      if [[ "${toc_fields[3]:-}" == - ]]; then
        case "${toc_fields[4]:-}" in
          SCHEMA)
            toc_schema="${toc_fields[5]:-}"
            toc_object=true
            ;;
          DATABASE|EXTENSION|FOREIGN|TABLESPACE)
            ;;
          TABLE|SEQUENCE|FUNCTION|PROCEDURE|AGGREGATE|INDEX|CONSTRAINT|TRIGGER|RULE|TYPE|VIEW|MATERIALIZED|STATISTICS|COLLATION|CONVERSION|DOMAIN|POLICY|"ROW")
            toc_schema="${toc_fields[5]:-}"
            toc_object=true
            ;;
          *)
            echo "The database archive TOC contains an ambiguous $toc_type entry." >&2
            exit 1
            ;;
        esac
      else
        toc_schema="${toc_fields[3]:-}"
        toc_object=true
      fi
      toc_scope_known=true
      ;;
    DEFAULT)
      if [[ "${toc_fields[3]:-}" == ACL ]]; then
        # PostgreSQL 17 lists a default-privilege entry as
        # "DEFAULT ACL schema tag owner".  The tag is GLOBAL for database-wide
        # privileges or IN SCHEMA <schema> for namespace-specific privileges;
        # the TABLES/SEQUENCES/FUNCTIONS/TYPES/SCHEMAS subtype is emitted by
        # the restore SQL and is not a TOC field.
        if [[ "${toc_fields[4]:-}" == - ]]; then
          [[ "${#toc_fields[@]}" == 7 &&
             "${toc_fields[5]:-}" == GLOBAL &&
             -n "${toc_fields[6]:-}" ]] || {
            echo "The database archive TOC contains a malformed global DEFAULT ACL entry." >&2
            exit 1
          }
        else
          toc_schema="${toc_fields[4]:-}"
          [[ "${#toc_fields[@]}" == 9 &&
             -n "$toc_schema" &&
             "${toc_fields[5]:-}" == IN &&
             "${toc_fields[6]:-}" == SCHEMA &&
             "${toc_fields[7]:-}" == "$toc_schema" &&
             -n "${toc_fields[8]:-}" ]] || {
            echo "The database archive TOC contains a malformed schema-specific DEFAULT ACL entry." >&2
            exit 1
          }
          toc_object=true
        fi
      else
        # Column defaults use the single-word DEFAULT descriptor:
        # "DEFAULT schema table column".  Do not confuse these ordinary
        # entries with DEFAULT ACL, but still enforce their schema scope.
        [[ "${toc_fields[3]:-}" != - && -n "${toc_fields[3]:-}" &&
           "${toc_fields[4]:-}" != - && -n "${toc_fields[4]:-}" ]] || {
          echo "The database archive TOC contains an ambiguous DEFAULT entry." >&2
          exit 1
        }
        toc_schema="${toc_fields[3]}"
        toc_object=true
      fi
      toc_scope_known=true
      ;;
    TEXT)
      case "${toc_fields[3]:-} ${toc_fields[4]:-}" in
        SEARCH\ DICTIONARY|SEARCH\ PARSER|SEARCH\ TEMPLATE|SEARCH\ CONFIGURATION)
          toc_schema="${toc_fields[5]:-}"
          toc_object=true
          ;;
        *)
          echo "The database archive TOC contains an unsupported TEXT entry." >&2
          exit 1
          ;;
      esac
      toc_scope_known=true
      ;;
    EVENT|CAST|TRANSFORM)
      # These are legitimate archive-global entries and deliberately do not
      # name an application schema.  They still must be recognized rather than
      # silently skipped.
      toc_scope_known=true
      ;;
    DATABASE|EXTENSION|BLOB|TABLESPACE)
      # These are legitimate archive-global entries and deliberately do not
      # name an application schema.  They still must be recognized rather than
      # silently skipped.
      toc_scope_known=true
      ;;
    *)
      echo "The database archive TOC contains an unsupported or ambiguous entry." >&2
      exit 1
      ;;
  esac
  [[ "$toc_scope_known" == true ]] || {
    echo "The database archive TOC contains an unsupported or ambiguous entry." >&2
    exit 1
  }
  if [[ "$toc_object" == true ]]; then
    [[ "$toc_schema" == public || "$toc_schema" == valorant ]] || {
      echo "The database archive TOC contains an object outside public and valorant." >&2
      exit 1
    }
    if [[ "$toc_schema" == public ]]; then
      public_object_count=$((public_object_count + 1))
    else
      valorant_object_count=$((valorant_object_count + 1))
    fi
  fi
done < "$toc_path"
[[ -n "${toc_schemas[public]+x}" ]] || {
  echo "The database archive TOC is missing the public schema." >&2
  exit 1
}
[[ -n "${toc_schemas[valorant]+x}" ]] || {
  echo "The database archive TOC is missing the valorant schema." >&2
  exit 1
}
[[ "${#toc_schemas[@]}" == 2 ]] || {
  echo "The database archive TOC contains an unexpected schema scope." >&2
  exit 1
}
[[ "$public_object_count" -gt 0 ]] || {
  echo "The database archive TOC has no public objects." >&2
  exit 1
}
[[ "$valorant_object_count" -gt 0 ]] || {
  echo "The database archive TOC has no valorant objects." >&2
  exit 1
}
[[ -r "$canonical_security_sql" && -f "$canonical_security_sql" && ! -L "$canonical_security_sql" ]] || {
  echo "Canonical PostgreSQL security SQL is missing; restore refused before activation." >&2
  exit 1
}

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

if ! PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGSSLCERT="$recovery_client_cert_file" PGSSLKEY="$recovery_client_key_file" PGAPPNAME=quest-restore-target \
  "$pg_restore_bin" --dbname="$restore_url" \
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
  echo "Canonical PostgreSQL security normalization failed for quest_recovery_admin; the exit guard will roll back both activated file trees." >&2
  exit 1
fi

# The --no-owner restore deliberately creates objects as the recovery role. The
# canonical bootstrap normalizes every application object to its schema's
# migrator; require a non-secret, exact zero-mismatch probe before declaring
# the restore complete.
owner_mismatches="$(psql_target -tAc "WITH relation_owners AS (SELECT n.nspname, c.relname, r.rolname AS owner_name, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS expected_owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname IN ('public','valorant') AND c.relkind IN ('r','p','v','m','S','f')), routine_owners AS (SELECT n.nspname, p.proname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner WHERE n.nspname IN ('public','valorant') AND p.prokind IN ('f','p','a')), type_owners AS (SELECT n.nspname, t.typname, r.rolname, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_roles r ON r.oid = t.typowner WHERE n.nspname IN ('public','valorant') AND t.typisdefined AND t.typtype IN ('b','d','e','r') AND t.typelem = 0 AND t.typrelid = 0) SELECT count(*) FROM (SELECT * FROM relation_owners UNION ALL SELECT * FROM routine_owners UNION ALL SELECT * FROM type_owners) objects WHERE owner_name <> expected_owner")" || {
  echo "Restored object-owner verification failed; the exit guard will roll back both activated file trees." >&2
  exit 1
}
owner_mismatches="$(printf '%s' "$owner_mismatches" | tr -d '[:space:]')"
[[ "$owner_mismatches" == 0 ]] || {
  echo "Restored object-owner normalization is incomplete; the exit guard will roll back both activated file trees." >&2
  exit 1
}
extended_owner_mismatches="$(psql_target -tAc "WITH objects AS (SELECT n.nspname AS schema_name, pg_get_userbyid(o.oprowner) AS owner_name, CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END AS expected_owner FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(c.collowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(c.conowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(s.stxowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(o.opcowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(o.opfowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_opfamily o JOIN pg_namespace n ON n.oid = o.opfnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(d.dictowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace WHERE n.nspname IN ('public','valorant') UNION ALL SELECT n.nspname, pg_get_userbyid(c.cfgowner), CASE WHEN n.nspname = 'public' THEN 'quest_migrator' ELSE 'val_migrator' END FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace WHERE n.nspname IN ('public','valorant')) SELECT count(*) FROM objects WHERE owner_name <> expected_owner")" || {
  echo "Extended restored object-owner verification failed; the exit guard will roll back both activated file trees." >&2
  exit 1
}
extended_owner_mismatches="$(printf '%s' "$extended_owner_mismatches" | tr -d '[:space:]')"
[[ "$extended_owner_mismatches" == 0 ]] || {
  echo "Restored non-relation object owners do not match their schema migrators; the exit guard will roll back both activated file trees." >&2
  exit 1
}
echo "Restored object-owner verification: passed (0 mismatches)."

echo "Restored schema table counts (public and valorant):"
if ! psql_target -tAc "SELECT 'public=' || count(*) FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT 'valorant=' || count(*) FROM pg_tables WHERE schemaname = 'valorant'"; then
  echo "Table-count verification failed (restore may still have succeeded)" >&2
fi

public_activated=false
private_activated=false
echo "Restore completed. Restart the API and run the production verification checklist."
[[ -z "$public_previous" ]] || echo "Previous public files retained at: $public_previous"
[[ -z "$private_previous" ]] || echo "Previous private files retained at: $private_previous"
