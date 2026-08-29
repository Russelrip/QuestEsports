#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/quest-restore-test.XXXXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/public" "$test_root/private"
printf 'fixture identity\n' > "$test_root/identity"
printf 'fixture ca\n' > "$test_root/ca.crt"
chmod 600 "$test_root/identity" "$test_root/ca.crt"
printf 'encrypted fixture\n' > "$test_root/quest-production-fixture.tar.gz.enc"
printf 'checksum\n' > "$test_root/quest-production-fixture.tar.gz.enc.sha256"

cat > "$test_root/recovery.env" <<EOF
POSTGRES17_BIN=$test_root/bin
POSTGRES_CA_FILE=$test_root/ca.crt
DIRECT_URL=postgresql://restore:fixture@127.0.0.1:55432/quest_restore?sslmode=verify-full
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

cat > "$test_root/bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == --check ]] && exit 0
exit 1
EOF

cat > "$test_root/bin/tar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --list ]]; then
  printf '%s\n' public/ public/poster-images/ private/ private/event-album-originals/ database.dump manifest.txt
  exit 0
fi
directory=''
for argument in "$@"; do
  [[ "$argument" == --directory=* ]] && directory="${argument#--directory=}"
done
mkdir -p "$directory/public/poster-images" "$directory/private/event-album-originals"
printf 'fixture public file\n' > "$directory/public/file.txt"
printf 'fixture private file\n' > "$directory/private/file.txt"
printf 'fixture dump\n' > "$directory/database.dump"
printf 'database_scope=application_public_and_valorant_schemas\nvalorant_schema_included=true\npublic_upload_root=%s\nprivate_upload_root=%s\npublic_event_album_preview_root=%s\nprivate_event_album_original_root=%s\n' \
  "$TEST_ROOT/public" "$TEST_ROOT/private" "$TEST_ROOT/public/poster-images" "$TEST_ROOT/private/event-album-originals" > "$directory/manifest.txt"
EOF

cat > "$test_root/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
  printf 'pg_restore (PostgreSQL) 17.4\n'
  exit 0
fi
printf '%s\n' "pg_restore $*" >> "$TEST_ROOT/pg_restore.log"
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
  printf 'quest_restore|170004|on|127.0.0.1|55432|quest-restore-target\n'
  exit 0
fi
for ((index = 1; index <= $#; index++)); do
  if [[ "${!index}" == -f ]]; then
    next=$((index + 1))
    cat "${!next}" >> "$TEST_ROOT/psql.log"
  fi
done
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
  QUEST_RESTORE_FIXTURE=1 \
  TEST_ROOT="$test_root" \
  bash "$root/ops/restore-production-backup.sh" \
  "$test_root/quest-production-fixture.tar.gz.enc" >/dev/null

grep -F -- '--no-owner' "$test_root/pg_restore.log" >/dev/null
grep -F -- '--no-acl' "$test_root/pg_restore.log" >/dev/null
grep -F -- '-v RESTORE_MODE=1' "$test_root/psql.log" >/dev/null
grep -F -- "REVOKE ALL ON DATABASE %I FROM PUBLIC" "$test_root/psql.log" >/dev/null
grep -F -- "GRANT CONNECT ON DATABASE %I TO quest_migrator, quest_runtime, val_migrator, val_runtime" "$test_root/psql.log" >/dev/null
grep -F -- 'current_database()' "$test_root/psql.log" >/dev/null
grep -F -- 'REVOKE ALL ON DATABASE quest FROM PUBLIC' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER ROLE quest_runtime LOGIN NOINHERIT' "$test_root/psql.log" >/dev/null
grep -F -- 'FROM pg_auth_members' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER SCHEMA public OWNER TO quest_migrator' "$test_root/psql.log" >/dev/null
grep -F -- 'ALTER SCHEMA valorant OWNER TO val_migrator' "$test_root/psql.log" >/dev/null
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

# Target binding failures are refused before a destructive restore is allowed.
refused() {
  local label="$1" env_file="$2" output="$test_root/$1.out"
  if PATH="$test_root/bin:$PATH" RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
      BACKUP_ENV_FILE="$env_file" RESTORE_COUNTDOWN_SECONDS=0 QUEST_RESTORE_FIXTURE=1 \
      TEST_ROOT="$test_root" bash "$root/ops/restore-production-backup.sh" \
      "$test_root/quest-production-fixture.tar.gz.enc" >"$output" 2>&1; then
    echo "restore accepted unsafe target: $label" >&2
    exit 1
  fi
}
sed 's/127.0.0.1:55432/10.0.0.7:55432/' "$test_root/recovery.env" > "$test_root/wrong-host.env"
refused wrong-host "$test_root/wrong-host.env"
sed 's/127.0.0.1:55432/127.0.0.1:5432/; s/RESTORE_TARGET_PORT=55432/RESTORE_TARGET_PORT=5432/' "$test_root/recovery.env" > "$test_root/wrong-port.env"
refused wrong-port "$test_root/wrong-port.env"
sed 's/RESTORE_TARGET_MAJOR=17/RESTORE_TARGET_MAJOR=16/' "$test_root/recovery.env" > "$test_root/wrong-major.env"
refused wrong-major "$test_root/wrong-major.env"
sed 's/RESTORE_TARGET_DATABASE=quest_restore/RESTORE_TARGET_DATABASE=wrong_database/' "$test_root/recovery.env" > "$test_root/wrong-database.env"
refused wrong-database "$test_root/wrong-database.env"
sed 's/target_kind=disposable_postgresql17/target_kind=postgresql17/' "$test_root/target-sentinel.env" > "$test_root/production-unauthorized-sentinel.env"
chmod 600 "$test_root/production-unauthorized-sentinel.env"
sed 's#target-sentinel.env#production-unauthorized-sentinel.env#' "$test_root/recovery.env" > "$test_root/production-unauthorized.env"
refused production-unauthorized "$test_root/production-unauthorized.env"
printf 'restore schema ownership regression test passed\n'
