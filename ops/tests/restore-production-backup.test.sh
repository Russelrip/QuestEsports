#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/quest-restore-test.XXXXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/public" "$test_root/private"
printf 'fixture identity\n' > "$test_root/identity"
printf 'fixture ca\n' > "$test_root/ca.crt"
printf 'fixture cert\n' > "$test_root/postgres.crt"
printf 'fixture key\n' > "$test_root/postgres.key"
chmod 600 "$test_root/identity" "$test_root/ca.crt" "$test_root/postgres.crt" "$test_root/postgres.key"
printf 'encrypted fixture\n' > "$test_root/quest-production-fixture.tar.gz.enc"
printf 'checksum\n' > "$test_root/quest-production-fixture.tar.gz.enc.sha256"

cat > "$test_root/recovery.env" <<EOF
POSTGRES17_BIN=$test_root/bin
POSTGRES_CA_FILE=$test_root/ca.crt
RECOVERY_CLIENT_CERT_FILE=$test_root/postgres.crt
RECOVERY_CLIENT_KEY_FILE=$test_root/postgres.key
RECOVERY_ADMIN_URL=postgresql://quest_recovery_admin:fixture@127.0.0.1:55432/quest_restore
UPLOAD_ROOT=$test_root/public
PRIVATE_UPLOAD_ROOT=$test_root/private
BACKUP_AGE_IDENTITY_FILE=$test_root/identity
RESTORE_TARGET_HOST=127.0.0.1
RESTORE_TARGET_PORT=55432
RESTORE_TARGET_DATABASE=quest_restore
RESTORE_TARGET_MAJOR=17
RESTORE_TARGET_SENTINEL_FILE=$test_root/target-sentinel.env
EOF

cat > "$test_root/target-sentinel.env" <<EOF
target_kind=disposable_postgresql17
target_id=quest-restore-fixture
container_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
public_root=$test_root/public
private_root=$test_root/private
EOF
chmod 600 "$test_root/target-sentinel.env"

cat > "$test_root/bin/age" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  if [[ "$1" == --output ]]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
printf 'fixture payload\n' > "$output"
EOF

REAL_SHA256SUM="$(command -v sha256sum)"
export REAL_SHA256SUM
cat > "$test_root/bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == --check ]] && exit 0
exec "$REAL_SHA256SUM" "$@"
EOF

cat > "$test_root/bin/tar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --list ]]; then
  printf '%s\n' public/ public/poster-images/ private/ private/event-album-originals/ database.dump manifest.txt public-upload-inventory.tsv private-upload-inventory.tsv
  exit 0
fi
directory=''
for argument in "$@"; do
  [[ "$argument" == --directory=* ]] && directory="${argument#--directory=}"
done
mkdir -p "$directory/public/poster-images" "$directory/private/event-album-originals"
printf 'fixture public file\n' > "$directory/public/file.txt"
printf 'fixture private file\n' > "$directory/private/file.txt"
printf 'fixture private original\n' > "$directory/private/event-album-originals/file"
printf 'fixture dump\n' > "$directory/database.dump"
printf 'file\tfile.txt\t%s\t%s\ndirectory\tposter-images\n' "$(wc -c < "$directory/public/file.txt" | tr -d ' ')" "$(sha256sum "$directory/public/file.txt" | cut -d' ' -f1)" > "$directory/public-upload-inventory.tsv"
printf 'directory\tevent-album-originals\nfile\tevent-album-originals/file\t%s\t%s\nfile\tfile.txt\t%s\t%s\n' "$(wc -c < "$directory/private/event-album-originals/file" | tr -d ' ')" "$(sha256sum "$directory/private/event-album-originals/file" | cut -d' ' -f1)" "$(wc -c < "$directory/private/file.txt" | tr -d ' ')" "$(sha256sum "$directory/private/file.txt" | cut -d' ' -f1)" > "$directory/private-upload-inventory.tsv"
printf 'database_scope=application_public_and_valorant_schemas\nvalorant_schema_included=true\npublic_upload_root=%s\nprivate_upload_root=%s\npublic_event_album_preview_root=%s\nprivate_event_album_original_root=%s\n' \
  "$TEST_ROOT/public" "$TEST_ROOT/private" "$TEST_ROOT/public/poster-images" "$TEST_ROOT/private/event-album-originals" > "$directory/manifest.txt"
printf 'public_upload_inventory=public-upload-inventory.tsv\npublic_upload_inventory_sha256=%s\nprivate_upload_inventory=private-upload-inventory.tsv\nprivate_upload_inventory_sha256=%s\n' "$(sha256sum "$directory/public-upload-inventory.tsv" | cut -d' ' -f1)" "$(sha256sum "$directory/private-upload-inventory.tsv" | cut -d' ' -f1)" >> "$directory/manifest.txt"
EOF

cat > "$test_root/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
  printf 'pg_restore (PostgreSQL) 17.4\n'
  exit 0
fi
printf '%s\n' "pg_restore $*" >> "$TEST_ROOT/pg_restore.log"
dump="${@: -1}"
printf '%s\n' '3; 2615 2200 SCHEMA - public postgres' '4; 1259 2201 TABLE public users postgres' '5; 2615 2202 SCHEMA - valorant postgres' '6; 1259 2203 TABLE valorant matches postgres'
exit 0
EOF

cat > "$test_root/bin/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
  printf 'psql (PostgreSQL) 17.4\n'
  exit 0
fi
printf '%s\n' "psql $*" >> "$TEST_ROOT/psql.log"
if [[ "$*" == *current_database* ]]; then
  printf 'quest_restore|170004|%s|%s|%s|%s|quest-restore-target\n' \
    "${OBSERVED_SSL:-on}" "${OBSERVED_SESSION_USER:-restore}" "${OBSERVED_SERVER_ADDR:-172.18.0.2}" "${OBSERVED_SERVER_PORT:-5432}"
  exit 0
fi
for ((index = 1; index <= $#; index++)); do
  if [[ "${!index}" == -f ]]; then
    next=$((index + 1))
    if [[ "$*" == *'RESTORE_MODE=1'* ]]; then
      bootstrap="${!next}"
      grep -F '\if :{?RESTORE_MODE}' "$bootstrap" >/dev/null
      grep -F "session_user <> 'quest_recovery_admin' OR current_user <> 'quest_recovery_admin'" "$bootstrap" >/dev/null
      grep -F 'EXECUTE format(' "$bootstrap" >/dev/null
      grep -F 'current_database()' "$bootstrap" >/dev/null
      ! grep -F 'GRANT CONNECT ON DATABASE quest TO' "$bootstrap" >/dev/null
      [[ "${BOOTSTRAP_SESSION_USER:-quest_recovery_admin}" == quest_recovery_admin ]] || exit 1
    fi
    cat "${!next}" >> "$TEST_ROOT/psql.log"
  fi
done
if [[ "$*" == *owner_name* ]]; then
  printf '0\n'
fi
exit 0
EOF

cat > "$test_root/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  printf 'pg_dump (PostgreSQL) 17.4\n'
  exit 0
fi
exit 0
EOF

cat > "$test_root/bin/rsync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source_path="${@: -2:1}"
target_path="${@: -1}"
mkdir -p "$target_path"
cp -a -- "${source_path%/}/." "$target_path/"
EOF

chmod 700 "$test_root/bin"/*

PATH="$test_root/bin:$PATH" \
  RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE="$test_root/recovery.env" \
  RESTORE_COUNTDOWN_SECONDS=0 \
  TEST_ROOT="$test_root" \
  OBSERVED_SESSION_USER=quest_recovery_admin \
  bash "$root/ops/restore-production-backup.sh" \
  --test-fixture "$test_root/quest-production-fixture.tar.gz.enc" >/dev/null

grep -F -- '--no-owner' "$test_root/pg_restore.log" >/dev/null
grep -F -- '--no-acl' "$test_root/pg_restore.log" >/dev/null
grep -F -- '-X' "$test_root/psql.log" >/dev/null
grep -F -- '-v RESTORE_MODE=1' "$test_root/psql.log" >/dev/null
! grep -F -- 'SET ROLE' "$test_root/psql.log" >/dev/null
grep -F -- 'quest_recovery_admin' "$test_root/psql.log" >/dev/null
grep -F -- "REVOKE ALL ON DATABASE %I FROM PUBLIC" "$test_root/psql.log" >/dev/null
grep -F -- 'GRANT CONNECT ON DATABASE %I TO quest_migrator, quest_runtime, val_migrator, val_runtime' "$test_root/psql.log" >/dev/null
grep -F -- 'current_database()' "$test_root/psql.log" >/dev/null
grep -F -- 'current_database()' "$test_root/psql.log" >/dev/null
! grep -F -- 'REVOKE ALL ON DATABASE quest FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER ROLE quest_runtime LOGIN NOINHERIT' "$test_root/psql.log" >/dev/null
grep -F -- 'FROM pg_auth_members' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER SCHEMA public OWNER TO quest_migrator' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER SCHEMA valorant OWNER TO val_migrator' "$test_root/psql.log" >/dev/null
grep -F -- "p.prokind IN ('f','p','a','w')" "$root/ops/restore-production-backup.sh" >/dev/null
grep -F -- 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON TYPE %I.%I FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quest_runtime' "$test_root/psql.log" >/dev/null
grep -F -- 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA valorant TO val_runtime' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON FUNCTIONS FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON ROUTINES FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON TYPES FROM PUBLIC' "$test_root/psql.log" >/dev/null
for expected in \
  'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator REVOKE USAGE ON TYPES FROM PUBLIC' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO quest_migrator' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator IN SCHEMA public GRANT USAGE ON TYPES TO quest_migrator' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator REVOKE USAGE ON TYPES FROM PUBLIC' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant GRANT EXECUTE ON FUNCTIONS TO val_migrator' \
  'ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator IN SCHEMA valorant GRANT USAGE ON TYPES TO val_migrator'; do
  grep -F -- "$expected" "$test_root/psql.log" >/dev/null || {
    echo "missing canonical default privilege statement: $expected" >&2
    exit 1
  }
done
grep -F -- 'REVOKE ALL ON SCHEMA valorant FROM quest_runtime' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON SCHEMA public FROM val_runtime' "$test_root/psql.log" >/dev/null

# The scheduled units must establish a deploy-readable working directory and
# canonical client TLS paths before invoking their wrappers. Starting systemd
# is intentionally outside this disposable test.
backup_service="$root/ops/systemd/quest-esports-backup.service"
freshness_service="$root/ops/systemd/quest-esports-backup-freshness.service"
grep -Fx 'Environment=BACKUP_ENV_FILE=/etc/quest-esports-backup.env' "$backup_service" >/dev/null
grep -Fx 'Environment=POSTGRES_CA_FILE=/etc/quest-esports-backup/backup-client-ca.crt' "$backup_service" >/dev/null
grep -Fx 'Environment=BACKUP_CLIENT_CERT_FILE=/etc/quest-esports-backup/backup-client.crt' "$backup_service" >/dev/null
grep -Fx 'Environment=BACKUP_CLIENT_KEY_FILE=/etc/quest-esports-backup/backup-client.key' "$backup_service" >/dev/null
grep -Fx 'WorkingDirectory=/var/www/QuestEsports' "$backup_service" >/dev/null
grep -Fx 'WorkingDirectory=/var/www/QuestEsports' "$freshness_service" >/dev/null
grep -Fx 'ExecStartPre=/usr/bin/test -d /var/www/QuestEsports' "$backup_service" >/dev/null
grep -Fx 'ExecStartPre=/usr/bin/test -r /var/www/QuestEsports/ops/backup-production.sh' "$backup_service" >/dev/null
grep -Fx 'ExecStartPre=/usr/bin/test -r /var/www/QuestEsports/ops/check-backup-freshness.sh' "$freshness_service" >/dev/null
! grep -Eq '^(WorkingDirectory|ExecStart|ExecStartPre)=.*/root' "$backup_service" "$freshness_service" >/dev/null
grep -F 'ScriptResult=success ScriptExitStatus=0' "$root/ops/backup-production-multi-remote.sh" >/dev/null

# Missing backup prerequisites must fail before any source tree or output file
# is removed. The fixture intentionally stops before remotes are configured,
# so no credential-bearing command can be reached.
backup_source_public="$test_root/backup-source-public"
backup_source_private="$test_root/backup-source-private"
backup_output="$test_root/backup-output"
backup_tls="$test_root/backup-tls"
mkdir -p "$backup_source_public" "$backup_source_private" "$backup_output" "$backup_tls"
printf 'backup source public\n' > "$backup_source_public/file.txt"
printf 'backup source private\n' > "$backup_source_private/file.txt"
printf 'backup ca\n' > "$backup_tls/backup-client-ca.crt"
printf 'backup cert\n' > "$backup_tls/backup-client.crt"
printf 'backup key\n' > "$backup_tls/backup-client.key"
chmod 750 "$backup_tls"
chmod 640 "$backup_tls"/*
real_backup_stat="$(command -v stat)"
cat > "$test_root/bin/stat" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *backup-tls) printf '750\n'; exit 0 ;;
  *backup-client-ca.crt|*backup-client.crt|*backup-client.key) printf '640\n'; exit 0 ;;
esac
exec "$REAL_BACKUP_STAT" "$@"
EOF
chmod 700 "$test_root/bin/stat"
export REAL_BACKUP_STAT="$real_backup_stat"
cat > "$test_root/backup-prerequisites.env" <<EOF
DIRECT_URL=postgresql://quest_backup:fixture@127.0.0.1:55432/quest
UPLOAD_ROOT=$backup_source_public
PRIVATE_UPLOAD_ROOT=$backup_source_private
BACKUP_ROOT=$backup_output
BACKUP_AGE_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES17_BIN=$test_root/bin
BACKUP_CLIENT_TLS_DIR=$backup_tls
BACKUP_CLIENT_CERT_FILE=$backup_tls/backup-client.crt
BACKUP_CLIENT_KEY_FILE=$backup_tls/backup-client.key
EOF
chmod 600 "$test_root/backup-prerequisites.env"
source_snapshot="$(sha256sum "$backup_source_public/file.txt" "$backup_source_private/file.txt")"
if PATH="$test_root/bin:$PATH" BACKUP_ENV_FILE="$test_root/backup-prerequisites.env" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/missing-tls.lock" \
    bash "$root/ops/backup-production-multi-remote.sh" --test-fixture \
    >"$test_root/missing-tls.out" 2>&1; then
  echo 'backup accepted missing TLS settings' >&2
  exit 1
fi
grep -F 'Required PostgreSQL TLS material is missing or unsafe: POSTGRES_CA_FILE' "$test_root/missing-tls.out" >/dev/null
! grep -Eq 'postgresql://|fixture' "$test_root/missing-tls.out" >/dev/null
cp "$test_root/backup-prerequisites.env" "$test_root/missing-target.env"
printf 'POSTGRES_CA_FILE=%s\n' "$backup_tls/backup-client-ca.crt" >> "$test_root/missing-target.env"
if PATH="$test_root/bin:$PATH" BACKUP_ENV_FILE="$test_root/missing-target.env" \
    BACKUP_RELEASE_LOCK_PATH="$test_root/missing-target.lock" \
    bash "$root/ops/backup-production-multi-remote.sh" --test-fixture \
    >"$test_root/missing-target.out" 2>&1; then
  echo 'backup accepted missing PostgreSQL target settings' >&2
  exit 1
fi
grep -F 'Explicit PostgreSQL target settings are required.' "$test_root/missing-target.out" >/dev/null
! grep -Eq 'postgresql://|fixture' "$test_root/missing-target.out" >/dev/null
[[ "$source_snapshot" == "$(sha256sum "$backup_source_public/file.txt" "$backup_source_private/file.txt")" ]] || {
  echo 'backup prerequisite refusal changed source data' >&2
  exit 1
}
[[ -z "$(find "$backup_output" -mindepth 1 -print -quit)" ]] || {
  echo 'backup prerequisite refusal created output data' >&2
  exit 1
}

# Refusal assertions must prove that the activation primitive was never
# reached, rather than relying only on rollback leaving identical trees.
real_mv="$(command -v mv)"
activation_counter="$test_root/activation.counter"
: > "$activation_counter"
cat > "$test_root/bin/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$ACTIVATION_COUNTER"
exec "$REAL_MV" "$@"
EOF
chmod 700 "$test_root/bin/mv"
REAL_MV="$real_mv"
ACTIVATION_COUNTER="$activation_counter"
export REAL_MV ACTIVATION_COUNTER

# Restore must not fall back to mutable PostgreSQL clients discovered through PATH.
sed '/^POSTGRES17_BIN=/d' "$test_root/recovery.env" > "$test_root/mutable.env"
if PATH="$test_root/bin:$PATH" RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/mutable.env" RESTORE_COUNTDOWN_SECONDS=0 \
    TEST_ROOT="$test_root" bash "$root/ops/restore-production-backup.sh" --test-fixture \
    "$test_root/quest-production-fixture.tar.gz.enc" >"$test_root/mutable.out" 2>&1; then
  echo "restore accepted mutable PostgreSQL client discovery" >&2
  exit 1
fi
grep -F "Pinned PostgreSQL client is missing or unsafe" "$test_root/mutable.out" >/dev/null
[[ "$(wc -l < "$ACTIVATION_COUNTER" | tr -d ' ')" == 0 ]] || {
  echo "mutable-client refusal reached file activation" >&2
  exit 1
}

# A target sentinel writable by a group or other actor is refused before any
# restore primitive is invoked.
real_stat="$(command -v stat)"
cat > "$test_root/bin/stat" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *target-sentinel.env*) printf '640\n'; exit 0 ;;
esac
exec "$REAL_STAT" "$@"
EOF
chmod 700 "$test_root/bin/stat"
export REAL_STAT="$real_stat"
if PATH="$test_root/bin:$PATH" RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
    BACKUP_ENV_FILE="$test_root/recovery.env" RESTORE_COUNTDOWN_SECONDS=0 \
    TEST_ROOT="$test_root" bash "$root/ops/restore-production-backup.sh" --test-fixture \
    "$test_root/quest-production-fixture.tar.gz.enc" >"$test_root/unsafe-sentinel.out" 2>&1; then
  echo "restore accepted a group-writable target sentinel" >&2
  exit 1
fi
grep -F "target sentinel must be private" "$test_root/unsafe-sentinel.out" >/dev/null
[[ "$(wc -l < "$ACTIVATION_COUNTER" | tr -d ' ')" == 0 ]] || {
  echo "unsafe-sentinel refusal reached file activation" >&2
  exit 1
}
rm -f "$test_root/bin/stat"

# Target binding failures are refused before a destructive restore is allowed.
refused() {
  local label="$1" env_file="$2" output="$test_root/$1.out"
  local restore_count security_count activation_count
  restore_count="$(grep -c -- '--dbname=' "$test_root/pg_restore.log" 2>/dev/null || true)"
  security_count="$(grep -c -- 'RESTORE_MODE=1' "$test_root/psql.log" 2>/dev/null || true)"
  activation_count="$(wc -l < "$ACTIVATION_COUNTER" | tr -d ' ')"
  if PATH="$test_root/bin:$PATH" RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
      BACKUP_ENV_FILE="$env_file" RESTORE_COUNTDOWN_SECONDS=0 \
      TEST_ROOT="$test_root" bash "$root/ops/restore-production-backup.sh" \
      --test-fixture "$test_root/quest-production-fixture.tar.gz.enc" >"$output" 2>&1; then
    echo "restore accepted unsafe target: $label" >&2
    exit 1
  fi
  [[ "$(grep -c -- '--dbname=' "$test_root/pg_restore.log" 2>/dev/null || true)" == "$restore_count" ]] || {
    echo "refused target still invoked destructive pg_restore: $label" >&2
    exit 1
  }
  [[ "$(grep -c -- 'RESTORE_MODE=1' "$test_root/psql.log" 2>/dev/null || true)" == "$security_count" ]] || {
    echo "refused target still invoked security SQL: $label" >&2
    exit 1
  }
  [[ "$(wc -l < "$ACTIVATION_COUNTER" | tr -d ' ')" == "$activation_count" ]] || {
    echo "refused target reached file activation: $label" >&2
    exit 1
  }
  [[ -f "$test_root/public/file.txt" && -f "$test_root/private/file.txt" ]] || {
    echo "refused target changed activated file trees: $label" >&2
    exit 1
  }
}
# Canonical TLS material must not be group/world-writable, and this refusal is
# before any destructive restore, file activation, or security SQL.
cat > "$test_root/bin/stat" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *ca.crt*) printf '666\n'; exit 0 ;;
esac
exec "${REAL_STAT:?}" "$@"
EOF
chmod 700 "$test_root/bin/stat"
refused writable-ca "$test_root/recovery.env"
rm -f "$test_root/bin/stat"
export OBSERVED_SESSION_USER=wrong_restore_role
refused wrong-observed-session-user "$test_root/recovery.env"
unset OBSERVED_SESSION_USER
export OBSERVED_SERVER_ADDR=127.0.0.1
refused wrong-observed-server-local-endpoint "$test_root/recovery.env"
unset OBSERVED_SERVER_ADDR
export OBSERVED_SERVER_PORT=55432
refused wrong-observed-server-port "$test_root/recovery.env"
unset OBSERVED_SERVER_PORT
export OBSERVED_SSL=off
refused wrong-observed-tls "$test_root/recovery.env"
unset OBSERVED_SSL
sed 's/127.0.0.1:55432/10.0.0.7:55432/' "$test_root/recovery.env" > "$test_root/wrong-host.env"
refused wrong-host "$test_root/wrong-host.env"
sed 's/127.0.0.1:55432/127.0.0.1:5432/; s/RESTORE_TARGET_PORT=55432/RESTORE_TARGET_PORT=5432/' "$test_root/recovery.env" > "$test_root/wrong-port.env"
refused wrong-port "$test_root/wrong-port.env"
sed 's/RESTORE_TARGET_MAJOR=17/RESTORE_TARGET_MAJOR=16/' "$test_root/recovery.env" > "$test_root/wrong-major.env"
refused wrong-major "$test_root/wrong-major.env"
sed 's/RESTORE_TARGET_DATABASE=quest_restore/RESTORE_TARGET_DATABASE=wrong_database/' "$test_root/recovery.env" > "$test_root/wrong-database.env"
refused wrong-database "$test_root/wrong-database.env"
sed 's#127.0.0.1:55432/quest_restore#127.0.0.1:55432/quest_restore?sslmode=disable#' "$test_root/recovery.env" > "$test_root/query-override.env"
refused query-override "$test_root/query-override.env"
sed 's/target_kind=disposable_postgresql17/target_kind=postgresql17/' "$test_root/target-sentinel.env" > "$test_root/production-unauthorized-sentinel.env"
chmod 600 "$test_root/production-unauthorized-sentinel.env"
sed 's#target-sentinel.env#production-unauthorized-sentinel.env#' "$test_root/recovery.env" > "$test_root/production-unauthorized.env"
refused production-unauthorized "$test_root/production-unauthorized.env"
printf 'restore schema ownership regression test passed\n'
