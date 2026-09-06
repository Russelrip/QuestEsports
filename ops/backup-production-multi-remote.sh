#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}"
config_file="$BACKUP_ENV_FILE"
backup_test_fixture=false
if [[ $# -eq 1 && "$1" == --test-fixture ]]; then
  backup_test_fixture=true
elif [[ $# -ne 0 ]]; then
  echo "Usage: backup-production-multi-remote.sh [--test-fixture]" >&2
  exit 1
fi
if [[ "$backup_test_fixture" == true && "$config_file" == /etc/quest-esports-backup.env ]]; then
  echo "Fixture mode is unavailable with the protected production configuration." >&2
  exit 1
fi
readonly config_file backup_test_fixture
if [[ ! -r "$config_file" ]]; then
  echo "Backup configuration is not readable." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$config_file"
set +a

if [[ "$backup_test_fixture" == false ]]; then
  [[ "$(realpath "$config_file" 2>/dev/null)" == /etc/quest-esports-backup.env &&
      "$(id -g deploy 2>/dev/null)" =~ ^[0-9]+$ &&
      "$(stat -c '%u:%g %a' "$config_file" 2>/dev/null)" == "0:$(id -g deploy) 640" ]] || {
    echo "Production backup configuration must be root:deploy mode 0640." >&2
    exit 1
  }
fi

required=(DIRECT_URL UPLOAD_ROOT PRIVATE_UPLOAD_ROOT BACKUP_ROOT BACKUP_AGE_RECIPIENT)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup setting: $name" >&2
    exit 1
  fi
done

backup_release_sha="${BACKUP_RELEASE_SHA:-}"
if [[ "$backup_test_fixture" == true ]]; then
  backup_release_sha="${backup_release_sha:-fixture}"
else
  [[ "$backup_release_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "BACKUP_RELEASE_SHA must identify the exact lowercase release commit." >&2
    exit 1
  }
fi

# The PostgreSQL server key/certificate are container-only identities. Backups
# use the separate client certificate/key pair, while POSTGRES_CA_FILE is a
# deploy-readable trust bundle containing the issuer of quest-postgres.crt.
# The bundle may be a copy of the server trust CA (or a bundle containing that
# issuer); it is never a client certificate or private key. Host validation
# proves the bundle verifies the server certificate before scheduled use.
backup_client_cert_file="${BACKUP_CLIENT_CERT_FILE:-}"
backup_client_key_file="${BACKUP_CLIENT_KEY_FILE:-}"
backup_client_tls_dir="${BACKUP_CLIENT_TLS_DIR:-/etc/quest-esports-backup}"
[[ -n "$backup_client_cert_file" && -n "$backup_client_key_file" ]] || {
  echo "BACKUP_CLIENT_CERT_FILE and BACKUP_CLIENT_KEY_FILE are required for production backup." >&2
  exit 1
}
[[ "$backup_client_tls_dir" == /* && "$backup_client_tls_dir" != / && -d "$backup_client_tls_dir" && ! -L "$backup_client_tls_dir" ]] || {
  echo "Backup client TLS directory is missing or unsafe." >&2
  exit 1
}
[[ "$(stat -c '%a' "$backup_client_tls_dir" 2>/dev/null)" == 750 ]] || {
  echo "Backup client TLS directory must be mode 0750." >&2
  exit 1
}
if [[ "$backup_test_fixture" == false ]]; then
  backup_group_id="$(id -g deploy 2>/dev/null)" || {
    echo "The deploy service group is unavailable." >&2
    exit 1
  }
  [[ "$backup_client_tls_dir" == /etc/quest-esports-backup &&
      "$(stat -c '%u:%g %a' "$backup_client_tls_dir" 2>/dev/null)" == "0:${backup_group_id} 750" ]] || {
    echo "Backup client TLS directory is not canonical root-owned deploy-group material." >&2
    exit 1
  }
fi
for client_file in "$backup_client_cert_file" "$backup_client_key_file"; do
  [[ "$client_file" == /* && "$client_file" != / && -f "$client_file" && -r "$client_file" && ! -L "$client_file" ]] || {
    echo "Backup client TLS material is missing or unsafe." >&2
    exit 1
  }
  client_mode="$(stat -c '%a' "$client_file" 2>/dev/null)" || {
    echo "Backup client TLS material mode cannot be inspected." >&2
    exit 1
  }
  [[ "$client_mode" == 640 ]] || {
    echo "Backup client TLS material must be mode 0640." >&2
    exit 1
  }
done
if [[ "$backup_test_fixture" == false ]]; then
  [[ "$backup_client_cert_file" == /etc/quest-esports-backup/backup-client.crt &&
      "$backup_client_key_file" == /etc/quest-esports-backup/backup-client.key &&
      "$(stat -c '%u:%g %a' "$backup_client_cert_file" 2>/dev/null)" == "0:${backup_group_id} 640" &&
      "$(stat -c '%u:%g %a' "$backup_client_key_file" 2>/dev/null)" == "0:${backup_group_id} 640" ]] || {
    echo "Backup client TLS identity is not canonical root-owned deploy-group material." >&2
    exit 1
  }
fi
command -v readlink >/dev/null || {
  echo "Required backup command is unavailable: readlink" >&2
  exit 1
}

# Never resolve PostgreSQL clients through PATH.  Ubuntu's generic wrappers can
# select an older major even when a PostgreSQL 17 installation is present.
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

validate_database_target() {
  local authority host_port host port path database username
  local sentinel_output sentinel_kind sentinel_database sentinel_host sentinel_port sentinel_major sentinel_data_root
  [[ -n "${POSTGRES_TARGET_HOST:-}" && -n "${POSTGRES_TARGET_PORT:-}" &&
      -n "${POSTGRES_TARGET_DATABASE:-}" && -n "${POSTGRES_TARGET_MAJOR:-}" &&
      -n "${POSTGRES_TARGET_DATA_ROOT:-}" && -n "${POSTGRES_TARGET_SENTINEL_COMMAND:-}" ]] || {
    echo "Explicit PostgreSQL target settings are required." >&2
    exit 1
  }
  [[ "$POSTGRES_TARGET_HOST" == 127.0.0.1 && "$POSTGRES_TARGET_PORT" == 55432 &&
      "$POSTGRES_TARGET_DATABASE" == quest && "$POSTGRES_TARGET_MAJOR" == 17 ]] || {
    echo "Backup target is not the approved PostgreSQL 17 loopback target." >&2
    exit 1
  }
  [[ "$POSTGRES_TARGET_DATA_ROOT" == /* && "$POSTGRES_TARGET_DATA_ROOT" != / &&
      -d "$POSTGRES_TARGET_DATA_ROOT" && ! -L "$POSTGRES_TARGET_DATA_ROOT" ]] || {
    echo "PostgreSQL target data root is missing or unsafe." >&2
    exit 1
  }
  if [[ "$backup_test_fixture" == false ]]; then
    [[ "$POSTGRES_TARGET_DATA_ROOT" == /srv/quest-esports/postgres/17/data ]] || {
      echo "PostgreSQL target data root is not canonical." >&2
      exit 1
    }
    [[ "$(realpath "$POSTGRES_TARGET_DATA_ROOT" 2>/dev/null)" == "$POSTGRES_TARGET_DATA_ROOT" ]] || {
      echo "PostgreSQL target data root must not contain a symlink." >&2
      exit 1
    }
    [[ "$POSTGRES_TARGET_SENTINEL_COMMAND" == /usr/local/sbin/quest-release-postgres-target ]] || {
      echo "PostgreSQL target sentinel path is not canonical." >&2
      exit 1
    }
    [[ ! -L "$POSTGRES_TARGET_SENTINEL_COMMAND" && "$(stat -c '%u' "$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" == 0 ]] || {
      echo "PostgreSQL target sentinel must be root-owned and non-symlinked." >&2
      exit 1
    }
  fi
  sentinel_mode="$(stat -c '%a' "$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" || {
    echo "PostgreSQL target sentinel mode cannot be inspected." >&2
    exit 1
  }
  [[ "$sentinel_mode" =~ ^[0-7]{3,4}$ ]] || {
    echo "PostgreSQL target sentinel mode is invalid." >&2
    exit 1
  }
  case "$sentinel_mode" in
    *[2367][0-7]|*[0-7][2367])
      echo "PostgreSQL target sentinel is writable by a group or other actor." >&2
      exit 1
      ;;
  esac
  [[ "$POSTGRES_TARGET_SENTINEL_COMMAND" == /* && "$POSTGRES_TARGET_SENTINEL_COMMAND" != / &&
      -x "$POSTGRES_TARGET_SENTINEL_COMMAND" && ! -L "$POSTGRES_TARGET_SENTINEL_COMMAND" ]] || {
    echo "PostgreSQL target sentinel is missing or unsafe." >&2
    exit 1
  }
  sentinel_output="$("$POSTGRES_TARGET_SENTINEL_COMMAND" 2>/dev/null)" || {
    echo "PostgreSQL target sentinel failed." >&2
    exit 1
  }
  [[ "$sentinel_output" =~ ^target_kind=([a-z0-9_-]+)[[:space:]]+database=([a-z_][a-z0-9_]*)[[:space:]]+host=([^[:space:]]+)[[:space:]]+port=([0-9]+)[[:space:]]+major=([0-9]+)[[:space:]]+data_root=([^[:space:]]+)$ ]] || {
    echo "PostgreSQL target sentinel output is ambiguous." >&2
    exit 1
  }
  sentinel_kind="${BASH_REMATCH[1]}"; sentinel_database="${BASH_REMATCH[2]}"; sentinel_host="${BASH_REMATCH[3]}"; sentinel_port="${BASH_REMATCH[4]}"; sentinel_major="${BASH_REMATCH[5]}"; sentinel_data_root="${BASH_REMATCH[6]}"
  [[ "$sentinel_kind" == postgresql17 && "$sentinel_database" == "$POSTGRES_TARGET_DATABASE" &&
      "$sentinel_host" == "$POSTGRES_TARGET_HOST" && "$sentinel_port" == "$POSTGRES_TARGET_PORT" &&
      "$sentinel_major" == "$POSTGRES_TARGET_MAJOR" && "$sentinel_data_root" == "$POSTGRES_TARGET_DATA_ROOT" ]] || {
    echo "PostgreSQL target sentinel does not identify the approved target." >&2
    exit 1
  }

  [[ "$DIRECT_URL" =~ ^postgres(ql)?://[^[:space:]#]+$ && "$DIRECT_URL" != *\?* ]] || {
    echo "DIRECT_URL is not a valid PostgreSQL URL." >&2
    exit 1
  }
  authority="${DIRECT_URL#*://}"; path="${authority#*/}"; authority="${authority%%/*}"
  username="${authority%@*}"; host_port="${authority##*@}"
  [[ "$authority" == *@* && "$username" == quest_backup:* && "$username" != *'@'* &&
      "$host_port" == *:* && "$host_port" != *:*:* ]] || {
    echo "DIRECT_URL must use the quest_backup credential." >&2
    exit 1
  }
  host="${host_port%%:*}"; port="${host_port##*:}"
  database="$path"
  [[ "$host" == "$POSTGRES_TARGET_HOST" && "$port" == "$POSTGRES_TARGET_PORT" &&
      "$database" == "$POSTGRES_TARGET_DATABASE" && "$host" == 127.0.0.1 &&
      "$port" == 55432 ]] || {
    echo "DIRECT_URL does not bind to the verified PostgreSQL 17 target." >&2
    exit 1
  }
}

resolve_postgres_clients
for setting in POSTGRES_CA_FILE; do
  [[ -n "${!setting:-}" && "${!setting}" == /* && "${!setting}" != / && -f "${!setting}" && ! -L "${!setting}" ]] || {
    echo "Required PostgreSQL TLS material is missing or unsafe: $setting" >&2
    exit 1
  }
  [[ -r "${!setting}" ]] || {
    echo "Required PostgreSQL TLS material is not readable: $setting" >&2
    exit 1
  }
done
[[ "$POSTGRES_CA_FILE" != "$backup_client_cert_file" &&
   "$POSTGRES_CA_FILE" != "$backup_client_key_file" ]] || {
  echo "POSTGRES_CA_FILE must be a trust bundle, not client identity material." >&2
  exit 1
}
tls_file="$POSTGRES_CA_FILE"
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
if [[ "$backup_test_fixture" == false ]]; then
  [[ "$POSTGRES_CA_FILE" == /etc/quest-esports-backup/backup-client-ca.crt &&
      "$(stat -c '%u:%g %a' "$POSTGRES_CA_FILE" 2>/dev/null)" == "0:${backup_group_id} 640" ]] || {
    echo "Backup CA bundle is not canonical deploy-readable trust material." >&2
    exit 1
  }
fi
validate_database_target

if [[ ! "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]]; then
  echo "BACKUP_AGE_RECIPIENT must be a valid age public recipient." >&2
  exit 1
fi

release_lock_path="${BACKUP_RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
# Direct execution remains safe for operators and disposable fixture tests.
if [[ "${BACKUP_RELEASE_LOCK_HELD:-}" == 1 ]]; then
  expected_lock_target="$(readlink -f "$release_lock_path" 2>/dev/null || true)"
  inherited_lock_target="$(readlink -f /proc/self/fd/8 2>/dev/null || true)"
  if [[ -z "$expected_lock_target" || "$expected_lock_target" != "$inherited_lock_target" ]]; then
    echo "The inherited release lock descriptor is not the canonical lock." >&2
    exit 1
  fi
  if ! flock -n 8; then
    echo "The inherited release lock is not held." >&2
    exit 1
  fi
else
  if [[ "$release_lock_path" != /* || "$release_lock_path" == "/" ]]; then
    echo "BACKUP_RELEASE_LOCK_PATH must be an absolute non-root path." >&2
    exit 1
  fi
  if ! exec 8>"$release_lock_path" || ! flock -n 8; then
    echo "Another release operation is already running." >&2
    exit 1
  fi
fi

declare -a remote_labels=()
declare -a remote_values=()
declare -a remote_configs=()
declare -A config_by_label=()
declare -A config_by_resolved_path=()

if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
  while IFS= read -r config_entry || [[ -n "$config_entry" ]]; do
    [[ -z "$config_entry" ]] && continue
    config_label="${config_entry%%=*}"
    config_path="${config_entry#*=}"
    if [[ "$config_entry" != *=* || -z "$config_label" || -z "$config_path" ||
          ! "$config_label" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains an invalid entry." >&2
      exit 1
    fi
    if [[ -n "${config_by_label[$config_label]+x}" ]]; then
      echo "BACKUP_RCLONE_CONFIGS contains a duplicate label." >&2
      exit 1
    fi
    resolved_config_path="$(realpath "$config_path" 2>/dev/null)" || {
      echo "Rclone configuration is unavailable for remote label: $config_label" >&2
      exit 1
    }
    if [[ ! -r "$resolved_config_path" || -n "${config_by_resolved_path[$resolved_config_path]+x}" ]]; then
      echo "Rclone configuration paths must be readable and unique." >&2
      exit 1
    fi
    config_by_label["$config_label"]="$resolved_config_path"
    config_by_resolved_path["$resolved_config_path"]="$config_label"
  done <<< "$BACKUP_RCLONE_CONFIGS"
fi

if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  remote_entries="$BACKUP_RCLONE_REMOTES"
elif [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  remote_entries="legacy=${BACKUP_RCLONE_REMOTE}"
  if [[ -n "${BACKUP_RCLONE_CONFIGS:-}" ]]; then
    echo "BACKUP_RCLONE_CONFIGS requires BACKUP_RCLONE_REMOTES." >&2
    exit 1
  fi
  if [[ -z "${RCLONE_CONFIG:-}" ]]; then
    echo "Missing required backup setting: RCLONE_CONFIG" >&2
    exit 1
  fi
  config_by_label[legacy]="$RCLONE_CONFIG"
fi
if [[ -z "$remote_entries" ]]; then
  echo "Missing required backup setting: BACKUP_RCLONE_REMOTES" >&2
  exit 1
fi

while IFS= read -r remote_entry || [[ -n "$remote_entry" ]]; do
  [[ -z "$remote_entry" ]] && continue
  remote_label="${remote_entry%%=*}"
  remote_value="${remote_entry#*=}"
  if [[ "$remote_entry" != *=* || -z "$remote_label" ||
        ! "$remote_label" =~ ^[A-Za-z0-9._-]+$ ||
        ! "$remote_value" =~ ^[A-Za-z0-9._-]+:.+[^/]$ ]]; then
    echo "BACKUP_RCLONE_REMOTES contains an invalid entry." >&2
    exit 1
  fi
  for existing_label in "${remote_labels[@]}"; do
    [[ "$existing_label" == "$remote_label" ]] && {
      echo "BACKUP_RCLONE_REMOTES contains a duplicate label." >&2
      exit 1
    }
  done
  remote_config="${config_by_label[$remote_label]:-}"
  if [[ -z "$remote_config" && -z "${BACKUP_RCLONE_REMOTES+x}" &&
        ${#remote_labels[@]} -eq 0 && -n "${RCLONE_CONFIG:-}" ]]; then
    remote_config="$RCLONE_CONFIG"
  fi
  if [[ -z "$remote_config" || ! -r "$remote_config" ]]; then
    echo "Rclone configuration is unavailable for remote label: $remote_label" >&2
    exit 1
  fi
  remote_labels+=("$remote_label")
  remote_values+=("$remote_value")
  remote_configs+=("$remote_config")
done <<< "$remote_entries"
if (( ${#remote_labels[@]} == 0 )); then
  echo "At least one backup remote is required." >&2
  exit 1
fi
if [[ -n "${BACKUP_RCLONE_REMOTES+x}" ]]; then
  for configured_label in "${!config_by_label[@]}"; do
    configured_remote=false
    for remote_label in "${remote_labels[@]}"; do
      [[ "$configured_label" == "$remote_label" ]] && configured_remote=true
    done
    if [[ "$configured_remote" != true ]]; then
      echo "BACKUP_RCLONE_CONFIGS must exactly match BACKUP_RCLONE_REMOTES." >&2
      exit 1
    fi
  done
fi

for directory in "$UPLOAD_ROOT" "$PRIVATE_UPLOAD_ROOT"; do
  case "$directory" in
    /*) ;;
    *) echo "Backup source directories must be absolute paths." >&2; exit 1 ;;
  esac
  if [[ "$directory" == "/" ]]; then
    echo "Refusing to archive the filesystem root." >&2
    exit 1
  fi
  if [[ ! -d "$directory" ]]; then
    echo "Required backup directory does not exist." >&2
    exit 1
  fi
done
case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute path." >&2; exit 1 ;;
esac
if [[ "$BACKUP_ROOT" == "/" || -L "$BACKUP_ROOT" ]]; then
  echo "BACKUP_ROOT must not be the filesystem root or a symbolic link." >&2
  exit 1
fi
for command in age basename cat chmod date find flock hostname mkdir mktemp realpath rm rclone rsync sed sha256sum stat tar; do
  command -v "$command" >/dev/null || {
    echo "Required backup command is unavailable: $command" >&2
    exit 1
  }
done

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

exec 9>"$BACKUP_ROOT/.quest-backup.lock"
if ! flock -n 9; then
  echo "Another production backup is already running." >&2
  exit 1
fi

# The archive name and its result record are derived only once this process holds
# the backup lock. The name has one-second resolution, so deriving it earlier let
# two runs in the same second agree on a name: the one that lost the lock
# truncated the winner's record and then marked it failed on the way out.
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
hostname_value="$(hostname -f 2>/dev/null || hostname)"
archive_name="quest-production-${timestamp}.tar.gz.enc"
archive_path="$BACKUP_ROOT/$archive_name"
checksum_path="$archive_path.sha256"
result_path="$BACKUP_ROOT/$archive_name.results"
# Sequential runs inside one second would still agree on the name after the lock
# is released. Refuse rather than silently overwrite an existing recovery point.
for existing_artifact in "$archive_path" "$checksum_path" "$result_path"; do
  [[ ! -e "$existing_artifact" ]] || {
    echo "A backup already exists for this second; refusing to overwrite it." >&2
    exit 1
  }
done
# A result record is created before any target, archive, or remote operation.
# The EXIT trap converts every later failure to a terminal record; no failed run
# can leave a misleading pending status behind.
printf 'archive=%s\nrelease_sha=%s\nstatus=running\nexit_status=running\nremote_label\tstatus\n' "$archive_name" "$backup_release_sha" > "$result_path"
chmod 600 "$result_path"
finalize_result() {
  local status=$?
  trap - EXIT
  set +e
  [[ -z "${work_directory:-}" ]] || rm -rf -- "$work_directory"
  if [[ -f "${result_path:-}" && ! -L "${result_path:-}" ]]; then
    if (( status == 0 )); then
      sed -i 's/^status=running$/status=success/; s/^exit_status=running$/exit_status=0/' "$result_path"
    else
      sed -i "s/^status=running$/status=failed/; s/^exit_status=running$/exit_status=$status/" "$result_path"
    fi
  fi
  exit "$status"
}
trap finalize_result EXIT
resolved_upload_root="$(realpath "$UPLOAD_ROOT")"
resolved_private_root="$(realpath "$PRIVATE_UPLOAD_ROOT")"
resolved_backup_root="$(realpath "$BACKUP_ROOT")"
if [[ "$resolved_backup_root" == "/" ]]; then
  echo "Resolved BACKUP_ROOT must not be the filesystem root." >&2
  exit 1
fi
if [[ "$resolved_upload_root" == "$resolved_private_root" ]] ||
   [[ "$(basename "$resolved_upload_root")" == "$(basename "$resolved_private_root")" ]]; then
  echo "Public and private upload roots must be distinct and have distinct directory names." >&2
  exit 1
fi
for source_root in "$resolved_upload_root" "$resolved_private_root"; do
  if [[ "$resolved_backup_root" == "$source_root" || "$resolved_backup_root" == "$source_root/"* ||
        "$source_root" == "$resolved_backup_root/"* ]]; then
    echo "BACKUP_ROOT and upload roots must not contain one another." >&2
    exit 1
  fi
done

public_event_album_preview_root="$resolved_upload_root/poster-images"
private_event_album_original_root="$resolved_private_root/event-album-originals"
# Keep both event-album representations present in every filesystem snapshot.
mkdir -p "$public_event_album_preview_root" "$private_event_album_original_root"
chmod 700 "$resolved_private_root" "$private_event_album_original_root"

work_directory="$(mktemp -d "$BACKUP_ROOT/.quest-backup-${timestamp}-XXXXXX")"

psql_target() {
  PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGSSLCERT="$backup_client_cert_file" PGSSLKEY="$backup_client_key_file" PGAPPNAME=quest-backup-target \
    "$psql_bin" -X "$DIRECT_URL" "$@"
}
if ! target_probe="$(psql_target -tAc "SELECT current_database() || '|' || current_setting('server_version_num') || '|' || CASE WHEN EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) THEN 'on' ELSE 'off' END || '|' || session_user || '|' || COALESCE(inet_server_addr()::text, '') || '|' || inet_server_port() || '|' || current_setting('application_name')" 2>/dev/null)"; then
  echo "PostgreSQL target identity probe failed" >&2
  exit 1
fi
[[ "$target_probe" =~ ^quest\|17[0-9]*\|on\|quest_backup\|((10|192\.168)\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+)\|5432\|quest-backup-target$ ]] || {
  echo "PostgreSQL target identity is not verified." >&2
  exit 1
}
if ! valorant_probe="$(psql_target -tAc "SELECT 1 FROM pg_namespace WHERE nspname = 'valorant'" 2>/dev/null)"; then
  echo "valorant schema probe failed" >&2
  exit 1
fi
[[ "$valorant_probe" == "1" ]] || {
  echo "valorant schema is required for a complete recovery point" >&2
  exit 1
}
valorant_schema_exists=true

public_name="$(basename "$resolved_upload_root")"
private_name="$(basename "$resolved_private_root")"
mkdir -p "$work_directory/$public_name" "$work_directory/$private_name"
# Two passes around the database dump form a stable union snapshot.
rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

inventory_tree() {
  local root="$1" output="$2" entry relative digest bytes
  : > "$output"
  while IFS= read -r -d '' entry; do
    relative="${entry#"$root"/}"
    [[ "$relative" != *$'\n'* && "$relative" != *$'\r'* && "$relative" != *$'\t'* ]] || {
      echo "Upload tree contains an unsupported filename." >&2
      exit 1
    }
    if [[ -L "$entry" ]]; then
      echo "Upload tree contains a symbolic link." >&2
      exit 1
    elif [[ -d "$entry" ]]; then
      printf 'directory\t%s\n' "$relative" >> "$output"
    elif [[ -f "$entry" ]]; then
      digest="$(sha256sum -- "$entry" | awk '{print $1}')"
      bytes="$(stat -c '%s' -- "$entry")"
      printf 'file\t%s\t%s\t%s\n' "$relative" "$bytes" "$digest" >> "$output"
    else
      echo "Upload tree contains an unsupported filesystem entry." >&2
      exit 1
    fi
  done < <(find -P "$root" -mindepth 1 -print0 | sort -z)
}

inventory_tree "$work_directory/$public_name" "$work_directory/public-upload-inventory.tsv"
inventory_tree "$work_directory/$private_name" "$work_directory/private-upload-inventory.tsv"
public_upload_inventory_sha256="$(sha256sum "$work_directory/public-upload-inventory.tsv" | awk '{print $1}')"
private_upload_inventory_sha256="$(sha256sum "$work_directory/private-upload-inventory.tsv" | awk '{print $1}')"

PGSSLMODE=verify-full PGSSLROOTCERT="$POSTGRES_CA_FILE" PGSSLCERT="$backup_client_cert_file" PGSSLKEY="$backup_client_key_file" PGAPPNAME=quest-backup-dump \
  "$pg_dump_bin" "$DIRECT_URL" --format=custom --schema=public --schema=valorant \
  --no-owner --no-acl --file="$work_directory/database.dump" 2>/dev/null
rsync -a "$resolved_upload_root/" "$work_directory/$public_name/"
rsync -a "$resolved_private_root/" "$work_directory/$private_name/"

if [[ "$valorant_schema_exists" == true ]]; then
  database_scope=application_public_and_valorant_schemas
else
  database_scope=application_public_schema_only
fi
{
  printf 'created_at_utc=%s\n' "$timestamp"
  printf 'release_sha=%s\n' "$backup_release_sha"
  printf 'source_host=%s\n' "$hostname_value"
  printf 'database_format=postgres_custom\n'
  printf 'database_scope=%s\n' "$database_scope"
  printf 'valorant_schema_included=%s\n' "$valorant_schema_exists"
  printf 'supabase_managed_schemas_included=false\n'
  printf 'public_upload_root=%s\n' "$UPLOAD_ROOT"
  printf 'private_upload_root=%s\n' "$PRIVATE_UPLOAD_ROOT"
  printf 'file_snapshot_strategy=two_pass_union_around_database_dump\n'
  printf 'public_event_album_preview_root=%s\n' "$public_event_album_preview_root"
  printf 'private_event_album_original_root=%s\n' "$private_event_album_original_root"
  printf 'public_upload_inventory=public-upload-inventory.tsv\n'
  printf 'public_upload_inventory_sha256=%s\n' "$public_upload_inventory_sha256"
  printf 'private_upload_inventory=private-upload-inventory.tsv\n'
  printf 'private_upload_inventory_sha256=%s\n' "$private_upload_inventory_sha256"
} > "$work_directory/manifest.txt"

tar --create --gzip --file="$work_directory/payload.tar.gz" \
  -C "$work_directory" database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv "$public_name" "$private_name"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$archive_path" \
  "$work_directory/payload.tar.gz" 2>/dev/null
(cd "$BACKUP_ROOT" && sha256sum "$archive_name" > "$archive_name.sha256")

# This record intentionally contains labels and outcomes, never destinations or configs.
remote_failures=0
for remote_index in "${!remote_labels[@]}"; do
  label="${remote_labels[$remote_index]}"
  remote="${remote_values[$remote_index]}"
  config="${remote_configs[$remote_index]}"
  remote_ok=true
  if ! rclone copyto "$archive_path" "${remote%/}/$archive_name" --config "$config" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if ! rclone copyto "$checksum_path" "${remote%/}/$archive_name.sha256" --config "$config" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if ! rclone check "$BACKUP_ROOT" "${remote%/}" --config "$config" --one-way \
      --include "/$archive_name" --include "/$archive_name.sha256" >/dev/null 2>/dev/null; then
    remote_ok=false
  fi
  if [[ "$remote_ok" == true ]]; then
    printf '%s\tsuccess\n' "$label" >> "$result_path"
  else
    printf '%s\tfailure\n' "$label" >> "$result_path"
    remote_failures=$((remote_failures + 1))
  fi
done
chmod 600 "$result_path"

retention_days="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_LOCAL_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'quest-production-*.tar.gz.enc' -o -name 'quest-production-*.tar.gz.enc.sha256' -o -name 'quest-production-*.results' \) \
  -mtime "+$retention_days" -delete

if (( remote_failures > 0 )); then
  echo "Production backup was created but one or more required remotes failed; see the per-run result record." >&2
  exit 1
fi
echo "Encrypted production backup uploaded successfully: $archive_name (ScriptResult=success ScriptExitStatus=0)"
