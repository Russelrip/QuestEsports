#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
release_script="$script_directory/deploy/release.sh"
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT

assert_failed() {
  local label="$1"; shift
  failure_output="$work_directory/$label.out"
  if "$@" >"$failure_output" 2>&1; then
    printf 'FAIL: %s unexpectedly passed\n' "$label" >&2
    return 1
  fi
}
assert_contains() { grep -Fq -- "$2" "$1" || { printf 'FAIL: %s lacks %s\n' "$1" "$2" >&2; printf '%s\n' '--- log ---' >&2; sed -n '1,120p' "$1" >&2; printf '%s\n' '--- failure output ---' >&2; sed -n '1,120p' "$failure_output" >&2; return 1; }; }

make_executable() { chmod 755 "$1"; }

setup_fixture() {
  local case_name="$1"
  unset WRONG_PROJECT DUPLICATE_ALIASES STALE_BACKUP MIGRATION_PENDING FAIL_QUEST_HEALTH FAIL_VALORANT_HEALTH BAD_VALORANT_HEALTH BAD_VALORANT_DIGEST BAD_MIGRATOR FAIL_WRITER_ENABLE FAIL_START || true
  fixture="$work_directory/$case_name"
  previous_sha=0000000000000000000000000000000000000000
  mkdir -p "$fixture/bin" "$fixture/releases/$previous_sha" "$fixture/uploads" "$fixture/private"
  : > "$fixture/release.lock"
  : > "$fixture/ca.crt"
  cat > "$fixture/valorant.compose.yml" <<'EOF'
name: valorant-prod
services:
  valorant-platform:
    image: ${VALORANT_IMAGE:?required}
EOF
  cp "$script_directory/docker/compose.production.yml" "$fixture/quest.compose.yml"
  cat > "$fixture/releases/$previous_sha/compose.production.yml" <<'EOF'
name: quest-prod
services:
  frontend:
    image: ${QUEST_FRONTEND_IMAGE:?required}
  backend:
    image: ${QUEST_BACKEND_IMAGE:?required}
  postgres:
    image: ${POSTGRES_IMAGE:?required}
EOF
  cat > "$fixture/releases/$previous_sha/valorant.compose.yml" <<'EOF'
name: valorant-prod
services:
  valorant-platform:
    image: ${VALORANT_IMAGE:?required}
EOF
  cat > "$fixture/releases/$previous_sha/.env" <<EOF
QUEST_FRONTEND_IMAGE=ghcr.io/quest/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
QUEST_BACKEND_IMAGE=ghcr.io/quest/backend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
POSTGRES_IMAGE=postgres:17-bookworm@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
VALORANT_IMAGE=ghcr.io/quest/valorant@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
MIGRATOR_IMAGE=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444
EOF
  cat > "$fixture/releases/$previous_sha/release-metadata.txt" <<EOF
commit_sha=$previous_sha
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
EOF
  ln -s "$fixture/releases/$previous_sha" "$fixture/current"

  cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${TEST_LOG:?}"
if [[ "$1" == pull ]]; then printf 'pull %s\n' "$2" >> "$log"; exit 0; fi
if [[ "$1" == network && "$2" == inspect ]]; then
  if [[ "${DUPLICATE_ALIASES:-0}" == 1 ]]; then
    printf 'quest|quest-backend,quest-backend\n'
  else
    printf 'quest|quest-backend,quest-postgres\nvalorant|valorant-platform,valorant-updater,valorant-discord-bot,valorant-name-audit\n'
  fi
  exit 0
fi
[[ "$1" == compose ]] || exit 1
project=""
env_file=""
for ((i=1; i<=$#; i++)); do
  eval "arg=\${$i}"
  if [[ "$arg" == --project-name ]]; then
    j=$((i + 1)); eval "project=\${$j}"
  elif [[ "$arg" == --env-file ]]; then
    j=$((i + 1)); eval "env_file=\${$j}"
  fi
done
if [[ "${WRONG_PROJECT:-0}" == 1 ]]; then project=wrong-project; fi
if [[ " $* " == *' config --images '* ]]; then
  if [[ "$project" == valorant-prod ]]; then
    if [[ "${BAD_VALORANT_DIGEST:-0}" == 1 ]]; then
      printf '%s\n' 'ghcr.io/quest/valorant@sha256:6666666666666666666666666666666666666666666666666666666666666666'
    else
      printf '%s\n' 'ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555'
    fi
  else
    printf '%s\n' \
      'ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111' \
      'ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222' \
      'postgres:17-bookworm@sha256:3333333333333333333333333333333333333333333333333333333333333333'
  fi
elif [[ " $* " == *' config '* ]]; then
  printf 'name: %s\n' "$project"
elif [[ " $* " == *' ps '* ]]; then
  [[ -f "${ACTIVE_MARKER:?}" ]] || exit 0
  printf 'ps project=%s\n' "$project" >> "$log"
  printf '%s\n%s\n' "$project" "$project"
elif [[ " $* " == *' up '* || " $* " == *' down '* || " $* " == *' pull '* ]]; then
  printf 'compose project=%s action=%s' "$project" "$*" >> "$log"
  if [[ -n "$env_file" && -f "$env_file" ]]; then
    printf ' backend=%s' "$(awk -F= '$1 == "QUEST_BACKEND_IMAGE" { print $2 }' "$env_file")" >> "$log"
  fi
  printf '\n' >> "$log"
fi
EOF
  make_executable "$fixture/bin/docker"
  cat > "$fixture/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  make_executable "$fixture/bin/flock"
  cat > "$fixture/bin/realpath" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "$TEST_CURRENT" ]]; then printf '%s\n' "$TEST_PREVIOUS"; else /usr/bin/realpath "$@"; fi
EOF
  make_executable "$fixture/bin/realpath"
  cat > "$fixture/bin/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *' -Tf '* ]]; then
  args=("$@")
  source_path="${args[-2]}"
  target_path="${args[-1]}"
  /usr/bin/rm -rf -- "$target_path"
  /usr/bin/mv -- "$source_path" "$target_path"
else
  exec /usr/bin/mv "$@"
fi
EOF
  make_executable "$fixture/bin/mv"

  cat > "$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${!#}"
if [[ "${FAIL_QUEST_HEALTH:-0}" == 1 && "$url" == *127.0.0.1:5001/api/health/live* ]]; then exit 1; fi
if [[ "${FAIL_VALORANT_HEALTH:-0}" == 1 && "$url" == *valorant-platform* ]]; then exit 1; fi
if [[ "$url" == *valorant-platform* && "${BAD_VALORANT_HEALTH:-0}" == 1 ]]; then printf '{"status":"ok","db":"down"}\n'; exit 0; fi
if [[ "$url" == *valorant-platform* ]]; then printf '{"status":"ok","db":"up"}\n'; exit 0; fi
if [[ "$url" == *ready* ]]; then printf '{"status":"ok","ready":true}\n'; exit 0; fi
printf '{"status":"ok"}\n'
EOF
  make_executable "$fixture/bin/curl"

  cat > "$fixture/bin/status" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$(basename "$0")" in
  migration-status) [[ "${MIGRATION_PENDING:-0}" == 1 ]] && printf 'pending\n' || printf 'none\n' ;;
  db-health|db-ready) printf 'ready\n' ;;
  registry) [[ "${FAIL_REGISTRY:-0}" == 1 ]] && exit 1 || exit 0 ;;
  backup-freshness) [[ "${STALE_BACKUP:-0}" == 1 ]] && exit 1 || { printf 'freshness lock=%s\n' "${BACKUP_RELEASE_LOCK_PATH:?}" >> "$TEST_LOG"; printf 'fresh\n'; } ;;
  backup) printf 'backup lock=%s\n' "${BACKUP_RELEASE_LOCK_PATH:?}" >> "$TEST_LOG"; printf 'backup\n' ;;
  backup-evidence) printf 'verified-complete release_sha=%s schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified\n' "${BACKUP_RELEASE_SHA:?}" ;;
  old-active) printf 'active\n' ;;
  old-stop) printf 'old-stop\n' >> "$TEST_LOG" ;;
  old-restart) printf 'old-restart\n' >> "$TEST_LOG" ;;
  old-mask) printf 'old-mask\n' >> "$TEST_LOG" ;;
  old-unmasked) printf 'unmasked\n' ;;
  old-authoritative) printf 'supabase\n' ;;
  old-application-restart) printf 'old-application-restart\n' >> "$TEST_LOG"; printf 'restarted\n' ;;
  freeze-enable) printf 'freeze-enable\n' >> "$TEST_LOG"; printf 'validation\n' ;;
  freeze-disable) printf 'off\n' ;;
  freeze-status) printf 'acknowledged\n' ;;
  quest-ready|valorant-ready) printf 'ready\n' ;;
  quest-migrate|valorant-migrate) [[ "${BAD_MIGRATOR:-0}" == 1 || "${MIGRATOR_IMAGE:-}" != "${EXPECTED_MIGRATOR_IMAGE:-}" ]] && exit 1; printf 'migrated image=%s\n' "${MIGRATOR_IMAGE:?}" ;;
  writer-enable) [[ "${FAIL_WRITER_ENABLE:-0}" == 1 ]] && exit 1 || printf 'admitted\n' ;;
  candidate-start) printf 'candidate-start freeze=%s readonly=%s\n' "$4" "$6" >> "$TEST_LOG"; [[ "${FAIL_START:-0}" == 1 ]] && exit 1; : > "${ACTIVE_MARKER:?}"; printf 'started-frozen-read-only\n' ;;
  writer-stop) printf 'stopped\n' ;;
  capture) printf 'captured\n' ;;
  recovery-action) printf 'fix-forward\n' ;;
  *) exit 1 ;;
esac
EOF
  for command_name in db-health db-ready registry backup-freshness backup backup-evidence migration-status old-active old-stop old-restart old-application-restart old-mask old-unmasked old-authoritative freeze-enable freeze-disable freeze-status quest-ready valorant-ready quest-migrate valorant-migrate writer-enable candidate-start writer-stop capture recovery-action; do
    cp "$fixture/bin/status" "$fixture/bin/$command_name"
    make_executable "$fixture/bin/$command_name"
  done

  cat > "$fixture/release.env" <<EOF
QUEST_DEPLOY_FIXTURE=1
RELEASE_ROOT=$fixture
RELEASES_ROOT=$fixture/releases
CURRENT_LINK=$fixture/current
RELEASE_LOCK_PATH=$fixture/release.lock
QUEST_COMPOSE_TEMPLATE=$fixture/quest.compose.yml
VALORANT_COMPOSE_SOURCE=$fixture/valorant.compose.yml
DOCKER_BIN=$fixture/bin/docker
DATABASE_HEALTH_COMMAND=$fixture/bin/db-health
DATABASE_READINESS_COMMAND=$fixture/bin/db-ready
REGISTRY_CHECK_COMMAND=$fixture/bin/registry
BACKUP_FRESHNESS_COMMAND=$fixture/bin/backup-freshness
BACKUP_COMMAND=$fixture/bin/backup
BACKUP_EVIDENCE_COMMAND=$fixture/bin/backup-evidence
QUEST_MIGRATION_STATUS_COMMAND=$fixture/bin/migration-status
VALORANT_MIGRATION_STATUS_COMMAND=$fixture/bin/migration-status
QUEST_MIGRATOR_COMMAND=$fixture/bin/quest-migrate
VALORANT_MIGRATOR_COMMAND=$fixture/bin/valorant-migrate
OLD_VALORANT_ACTIVE_CHECK=$fixture/bin/old-active
OLD_VALORANT_STOP_COMMAND=$fixture/bin/old-stop
OLD_VALORANT_RESTART_COMMAND=$fixture/bin/old-restart
OLD_VALORANT_MASK_COMMAND=$fixture/bin/old-mask
OLD_VALORANT_UNMASKED_CHECK=$fixture/bin/old-unmasked
OLD_DATABASE_AUTHORITATIVE_COMMAND=$fixture/bin/old-authoritative
OLD_APPLICATION_RESTART_COMMAND=$fixture/bin/old-application-restart
FREEZE_ENABLE_COMMAND=$fixture/bin/freeze-enable
FREEZE_DISABLE_COMMAND=$fixture/bin/freeze-disable
FREEZE_STATUS_COMMAND=$fixture/bin/freeze-status
QUEST_HEALTH_URL=http://127.0.0.1:5001/api/health/live
QUEST_READINESS_URL=http://127.0.0.1:5001/api/health/ready
VALORANT_HEALTH_URL=https://valorant-platform:8000/api/v1/health
VALORANT_CA_FILE=$fixture/ca.crt
CURL_BIN=$fixture/bin/curl
QUEST_READINESS_ACK_COMMAND=$fixture/bin/quest-ready
VALORANT_READINESS_ACK_COMMAND=$fixture/bin/valorant-ready
CANDIDATE_FROZEN_START_COMMAND=$fixture/bin/candidate-start
CANDIDATE_START_CONTRACT=frozen-read-only
CANDIDATE_FREEZE_FLAG=--write-freeze=validation
CANDIDATE_READ_ONLY_FLAG=--read-only
WRITER_ENABLE_COMMAND=$fixture/bin/writer-enable
WRITER_STOP_COMMAND=$fixture/bin/writer-stop
CURRENT_STATE_CAPTURE_COMMAND=$fixture/bin/capture
RECOVERY_ACTION_COMMAND=$fixture/bin/recovery-action
RELEASE_MIN_FREE_KB=1
EOF
  export QUEST_DEPLOY_FIXTURE=1 RELEASE_ENV_FILE="$fixture/release.env" RELEASE_LOCK_PATH="$fixture/release.lock" TEST_LOG="$fixture/commands.log" TEST_CURRENT="$fixture/current" TEST_PREVIOUS="$fixture/releases/$previous_sha" ACTIVE_MARKER="$fixture/active.marker"
  : > "$TEST_LOG"
  export PATH="$fixture/bin:$PATH"
  cat > "$fixture/manifest.txt" <<'EOF'
commit_sha=1111111111111111111111111111111111111111
frontend_image=ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111
backend_image=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222
migrator_image=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444
postgres_image=postgres:17-bookworm@sha256:3333333333333333333333333333333333333333333333333333333333333333
valorant_image=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555
EOF
}

run_release() { bash "$release_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"; }

setup_fixture invalid-sha
assert_failed invalid-sha env RELEASE_ENV_FILE="$RELEASE_ENV_FILE" bash "$release_script" not-a-full-sha "$fixture/manifest.txt"

setup_fixture missing-digest
sed -i '/^migrator_image=/d' "$fixture/manifest.txt"
assert_failed missing-digest run_release

setup_fixture wrong-project
export WRONG_PROJECT=1
assert_failed wrong-project run_release

setup_fixture duplicate-alias
export DUPLICATE_ALIASES=1
assert_failed duplicate-alias run_release

setup_fixture stale-backup
export STALE_BACKUP=1
assert_failed stale-backup run_release

setup_fixture pending-without-approval
export MIGRATION_PENDING=1
assert_failed pending-without-approval run_release

setup_fixture failed-readiness
export FAIL_QUEST_HEALTH=1
assert_failed failed-readiness run_release
assert_contains "$TEST_LOG" 'old-application-restart'

setup_fixture failed-valorant-health
export BAD_VALORANT_HEALTH=1
assert_failed failed-valorant-health run_release

setup_fixture explicit-precommit-rollback
rollback_sha=2222222222222222222222222222222222222222
rollback_fixture="$fixture/releases/$rollback_sha"
mkdir -p "$rollback_fixture"
cp "$fixture/releases/$previous_sha/compose.production.yml" "$rollback_fixture/compose.production.yml"
cp "$fixture/releases/$previous_sha/valorant.compose.yml" "$rollback_fixture/valorant.compose.yml"
cp "$fixture/releases/$previous_sha/.env" "$rollback_fixture/.env"
cat > "$rollback_fixture/release-metadata.txt" <<EOF
commit_sha=$rollback_sha
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
EOF
export OLD_VALORANT_WAS_STOPPED=1
bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture" >/dev/null
assert_contains "$TEST_LOG" 'old-application-restart'

setup_fixture unsafe-rollback-path
unsafe_rollback="$fixture/releases/$rollback_sha/../$previous_sha"
assert_failed unsafe-rollback-path bash "$script_directory/deploy/rollback.sh" pre-commit "$unsafe_rollback"

setup_fixture valorant-digest-mismatch
export BAD_VALORANT_DIGEST=1
assert_failed valorant-digest-mismatch run_release

setup_fixture migrator-digest-mismatch
export MIGRATION_PENDING=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export BAD_MIGRATOR=1
assert_failed migrator-digest-mismatch run_release

setup_fixture successful-approved-release
export MIGRATION_PENDING=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
run_release >/dev/null
assert_contains "$TEST_LOG" 'candidate-start freeze=--write-freeze=validation readonly=--read-only'
assert_contains "$TEST_LOG" 'freshness lock=/proc/self/fd/9'
assert_contains "$TEST_LOG" 'backup lock=/proc/self/fd/9'
assert_contains "$TEST_LOG" 'old-mask'
[[ "$(grep -n 'freeze-enable' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -n 'old-stop' "$TEST_LOG" | cut -d: -f1)" ]] || { printf 'FAIL: freeze did not precede old VALORANT stop\n' >&2; exit 1; }
[[ "$(grep -n 'old-stop' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -n 'candidate-start' "$TEST_LOG" | cut -d: -f1)" ]] || { printf 'FAIL: old VALORANT stop did not precede candidate start\n' >&2; exit 1; }

setup_fixture empty-candidate-before-start
export FAIL_START=1
assert_failed empty-candidate-before-start run_release
if grep -Fq 'ps project=' "$TEST_LOG"; then
  printf 'FAIL: active cardinality was checked before candidate start\n' >&2
  exit 1
fi

setup_fixture admission-failure-before-mask
export FAIL_WRITER_ENABLE=1
assert_failed admission-failure-before-mask run_release
if grep -Fq 'old-mask' "$TEST_LOG"; then
  printf 'FAIL: old VALORANT units were masked before writer admission\n' >&2
  exit 1
fi

setup_fixture post-commit-boundary
export ROLLBACK_RELEASE_DIR="$fixture/releases/$previous_sha" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
bash "$script_directory/deploy/rollback.sh" post-commit >/dev/null
assert_contains "$TEST_LOG" 'freeze-enable'

setup_fixture fixed-projects
run_release >/dev/null
assert_contains "$TEST_LOG" 'project=quest-prod'
assert_contains "$TEST_LOG" 'project=valorant-prod'
[[ -e "$fixture/current" ]] || { printf 'FAIL: current pointer was not retained\n' >&2; exit 1; }
export TEST_PREVIOUS="$fixture/releases/1111111111111111111111111111111111111111"
bash "$script_directory/deploy/verify-release.sh" >/dev/null
metadata_backup="$fixture/release-metadata.good"
cp "$TEST_PREVIOUS/release-metadata.txt" "$metadata_backup"
printf '%s\n' 'unexpected=metadata' >> "$TEST_PREVIOUS/release-metadata.txt"
assert_failed malformed-metadata bash "$script_directory/deploy/verify-release.sh"
mv "$metadata_backup" "$TEST_PREVIOUS/release-metadata.txt"

printf '%s\n' 'deploy release fixture tests passed'
