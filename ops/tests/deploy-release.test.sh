#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
release_script="$script_directory/deploy/release.sh"
cutover_script="$script_directory/deploy/cutover.sh"
host_validation_script="$script_directory/deploy/validate-host.sh"
workflow_file="$script_directory/../.github/workflows/build-container-images.yml"
deploy_workflow_file="$script_directory/../.github/workflows/deploy-compose.yml"
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT
base_path="$PATH"

assert_failed() {
  local label="$1"; shift
  failure_output="$work_directory/$label.out"
  if "$@" >"$failure_output" 2>&1; then
    printf 'FAIL: %s unexpectedly passed\n' "$label" >&2
    return 1
  fi
}
assert_contains() { grep -Fq -- "$2" "$1" || { printf 'FAIL: %s lacks %s\n' "$1" "$2" >&2; printf '%s\n' '--- log ---' >&2; sed -n '1,120p' "$1" >&2; printf '%s\n' '--- failure output ---' >&2; sed -n '1,120p' "$failure_output" >&2; return 1; }; }
new_gate_failures=0
gate_failure() { printf 'FAIL: %s\n' "$1" >&2; new_gate_failures=$((new_gate_failures + 1)); }
gate_log_contains() { grep -Fq -- "$2" "$1" || gate_failure "$3"; }
gate_log_exact() { grep -Fxq -- "$2" "$1" || gate_failure "$3"; }
gate_log_not_contains() { grep -Fq -- "$2" "$1" && gate_failure "$3" || true; }
gate_file_contains() { [[ -f "$1" ]] && grep -Fq -- "$2" "$1" || gate_failure "$3"; }
gate_log_before() {
  local log_file="$1" before="$2" after="$3" label="$4" before_line after_line
  before_line="$(grep -nF -- "$before" "$log_file" | cut -d: -f1 | head -n1 || true)"
  after_line="$(grep -nF -- "$after" "$log_file" | cut -d: -f1 | head -n1 || true)"
  [[ -n "$before_line" && -n "$after_line" && "$before_line" -lt "$after_line" ]] || gate_failure "$label"
}

make_executable() { chmod 755 "$1"; }

setup_fixture() {
  local case_name="$1"
  unset BAD_VALORANT_ALIASES QUEST_DEPLOY_FIXTURE_ENFORCE_BACKUP_CA_CHAIN || true
  unset BACKUP_CLIENT_DIR_MODE || true
  unset WRONG_PROJECT DUPLICATE_ALIASES BAD_ALIAS_BINDING FAIL_SERVICE_OWNERSHIP FAIL_CAPTURE STALE_BACKUP INCOMPLETE_BACKUP FAIL_FREEZE FAIL_QUEST_FREEZE FAIL_VALORANT_FREEZE FAIL_SECURITY_VERIFY MIGRATION_PENDING FAIL_QUEST_HEALTH FAIL_VALORANT_HEALTH BAD_VALORANT_HEALTH BAD_VALORANT_DIGEST BAD_MIGRATOR FAIL_REGISTRY FAIL_QUEST_WRITER_ENABLE FAIL_VALORANT_WRITER_ENABLE FAIL_WRITER_ENABLE FAIL_START FAIL_QUEST_CANDIDATE_START FAIL_VALORANT_CANDIDATE_START FAIL_QUEST_WRITER_STOP FAIL_VALORANT_WRITER_STOP FAIL_OLD_QUEST_STOP FAIL_OLD_VALORANT_STOP FAIL_REBOOT_PERSISTENCE BAD_LEGACY_STATE DATABASE_AUTHORITY REQUIRE_ARTIFACT_TRUST_POLICY REQUIRE_MIGRATION_RECHECK TARGET_ACK_MODE TARGET_ACK_LIES TOPOLOGY_STRUCTURED TOPOLOGY_STALE TOPOLOGY_MISSING BACKUP_APPROVAL QUEST_MIGRATION_OWNER_APPROVAL_SHA VALORANT_MIGRATION_OWNER_APPROVAL_SHA OLD_VALORANT_WAS_STOPPED ROLLBACK_RELEASE_DIR EXPECTED_LOSS_RPO INCIDENT_OWNER_APPROVAL SUPABASE_RECONCILIATION_DECISION SUPABASE_URL_ROLLBACK_COMMAND TRY_SUPABASE_URL_ROLLBACK DATABASE_URL DIRECT_URL SENTINEL_FAIL SENTINEL_MALFORMED SENTINEL_MISMATCH SENTINEL_WRITABLE TLS_KEY_WORLD_READABLE QUEST_DEPLOY_FIXTURE_ENFORCE_TLS_OWNERSHIP FAIL_QUEST_URL_SWITCH FAIL_VALORANT_URL_SWITCH NOOP_VALORANT_URL_SWITCH FAIL_QUEST_SERVICE_RESTART FAIL_VALORANT_SERVICE_RESTART FAIL_QUEST_READINESS_ACK FAIL_VALORANT_READINESS_ACK FAIL_QUEST_FROZEN_ACK FAIL_VALORANT_FROZEN_ACK FAIL_QUEST_URL_EFFECTIVE FAIL_VALORANT_URL_EFFECTIVE || true
  fixture="$work_directory/$case_name"
  previous_sha=0000000000000000000000000000000000000000
  mkdir -p "$fixture/bin" "$fixture/releases/$previous_sha" "$fixture/uploads" "$fixture/private" "$fixture/postgres/17/data"
  : > "$fixture/release.lock"
  printf '%s\n' fixture-ca > "$fixture/ca.crt"
  printf '%s\n' fixture-cert > "$fixture/postgres.crt"
  printf '%s\n' fixture-key > "$fixture/postgres.key"
  printf '%s\n' fixture-backup-cert > "$fixture/backup-client.crt"
  printf '%s\n' fixture-backup-key > "$fixture/backup-client.key"
  mkdir -p "$fixture/backup-client"
  printf '%s\n' fixture-backup-ca > "$fixture/backup-client/backup-client-ca.crt"
  mv "$fixture/backup-client.crt" "$fixture/backup-client/backup-client.crt"
  mv "$fixture/backup-client.key" "$fixture/backup-client/backup-client.key"
  printf '%s\n' fixture-alternate-key > "$fixture/alternate.key"
  printf '%s\n' 'postgresql://quest_recovery_admin:fixture@quest-postgres:5432/quest?sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt' > "$fixture/recovery-admin-url"
  printf '%s\n' 'postgresql://quest_migrator:fixture@quest-postgres:5432/quest' > "$fixture/quest-migrator-url"
  printf '%s\n' 'postgresql://val_migrator:fixture@quest-postgres:5432/quest' > "$fixture/valorant-migrator-url"
  printf '%s\n' fixture-alternate-cert > "$fixture/alternate.crt"
  chmod 644 "$fixture/ca.crt" "$fixture/postgres.crt" "$fixture/alternate.crt"
  chmod 600 "$fixture/postgres.key"
  chmod 750 "$fixture/backup-client"
  chmod 640 "$fixture/backup-client/backup-client-ca.crt" "$fixture/backup-client/backup-client.crt" "$fixture/backup-client/backup-client.key"
  chmod 600 "$fixture/alternate.key"
  : > "$fixture/current-supabase.env"
  cat > "$fixture/quest.production.env" <<'EOF'
DATABASE_URL=postgresql://quest_runtime:fixture@db.supabase.test:5432/quest?schema=public&sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt
DIRECT_URL=postgresql://quest_runtime:fixture@db.supabase.test:5432/quest?schema=public&sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt
EOF
  cat > "$fixture/valorant.production.env" <<'EOF'
DATABASE_URL=postgresql+asyncpg://val_runtime:fixture@db.supabase.test:5432/quest?ssl=require
DIRECT_URL=postgresql+asyncpg://val_runtime:fixture@db.supabase.test:5432/quest?ssl=require
VALORANT_DATABASE_SSL_CA_FILE=/run/secrets/quest-private-ca.crt
VALORANT_DATABASE_SSL_SERVER_HOSTNAME=quest-postgres
VALORANT_DATABASE_SSL_VERIFY=full
EOF
  chmod 600 "$fixture/quest.production.env" "$fixture/valorant.production.env" "$fixture/recovery-admin-url" "$fixture/quest-migrator-url" "$fixture/valorant-migrator-url"
  printf '%s\n' active > "$fixture/old-quest.state"
  printf '%s\n' active > "$fixture/old-valorant.state"
  printf '%s\n' unmasked > "$fixture/old-valorant.persistence"
  printf '%s\n' unmasked > "$fixture/old-quest.persistence"
  cat > "$fixture/valorant.compose.yml" <<'EOF'
name: valorant-prod
services:
  valorant-platform:
    image: ${VALORANT_IMAGE:?required}
    env_file:
      - path: /etc/quest-esports/valorant.production.env
        required: true
    environment:
      VALORANT_DATABASE_SSL_CA_FILE: /run/secrets/quest-private-ca.crt
      VALORANT_DATABASE_SSL_SERVER_HOSTNAME: quest-postgres
      VALORANT_DATABASE_SSL_VERIFY: full
    volumes:
      - /etc/quest-esports/tls/quest-private-ca.crt:/run/secrets/quest-private-ca.crt:ro
    networks:
      quest-shared:
        aliases:
          - valorant-platform
          - valorant-updater
          - valorant-discord-bot
          - valorant-name-audit
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
    env_file:
      - path: /etc/quest-esports/valorant.production.env
        required: true
    environment:
      VALORANT_DATABASE_SSL_CA_FILE: /run/secrets/quest-private-ca.crt
      VALORANT_DATABASE_SSL_SERVER_HOSTNAME: quest-postgres
      VALORANT_DATABASE_SSL_VERIFY: full
    volumes:
      - /etc/quest-esports/tls/quest-private-ca.crt:/run/secrets/quest-private-ca.crt:ro
    networks:
      quest-shared:
        aliases:
          - valorant-platform
          - valorant-updater
          - valorant-discord-bot
          - valorant-name-audit
EOF
  cat > "$fixture/releases/$previous_sha/.env" <<EOF
QUEST_FRONTEND_IMAGE=ghcr.io/quest/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
QUEST_BACKEND_IMAGE=ghcr.io/quest/backend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
POSTGRES_IMAGE=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
VALORANT_IMAGE=ghcr.io/quest/valorant@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
MIGRATOR_IMAGE=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444
EOF
  cat > "$fixture/releases/$previous_sha/release-metadata.txt" <<EOF
commit_sha=$previous_sha
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
cutover_type=steady-state
EOF
  cat > "$fixture/releases/$previous_sha/commit-point.txt" <<EOF
writer_admission_starting=true
commit_sha=$previous_sha
commit_point_utc=not-recorded
quest_writer_admission_started=false
quest_writer_admitted=false
quest_writer_ack_utc=not-recorded
valorant_writer_admission_started=false
valorant_writer_admitted=false
valorant_writer_ack_utc=not-recorded
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
cutover_type=steady-state
quest_project=quest-prod
valorant_project=valorant-prod
shared_network=quest-shared
EOF
  ln -s "$fixture/releases/$previous_sha" "$fixture/current"

  cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${TEST_LOG:?}"
if [[ "$1" == pull ]]; then printf 'pull %s\n' "$2" >> "$log"; exit 0; fi
if [[ "$1" == info ]]; then exit 0; fi
VALORANT_IMAGE_DIGEST=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555
QUEST_BACKEND_DIGEST=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222
POSTGRES_DIGEST=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
# Docker 29 dropped Aliases from `network inspect`, so the shared network only
# lists container names and each container reports its own aliases.
if [[ "$1" == network && "$2" == inspect ]]; then
  printf 'quest-backend-1\nquest-postgres-1\nvalorant-platform-1\n'
  if [[ "${DUPLICATE_ALIASES:-0}" == 1 ]]; then printf 'quest-backend-clone-1\n'; fi
  if [[ "${VERIFY_STEADY_STATE:-0}" == 1 ]]; then printf 'valorant-updater-1\nvalorant-discord-bot-1\n'; fi
  exit 0
fi
if [[ "$1" == inspect ]]; then
  case "$2" in
    quest-backend-1)
      if [[ "${BAD_ALIAS_BINDING:-0}" == 1 ]]; then
        printf 'valorant-prod|valorant-platform|%s|quest-backend-1,backend,quest-backend\n' "$VALORANT_IMAGE_DIGEST"
      else
        printf 'quest-prod|backend|%s|quest-backend-1,backend,quest-backend\n' "$QUEST_BACKEND_DIGEST"
      fi ;;
    quest-backend-clone-1) printf 'quest-prod|backend|%s|quest-backend-clone-1,quest-backend\n' "$QUEST_BACKEND_DIGEST" ;;
    quest-postgres-1) printf 'quest-prod|postgres|%s|quest-postgres-1,postgres,quest-postgres\n' "$POSTGRES_DIGEST" ;;
    valorant-platform-1) printf 'valorant-prod|valorant-platform|%s|valorant-platform-1,valorant-platform,valorant-updater,valorant-discord-bot,valorant-name-audit\n' "$VALORANT_IMAGE_DIGEST" ;;
    valorant-updater-1) printf 'valorant-prod|valorant-updater|%s|valorant-updater-1,valorant-updater\n' "$VALORANT_IMAGE_DIGEST" ;;
    valorant-discord-bot-1) printf 'valorant-prod|valorant-discord-bot|%s|valorant-discord-bot-1,valorant-discord-bot\n' "$VALORANT_IMAGE_DIGEST" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
[[ "$1" == compose ]] || exit 1
project=""
env_file=""
compose_file=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  arg="${args[$i]}"
  if [[ "$arg" == --project-name ]]; then
    project="${args[$((i + 1))]}"
  elif [[ "$arg" == --env-file ]]; then
    env_file="${args[$((i + 1))]}"
  elif [[ "$arg" == -f ]]; then
    compose_file="${args[$((i + 1))]}"
  fi
done
if [[ -n "$env_file" && -f "$env_file" ]]; then
  set -a
  source "$env_file"
  set +a
fi
if [[ "${WRONG_PROJECT:-0}" == 1 ]]; then project=wrong-project; fi
if [[ " $* " == *' config --images '* ]]; then
  printf 'compose project=%s action=config-images\n' "$project" >> "$log"
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
      'postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
  fi
elif [[ " $* " == *' config --no-env-resolution --format json '* || " $* " == *' config --no-env-resolution --format json' ]]; then
  printf 'compose project=%s action=config-json\n' "$project" >> "$log"
  if [[ "$project" == valorant-prod ]]; then
    if [[ -f "$compose_file" ]] && grep -Fq 'VALORANT_DATABASE_SSL_VERIFY' "$compose_file" && ! grep -Eq 'sslmode=|sslrootcert=' "$compose_file"; then
      alias_name=valorant-name-audit
      [[ "${BAD_VALORANT_ALIASES:-0}" == 1 ]] && alias_name=valorant-altered
      [[ "${BAD_VALORANT_ALIASES:-0}" == missing ]] && alias_name=''
      python3 - "${VALORANT_IMAGE:?required}" "$alias_name" <<'PY'
import json
import sys
aliases = ["valorant-platform", "valorant-updater", "valorant-discord-bot", sys.argv[2]]
print(json.dumps({"name": "valorant-prod", "services": {"valorant-platform": {"image": sys.argv[1], "env_file": [{"path": "/etc/quest-esports/valorant.production.env", "required": True}], "environment": {"VALORANT_DATABASE_SSL_CA_FILE": "/run/secrets/quest-private-ca.crt", "VALORANT_DATABASE_SSL_SERVER_HOSTNAME": "quest-postgres", "VALORANT_DATABASE_SSL_VERIFY": "full"}, "volumes": [{"type": "bind", "source": "/etc/quest-esports/tls/quest-private-ca.crt", "target": "/run/secrets/quest-private-ca.crt", "read_only": True}], "networks": {"quest-shared": {"aliases": aliases}}}}, "networks": {"quest-shared": {"name": "quest-shared", "external": True}}}))
PY
      exit 0
    else
      printf '{}\n'
    fi
  else
    printf '{"name":"%s","services":{},"networks":{}}\n' "$project"
  fi
elif [[ " $* " == *' config '* ]]; then
  printf 'compose project=%s action=config\n' "$project" >> "$log"
  printf 'name: %s\n' "$project"
elif [[ " $* " == *' ps '* ]]; then
  [[ -f "${ACTIVE_MARKER:?}" ]] || exit 0
  printf 'ps project=%s\n' "$project" >> "$log"
  if [[ "${TOPOLOGY_STRUCTURED:-1}" == 1 ]]; then
    if [[ "$project" == quest-prod ]]; then
      if [[ "${TOPOLOGY_MISSING:-0}" != 1 ]]; then
        printf '%s\n' '{"Name":"quest-frontend-1","Service":"frontend","State":"running","Image":"ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111","Project":"quest-prod"}'
      fi
      backend_state=running
      backend_image=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222
      if [[ "${TOPOLOGY_STALE:-0}" == 1 ]]; then
        backend_state=exited
        backend_image=ghcr.io/quest/backend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      fi
      printf '{"Name":"quest-backend-1","Service":"backend","State":"%s","Image":"%s","Project":"quest-prod"}\n' "$backend_state" "$backend_image"
      if [[ "${TOPOLOGY_MISSING:-0}" != 1 ]]; then
        printf '%s\n' '{"Name":"quest-postgres-1","Service":"postgres","State":"running","Image":"postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0","Project":"quest-prod"}'
      fi
      [[ "${TOPOLOGY_STALE:-0}" == 1 ]] && printf '%s\n' '{"Name":"quest-old-worker-1","Service":"old-worker","State":"running","Image":"ghcr.io/quest/old@sha256:9999999999999999999999999999999999999999999999999999999999999999","Project":"quest-prod"}' || true
    else
      printf '%s\n' '{"Name":"valorant-platform-1","Service":"valorant-platform","State":"running","Image":"ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555","Project":"valorant-prod"}'
      # release.sh validates the topology while the writers are still frozen;
      # verify-release.sh validates the admitted steady state, where both
      # long-lived writers run and the one-shot name audit has exited.
      if [[ "${VERIFY_STEADY_STATE:-0}" == 1 ]]; then
        printf '{"Name":"valorant-updater-1","Service":"valorant-updater","State":"running","Image":"%s","Project":"valorant-prod"}
' "$VALORANT_IMAGE_DIGEST"
        printf '{"Name":"valorant-discord-bot-1","Service":"valorant-discord-bot","State":"running","Image":"%s","Project":"valorant-prod"}
' "$VALORANT_IMAGE_DIGEST"
        printf '{"Name":"valorant-name-audit-1","Service":"valorant-name-audit","State":"exited","Image":"%s","Project":"valorant-prod"}
' "$VALORANT_IMAGE_DIGEST"
      fi
      [[ "${TOPOLOGY_STALE:-0}" == 1 ]] && printf '%s\n' '{"Name":"valorant-old-1","Service":"old-platform","State":"running","Image":"ghcr.io/quest/valorant-old@sha256:9999999999999999999999999999999999999999999999999999999999999999","Project":"valorant-prod"}' || true
    fi
  else
    printf '%s\n%s\n' "$project" "$project"
  fi
elif [[ " $* " == *' up '* || " $* " == *' down '* || " $* " == *' pull '* ]]; then
  printf 'compose project=%s action=%s' "$project" "$*" >> "$log"
  if [[ -n "$env_file" && -f "$env_file" ]]; then
    printf ' backend=%s' "$(awk -F= '$1 == "QUEST_BACKEND_IMAGE" { print $2 }' "$env_file")" >> "$log"
  fi
  printf '\n' >> "$log"
fi
EOF
  make_executable "$fixture/bin/docker"
  cat > "$fixture/bin/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${SENTINEL_WRITABLE:-0}" == 1 && "$1" == -c && "$2" == %a && "$3" == *postgres-target ]]; then
  printf '%s\n' 777
  exit 0
fi
if [[ "${TLS_KEY_WORLD_READABLE:-0}" == 1 && "$1" == -c && "$2" == %a && "$*" == *postgres.key* ]]; then
  printf '%s\n' 644
  exit 0
fi
if [[ "$1" == -c && "$2" == %a && "$3" == *backup-client && "$3" != *backup-client.crt && "$3" != *backup-client.key ]]; then
  printf '%s\n' "${BACKUP_CLIENT_DIR_MODE:-750}"
  exit 0
fi
if [[ "$1" == -c && "$2" == %a ]]; then
  case "${3##*/}" in
    backup-client-ca.crt|backup-client.crt|backup-client.key)
      printf '%s\n' 640
      exit 0
      ;;
  esac
fi
exec /usr/bin/stat "$@"
EOF
  make_executable "$fixture/bin/stat"
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
printf 'smoke url=%s\n' "${!#}" >> "${TEST_LOG:?}"
url="${!#}"
if [[ "${FAIL_QUEST_HEALTH:-0}" == 1 && "$url" == *127.0.0.1:5001/api/health/live* ]]; then exit 1; fi
if [[ "${FAIL_VALORANT_HEALTH:-0}" == 1 && "$url" == *valorant-platform* ]]; then exit 1; fi
if [[ "$url" == *valorant-platform* && "${BAD_VALORANT_HEALTH:-0}" == 1 ]]; then printf '{"status":"ok","db":"down"}\n'; exit 0; fi
if [[ "$url" == *valorant-platform* ]]; then printf '{"status":"ok","db":"up"}\n'; exit 0; fi
if [[ "$url" == *ready* ]]; then printf '{"success":true,"message":"Quest E-sports API is healthy.","timestamp":"2026-08-28T12:00:00.000Z","readiness":{"database":"ready","storage":"ready"}}\n'; exit 0; fi
printf '{"status":"ok"}\n'
EOF
  make_executable "$fixture/bin/curl"

  cat > "$fixture/bin/cosign" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${TEST_LOG:?}"
identity=""
issuer=""
image="${!#}"
while (($#)); do
  case "$1" in
    --certificate-identity-regexp) identity="$2"; shift 2 ;;
    --certificate-oidc-issuer) issuer="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf 'cosign image=%s identity=%s issuer=%s\n' "$image" "$identity" "$issuer" >> "$log"
if [[ "${REQUIRE_ARTIFACT_TRUST_POLICY:-0}" == 1 ]]; then
  case "$image" in
    ghcr.io/quest/frontend@*|ghcr.io/quest/backend@*|ghcr.io/quest/migrator@*|ghcr.io/quest/valorant@*)
      [[ "$identity" == fixture-identity && "$issuer" == fixture-issuer ]] || exit 1 ;;
    *)
      printf 'FAIL: external image reached Quest Cosign verifier: %s\n' "$image" >&2
      exit 1 ;;
  esac
fi
exit 0
EOF
  make_executable "$fixture/bin/cosign"

  cat > "$fixture/bin/valorant-health" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'valorant-health\n' >> "${TEST_LOG:?}"
[[ "${FAIL_VALORANT_HEALTH:-0}" == 1 ]] && exit 1
if [[ "${BAD_VALORANT_HEALTH:-0}" == 1 ]]; then printf '{"status":"ok","db":"down"}\n'; else printf '{"status":"ok","db":"up"}\n'; fi
EOF
  make_executable "$fixture/bin/valorant-health"

  cat > "$fixture/bin/status" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$(basename "$0")" in
  migration-status)
    status_count=0
    if [[ -n "${MIGRATION_STATUS_COUNT_FILE:-}" ]]; then
      status_count="$(cat "$MIGRATION_STATUS_COUNT_FILE" 2>/dev/null || printf '0')"
      status_count=$((status_count + 1))
      printf '%s\n' "$status_count" > "$MIGRATION_STATUS_COUNT_FILE"
    fi
    migration_state=none
    if [[ "${MIGRATION_PENDING:-0}" == 1 && ( "${REQUIRE_MIGRATION_RECHECK:-0}" != 1 || "$status_count" -le 2 ) ]]; then migration_state=pending; fi
    ack_target="${TARGET_AUTHORITY:-none}"
    [[ "${TARGET_ACK_LIES:-0}" == 1 ]] && ack_target=wrong-postgres
    printf 'migration-status repo=%s target=%s state=%s\n' "${CHECK_REPOSITORY:-unknown}" "$ack_target" "$migration_state" >> "$TEST_LOG"
    if [[ "${TARGET_ACK_MODE:-0}" == 1 ]]; then
      schema=public; [[ "${CHECK_REPOSITORY:-}" == valorant ]] && schema=valorant
      printf '%s target=%s schema=%s repository=%s\n' "$migration_state" "$ack_target" "$schema" "${CHECK_REPOSITORY:-unknown}"
    else
      printf '%s\n' "$migration_state"
    fi
    ;;
  db-health|db-ready) ack_target="${TARGET_AUTHORITY:-quest-postgres}"; [[ "${TARGET_ACK_LIES:-0}" == 1 ]] && ack_target=wrong-postgres; printf 'ready target=%s schemas=public,valorant\n' "$ack_target" ;;
  registry) [[ "${FAIL_REGISTRY:-0}" == 1 ]] && exit 1 || exit 0 ;;
  backup-freshness) [[ "${STALE_BACKUP:-0}" == 1 ]] && exit 1 || { printf 'freshness lock=%s held=%s inherited=%s\n' "${BACKUP_RELEASE_LOCK_PATH:?}" "${BACKUP_RELEASE_LOCK_HELD:-0}" "$(readlink -f /proc/self/fd/8 2>/dev/null || printf none)" >> "$TEST_LOG"; printf 'fresh\n'; } ;;
  backup) printf 'backup lock=%s held=%s inherited=%s\n' "${BACKUP_RELEASE_LOCK_PATH:?}" "${BACKUP_RELEASE_LOCK_HELD:-0}" "$(readlink -f /proc/self/fd/8 2>/dev/null || printf none)" >> "$TEST_LOG"; printf 'backup\n' ;;
  backup-evidence) printf 'backup-evidence\n' >> "$TEST_LOG"; [[ "${INCOMPLETE_BACKUP:-0}" == 1 ]] && printf 'verified-complete release_sha=%s schemas=verified:public uploads=verified:public,private archive=verified checksum=verified remote=verified\n' "${BACKUP_RELEASE_SHA:?}" || printf 'verified-complete release_sha=%s schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified\n' "${BACKUP_RELEASE_SHA:?}" ;;
  old-active) state="$(cat "${FIXTURE_OLD_VALORANT_STATE:?}")"; printf 'old-val-active-check state=%s\n' "$state" >> "$TEST_LOG"; [[ "${BAD_LEGACY_STATE:-0}" == 1 ]] && printf 'active\n' || for unit in valorant-platform valorant-updater valorant-discord-bot; do printf 'unit=%s state=%s observed_at=20260828T120000Z\n' "$unit" "$state"; done ;;
  old-quest-active) state="$(cat "${FIXTURE_OLD_QUEST_STATE:?}")"; printf 'old-quest-active-check state=%s\n' "$state" >> "$TEST_LOG"; printf 'unit=quest-pm2 state=%s observed_at=20260828T120000Z\n' "$state" ;;
  old-stop) printf 'old-stop\n' >> "$TEST_LOG"; [[ "${FAIL_OLD_VALORANT_STOP:-0}" == 1 ]] && exit 1; printf 'inactive\n' > "${FIXTURE_OLD_VALORANT_STATE:?}" ;;
  old-quest-stop) printf 'old-quest-stop\n' >> "$TEST_LOG"; [[ "${FAIL_OLD_QUEST_STOP:-0}" == 1 ]] && exit 1; printf 'inactive\n' > "${FIXTURE_OLD_QUEST_STATE:?}" ;;
  old-restart) printf 'old-restart\n' >> "$TEST_LOG" ;;
  old-quest-restart) printf 'old-quest-restart\n' >> "$TEST_LOG"; printf 'restarted\n' ;;
  old-mask) printf 'old-mask\n' >> "$TEST_LOG"; printf 'masked\n' > "${FIXTURE_OLD_VALORANT_PERSISTENCE:?}" ;;
  old-quest-mask) printf 'old-quest-mask\n' >> "$TEST_LOG"; printf 'masked\n' > "${FIXTURE_OLD_QUEST_PERSISTENCE:?}" ;;
  old-unmasked) cat "${FIXTURE_OLD_VALORANT_PERSISTENCE:?}" ;;
  old-reboot-persistence) [[ "${FAIL_REBOOT_PERSISTENCE:-0}" == 1 ]] && exit 1; for unit in valorant-platform valorant-updater valorant-discord-bot; do printf 'unit=%s state=inactive reboot_persistent=true observed_at=20260828T120000Z\n' "$unit"; done ;;
  old-quest-reboot-persistence) printf 'unit=quest-pm2 state=inactive reboot_persistent=true observed_at=20260828T120000Z\n' ;;
  old-authoritative) printf 'old-authoritative\n' >> "$TEST_LOG"; printf '%s\n' "${DATABASE_AUTHORITY:-supabase}" ;;
  old-application-restart) printf 'old-application-restart\n' >> "$TEST_LOG"; printf 'restarted\n' ;;
  freeze-enable) printf 'freeze-enable\n' >> "$TEST_LOG"; [[ "${FAIL_FREEZE:-0}" == 1 ]] && exit 1; printf 'validation\n' ;;
  quest-freeze-enable) printf 'quest-freeze-enable\n' >> "$TEST_LOG"; [[ "${FAIL_FREEZE:-0}" == 1 || "${FAIL_QUEST_FREEZE:-0}" == 1 ]] && exit 1; printf 'validation\n' ;;
  valorant-freeze-enable) printf 'valorant-freeze-enable\n' >> "$TEST_LOG"; [[ "${FAIL_FREEZE:-0}" == 1 || "${FAIL_VALORANT_FREEZE:-0}" == 1 ]] && exit 1; printf 'validation\n' ;;
  quest-freeze-disable|valorant-freeze-disable) printf '%s\n' "$0" >> "$TEST_LOG"; printf 'off\n' ;;
  quest-freeze-status) printf 'quest-freeze-status\n' >> "$TEST_LOG"; [[ "${FAIL_FREEZE:-0}" == 1 || "${FAIL_QUEST_FREEZE:-0}" == 1 ]] && exit 1; printf 'acknowledged\n' ;;
  valorant-freeze-status) printf 'valorant-freeze-status\n' >> "$TEST_LOG"; [[ "${FAIL_FREEZE:-0}" == 1 || "${FAIL_VALORANT_FREEZE:-0}" == 1 ]] && exit 1; printf 'acknowledged\n' ;;
  security-verify) printf 'security-verify\n' >> "$TEST_LOG"; [[ "${FAIL_SECURITY_VERIFY:-0}" == 1 ]] && exit 1; printf 'security-verified\n' ;;
  validate-host) printf 'validated\n' ;;
  service-ownership) [[ "${FAIL_SERVICE_OWNERSHIP:-0}" != 1 ]] || { printf 'owned\n'; exit 0; }; printf 'file=/etc/quest-esports/release.env service=quest-prod owner=root mode=0640 observed_at=20260828T120000Z\nfile=/etc/quest-esports/release.env service=valorant-prod owner=root mode=0640 observed_at=20260828T120000Z\n' ;;
  cutover-restore) printf 'cutover-restore\n' >> "$TEST_LOG"; printf 'restored\n' ;;
  cutover-abort) printf 'aborted\n' >> "$TEST_LOG" ;;
  cutover-url-restore) printf 'cutover-url-restore\n' >> "$TEST_LOG"; sed -i 's#@quest-postgres:#@db.supabase.test:#g' "${QUEST_RUNTIME_ENV_FILE:?}"; sed -i 's#@quest-postgres:#@db.supabase.test:#g' "${VALORANT_RUNTIME_ENV_FILE:?}"; printf 'restored\n' ;;
  quest-ready) printf 'quest-readiness-ack\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_READINESS_ACK:-0}" == 1 ]] && exit 1; printf 'ready\n' ;;
  valorant-ready) printf 'valorant-readiness-ack\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_READINESS_ACK:-0}" == 1 ]] && exit 1; printf 'ready\n' ;;
  quest-url-switch) printf 'quest-url-switch\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_URL_SWITCH:-0}" == 1 ]] && exit 1; sed -i 's#@db\.supabase\.test:#@quest-postgres:#g' "${QUEST_RUNTIME_ENV_FILE:?}"; printf 'switched target=quest-postgres writer_group=quest\n' ;;
  valorant-url-switch) printf 'valorant-url-switch\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_URL_SWITCH:-0}" == 1 ]] && exit 1; [[ "${NOOP_VALORANT_URL_SWITCH:-0}" == 1 ]] || sed -i 's#@db\.supabase\.test:#@quest-postgres:#g' "${VALORANT_RUNTIME_ENV_FILE:?}"; sed -i 's#schema=valorant&sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt#ssl=require#' "${VALORANT_RUNTIME_ENV_FILE:?}"; printf 'switched target=quest-postgres writer_group=valorant\n' ;;
  quest-url-effective|valorant-url-effective) group=quest; [[ "$(basename "$0")" == valorant-url-effective ]] && group=valorant; printf '%s-url-effective\n' "$group" >> "$TEST_LOG"; [[ "${FAIL_QUEST_URL_EFFECTIVE:-0}" == 1 && "$group" == quest || "${FAIL_VALORANT_URL_EFFECTIVE:-0}" == 1 && "$group" == valorant ]] && exit 1; runtime_file="$QUEST_RUNTIME_ENV_FILE"; [[ "$group" == valorant ]] && runtime_file="$VALORANT_RUNTIME_ENV_FILE"; database_url="$(awk -F= '$1 == "DATABASE_URL" { print $2; exit }' "$runtime_file")"; authority="${database_url#*://}"; host_port="${authority%%/*}"; host_port="${host_port##*@}"; host="${host_port%%:*}"; path="${authority#*/}"; database="${path%%[?#]*}"; [[ "$host" == quest-postgres && "$database" == quest ]] || exit 1; printf 'url-state group=%s host=%s database=%s authority=quest-postgres\n' "$group" "$host" "$database" ;;
  quest-service-restart) printf 'quest-service-restart\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_SERVICE_RESTART:-0}" == 1 ]] && exit 1; printf 'restarted target=quest-postgres project=quest-prod writer_group=quest\n' ;;
  valorant-service-restart) printf 'valorant-service-restart\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_SERVICE_RESTART:-0}" == 1 ]] && exit 1; printf 'restarted target=quest-postgres project=valorant-prod writer_group=valorant\n' ;;
  quest-migrate|valorant-migrate) [[ "${BAD_MIGRATOR:-0}" == 1 || "${MIGRATOR_IMAGE:-}" != "${EXPECTED_MIGRATOR_IMAGE:-}" ]] && exit 1; ack_target="${TARGET_AUTHORITY:-none}"; [[ "${TARGET_ACK_LIES:-0}" == 1 ]] && ack_target=wrong-postgres; schema=public; [[ "$(basename "$0")" == valorant-migrate ]] && schema=valorant; printf 'migrator repo=%s target=%s\n' "${MIGRATION_REPOSITORY:-unknown}" "$ack_target" >> "$TEST_LOG"; printf 'migrate\n' >> "$TEST_LOG"; if [[ "${TARGET_ACK_MODE:-0}" == 1 ]]; then printf 'migrated image=%s target=%s schema=%s repository=%s\n' "${MIGRATOR_IMAGE:?}" "$ack_target" "$schema" "${MIGRATION_REPOSITORY:-unknown}"; else printf 'migrated image=%s schema=%s\n' "${MIGRATOR_IMAGE:?}" "$schema"; fi ;;
  quest-writer-enable) printf 'quest-writer-enable\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_WRITER_ENABLE:-0}" == 1 ]] && exit 1 || printf 'admitted\n' ;;
  valorant-writer-enable) printf 'valorant-writer-enable\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_WRITER_ENABLE:-0}" == 1 ]] && exit 1 || printf 'admitted\n' ;;
  post-commit-recovery-arm) printf 'post-commit-recovery-arm\n' >> "$TEST_LOG"; printf 'armed\n' ;;
  candidate-start) printf 'candidate-start freeze=%s readonly=%s\n' "$4" "$6" >> "$TEST_LOG"; [[ "${FAIL_START:-0}" == 1 ]] && exit 1; : > "${ACTIVE_MARKER:?}"; printf 'started-frozen-read-only\n' ;;
  quest-candidate-start|valorant-candidate-start) group=quest; [[ "$(basename "$0")" == valorant-candidate-start ]] && group=valorant; printf '%s-candidate-start freeze=%s readonly=%s\n' "$group" "$4" "$6" >> "$TEST_LOG"; if [[ "${FAIL_START:-0}" == 1 || "$group" == quest && "${FAIL_QUEST_CANDIDATE_START:-0}" == 1 || "$group" == valorant && "${FAIL_VALORANT_CANDIDATE_START:-0}" == 1 ]]; then exit 1; fi; : > "${ACTIVE_MARKER:?}"; printf 'started-frozen-read-only group=%s\n' "$group" ;;
  quest-frozen-read-only-ack) printf 'quest-frozen-read-only-ack\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_FROZEN_ACK:-0}" == 1 ]] && exit 1; printf 'frozen-read-only\n' ;;
  valorant-frozen-read-only-ack) printf 'valorant-frozen-read-only-ack\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_FROZEN_ACK:-0}" == 1 ]] && exit 1; printf 'frozen-read-only\n' ;;
  quest-writer-stop) printf 'quest-writer-stop\n' >> "$TEST_LOG"; [[ "${FAIL_QUEST_WRITER_STOP:-0}" == 1 ]] && exit 1; printf 'stopped\n' ;;
  valorant-writer-stop) printf 'valorant-writer-stop\n' >> "$TEST_LOG"; [[ "${FAIL_VALORANT_WRITER_STOP:-0}" == 1 ]] && exit 1; printf 'stopped\n' ;;
  writer-stop) printf 'stopped\n' ;;
  capture) printf 'capture\n' >> "$TEST_LOG"; [[ "${FAIL_CAPTURE:-0}" != 1 ]] || exit 1; printf 'captured evidence_bundle=%s\n' "${RELEASE_DIR:?}" ;;
  recovery-action) [[ "${TRY_SUPABASE_URL_ROLLBACK:-0}" == 1 ]] && printf 'return-to-supabase\n' || printf 'fix-forward\n' ;;
  supabase-url-rollback) printf 'supabase-url-rollback\n' >> "$TEST_LOG"; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  status_contents="$(< "$fixture/bin/status")"
  command_paths=()
  for command_name in db-health db-ready registry backup-freshness backup backup-evidence migration-status old-active old-quest-active old-stop old-quest-stop old-restart old-quest-restart old-application-restart old-mask old-quest-mask old-unmasked old-reboot-persistence old-quest-reboot-persistence old-authoritative freeze-enable freeze-disable freeze-status quest-freeze-enable valorant-freeze-enable quest-freeze-disable valorant-freeze-disable quest-freeze-status valorant-freeze-status security-verify validate-host service-ownership cutover-restore cutover-abort cutover-url-restore quest-ready valorant-ready quest-url-switch valorant-url-switch quest-url-effective valorant-url-effective quest-service-restart valorant-service-restart quest-migrate valorant-migrate quest-writer-enable valorant-writer-enable post-commit-recovery-arm candidate-start quest-candidate-start valorant-candidate-start quest-frozen-read-only-ack valorant-frozen-read-only-ack quest-writer-stop valorant-writer-stop writer-stop capture recovery-action supabase-url-rollback; do
    command_path="$fixture/bin/$command_name"
    printf '%s\n' "$status_contents" > "$command_path"
    command_paths+=("$command_path")
  done
  chmod 755 "$fixture/bin/status" "${command_paths[@]}"

  cat > "$fixture/bin/postgres-target" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' postgres-target >> "\${TEST_LOG:?}"
if [[ "\${SENTINEL_FAIL:-0}" == 1 ]]; then exit 1; fi
if [[ "\${SENTINEL_MALFORMED:-0}" == 1 ]]; then printf '%s\n' malformed; exit 0; fi
if [[ "\${SENTINEL_MISMATCH:-0}" == 1 ]]; then printf 'target_kind=postgresql17 database=wrong host=127.0.0.1 port=55432 major=17 data_root=%s\n' "$fixture/postgres/17/data"; exit 0; fi
printf 'target_kind=postgresql17 database=quest host=127.0.0.1 port=55432 major=17 data_root=%s\n' \
  "$fixture/postgres/17/data"
EOF
  make_executable "$fixture/bin/postgres-target"

  cat > "$fixture/release.env" <<EOF
QUEST_DEPLOY_FIXTURE=1
RELEASE_ROOT=$fixture
RELEASES_ROOT=$fixture/releases
CURRENT_LINK=$fixture/current
RELEASE_LOCK_PATH=$fixture/release.lock
RELEASE_ENVIRONMENT=production
RELEASE_ENVIRONMENT_PROTECTED=1
QUEST_COMPOSE_TEMPLATE=$fixture/quest.compose.yml
VALORANT_COMPOSE_SOURCE=$fixture/valorant.compose.yml
VALORANT_RUNTIME_COMPOSE_CONTRACT=$script_directory/docker/valorant.production.compose.yml
DOCKER_BIN=$fixture/bin/docker
DATABASE_HEALTH_COMMAND=$fixture/bin/db-health
DATABASE_READINESS_COMMAND=$fixture/bin/db-ready
REGISTRY_CHECK_COMMAND=$fixture/bin/registry
VALIDATE_HOST_COMMAND=$fixture/bin/validate-host-real
SERVICE_OWNERSHIP_COMMAND=$fixture/bin/service-ownership
CURRENT_SUPABASE_ENV_FILE=$fixture/current-supabase.env
CUTOVER_RESTORE_COMMAND=$fixture/bin/cutover-restore
SECURITY_VERIFY_COMMAND=$fixture/bin/security-verify
RECOVERY_ADMIN_URL_FILE=$fixture/recovery-admin-url
QUEST_MIGRATOR_DATABASE_URL_FILE=$fixture/quest-migrator-url
VALORANT_MIGRATOR_DATABASE_URL_FILE=$fixture/valorant-migrator-url
CUTOVER_ABORT_COMMAND=$fixture/bin/cutover-abort
CUTOVER_SUPABASE_URL_RESTORE_COMMAND=$fixture/bin/cutover-url-restore
COSIGN_BIN=$fixture/bin/cosign
QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP=fixture-identity
QUEST_COSIGN_OIDC_ISSUER=fixture-issuer
QUEST_FRONTEND_IMAGE_APPROVED_REF=ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111
QUEST_BACKEND_IMAGE_APPROVED_REF=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222
MIGRATOR_IMAGE_APPROVED_REF=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444
POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
VALORANT_IMAGE_APPROVED_REF=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555
BACKUP_FRESHNESS_COMMAND=$fixture/bin/backup-freshness
BACKUP_COMMAND=$fixture/bin/backup
BACKUP_EVIDENCE_COMMAND=$fixture/bin/backup-evidence
QUEST_MIGRATION_STATUS_COMMAND=$fixture/bin/migration-status
VALORANT_MIGRATION_STATUS_COMMAND=$fixture/bin/migration-status
FIRST_CUTOVER_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
QUEST_MIGRATOR_COMMAND=$fixture/bin/quest-migrate
VALORANT_MIGRATOR_COMMAND=$fixture/bin/valorant-migrate
QUEST_WRITER_ENABLE_COMMAND=$fixture/bin/quest-writer-enable
VALORANT_WRITER_ENABLE_COMMAND=$fixture/bin/valorant-writer-enable
POST_COMMIT_RECOVERY_ARM_COMMAND=$fixture/bin/post-commit-recovery-arm
QUEST_WRITER_STOP_COMMAND=$fixture/bin/quest-writer-stop
VALORANT_WRITER_STOP_COMMAND=$fixture/bin/valorant-writer-stop
OLD_VALORANT_ACTIVE_CHECK=$fixture/bin/old-active
OLD_VALORANT_UNITS=valorant-platform,valorant-updater,valorant-discord-bot
OLD_VALORANT_REBOOT_PERSISTENCE_CHECK=$fixture/bin/old-reboot-persistence
OLD_VALORANT_STOP_COMMAND=$fixture/bin/old-stop
OLD_QUEST_STOP_COMMAND=$fixture/bin/old-quest-stop
OLD_QUEST_ACTIVE_CHECK=$fixture/bin/old-quest-active
OLD_QUEST_UNITS=quest-pm2
OLD_QUEST_REBOOT_PERSISTENCE_CHECK=$fixture/bin/old-quest-reboot-persistence
OLD_QUEST_RESTART_COMMAND=$fixture/bin/old-quest-restart
OLD_VALORANT_RESTART_COMMAND=$fixture/bin/old-restart
OLD_VALORANT_MASK_COMMAND=$fixture/bin/old-mask
OLD_QUEST_MASK_COMMAND=$fixture/bin/old-quest-mask
OLD_VALORANT_UNMASKED_CHECK=$fixture/bin/old-unmasked
OLD_DATABASE_AUTHORITATIVE_COMMAND=$fixture/bin/old-authoritative
OLD_APPLICATION_RESTART_COMMAND=$fixture/bin/old-application-restart
QUEST_FREEZE_ENABLE_COMMAND=$fixture/bin/quest-freeze-enable
VALORANT_FREEZE_ENABLE_COMMAND=$fixture/bin/valorant-freeze-enable
QUEST_FREEZE_DISABLE_COMMAND=$fixture/bin/quest-freeze-disable
VALORANT_FREEZE_DISABLE_COMMAND=$fixture/bin/valorant-freeze-disable
QUEST_FREEZE_STATUS_COMMAND=$fixture/bin/quest-freeze-status
VALORANT_FREEZE_STATUS_COMMAND=$fixture/bin/valorant-freeze-status
QUEST_HEALTH_URL=http://127.0.0.1:5001/api/health/live
QUEST_READINESS_URL=http://127.0.0.1:5001/api/health/ready
VALORANT_HEALTH_URL=https://valorant-platform:8000/api/v1/health
VALORANT_CA_FILE=$fixture/ca.crt
POSTGRES_COMPOSE_CA_FILE=$fixture/ca.crt
POSTGRES_COMPOSE_CERT_FILE=$fixture/postgres.crt
POSTGRES_COMPOSE_KEY_FILE=$fixture/postgres.key
BACKUP_CLIENT_TLS_DIR=$fixture/backup-client
POSTGRES_CA_FILE=$fixture/backup-client/backup-client-ca.crt
BACKUP_CLIENT_CERT_FILE=$fixture/backup-client/backup-client.crt
BACKUP_CLIENT_KEY_FILE=$fixture/backup-client/backup-client.key
QUEST_RUNTIME_ENV_FILE=$fixture/quest.production.env
VALORANT_RUNTIME_ENV_FILE=$fixture/valorant.production.env
POSTGRES_TARGET_HOST=127.0.0.1
POSTGRES_TARGET_PORT=55432
POSTGRES_TARGET_DATABASE=quest
POSTGRES_TARGET_MAJOR=17
POSTGRES_TARGET_DATA_ROOT=$fixture/postgres/17/data
POSTGRES_TARGET_SENTINEL_COMMAND=$fixture/bin/postgres-target
CURL_BIN=$fixture/bin/curl
VALORANT_CONTAINER_HEALTH_COMMAND=$fixture/bin/valorant-health
QUEST_READINESS_ACK_COMMAND=$fixture/bin/quest-ready
VALORANT_READINESS_ACK_COMMAND=$fixture/bin/valorant-ready
QUEST_DATABASE_URL_SWITCH_COMMAND=$fixture/bin/quest-url-switch
VALORANT_DATABASE_URL_SWITCH_COMMAND=$fixture/bin/valorant-url-switch
QUEST_DATABASE_URL_EFFECTIVE_COMMAND=$fixture/bin/quest-url-effective
VALORANT_DATABASE_URL_EFFECTIVE_COMMAND=$fixture/bin/valorant-url-effective
QUEST_SERVICE_RESTART_COMMAND=$fixture/bin/quest-service-restart
VALORANT_SERVICE_RESTART_COMMAND=$fixture/bin/valorant-service-restart
QUEST_CANDIDATE_FROZEN_START_COMMAND=$fixture/bin/quest-candidate-start
VALORANT_CANDIDATE_FROZEN_START_COMMAND=$fixture/bin/valorant-candidate-start
CANDIDATE_START_CONTRACT=frozen-read-only
CANDIDATE_FREEZE_FLAG=--write-freeze=validation
CANDIDATE_READ_ONLY_FLAG=--read-only
QUEST_FROZEN_READ_ONLY_ACK_COMMAND=$fixture/bin/quest-frozen-read-only-ack
VALORANT_FROZEN_READ_ONLY_ACK_COMMAND=$fixture/bin/valorant-frozen-read-only-ack
WRITER_STOP_COMMAND=$fixture/bin/writer-stop
CURRENT_STATE_CAPTURE_COMMAND=$fixture/bin/capture
RECOVERY_ACTION_COMMAND=$fixture/bin/recovery-action
SUPABASE_RECONCILIATION_DECISION=fix-forward
RELEASE_MIN_FREE_KB=1
EOF
  export QUEST_DEPLOY_FIXTURE=1 TARGET_ACK_MODE=1 RELEASE_ENV_FILE="$fixture/release.env" RELEASE_LOCK_PATH="$fixture/release.lock" TEST_LOG="$fixture/commands.log" TEST_CURRENT="$fixture/current" TEST_PREVIOUS="$fixture/releases/$previous_sha" ACTIVE_MARKER="$fixture/active.marker" FIXTURE_OLD_QUEST_STATE="$fixture/old-quest.state" FIXTURE_OLD_VALORANT_STATE="$fixture/old-valorant.state" FIXTURE_OLD_VALORANT_PERSISTENCE="$fixture/old-valorant.persistence" FIXTURE_OLD_QUEST_PERSISTENCE="$fixture/old-quest.persistence"
  MIGRATION_STATUS_COUNT_FILE="$fixture/migration-status.count"
  export MIGRATION_STATUS_COUNT_FILE
  : > "$TEST_LOG"
  export PATH="$fixture/bin:$base_path"
  cat > "$fixture/bin/validate-host-real" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf 'validate-host\n' >> "\${TEST_LOG:?}"
exec "$host_validation_script"
EOF
  make_executable "$fixture/bin/validate-host-real"
  cat > "$fixture/manifest.txt" <<'EOF'
commit_sha=1111111111111111111111111111111111111111
frontend_image=ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111
backend_image=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222
migrator_image=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444
postgres_image=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
valorant_image=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555
EOF
}

run_release() {
  sed -i -e 's#@db\.supabase\.test:5432#@quest-postgres:5432#g' \
    -e 's#quest_migrator:fixture#quest_runtime:fixture#g' \
    -e 's#valorant_runtime:fixture#val_runtime:fixture#g' \
    -e 's#valorant_migrator:fixture#val_runtime:fixture#g' \
    "$fixture/quest.production.env" "$fixture/valorant.production.env"
  DATABASE_AUTHORITY=quest-postgres bash "$release_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
}
run_host_validation() {
  sed -i -e 's#@db\.supabase\.test:5432#@quest-postgres:5432#g' \
    -e 's#quest_migrator:fixture#quest_runtime:fixture#g' \
    -e 's#valorant_runtime:fixture#val_runtime:fixture#g' \
    -e 's#valorant_migrator:fixture#val_runtime:fixture#g' \
    "$fixture/quest.production.env" "$fixture/valorant.production.env"
  RUNTIME_DATABASE_AUTHORITY=quest-postgres RELEASE_SHA=1111111111111111111111111111111111111111 RELEASE_MANIFEST="$fixture/manifest.txt" bash "$host_validation_script"
}

make_failed_bundle() {
  local sha="$1"
  rollback_sha="$sha"
  rollback_fixture="$fixture/releases/$sha"
  mkdir -p "$rollback_fixture"
  cp "$fixture/releases/$previous_sha/compose.production.yml" "$rollback_fixture/compose.production.yml"
  cp "$fixture/releases/$previous_sha/valorant.compose.yml" "$rollback_fixture/valorant.compose.yml"
  cp "$fixture/releases/$previous_sha/.env" "$rollback_fixture/.env"
  cat > "$rollback_fixture/release-metadata.txt" <<EOF
commit_sha=$sha
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
cutover_type=steady-state
EOF
  cat > "$rollback_fixture/commit-point.txt" <<EOF
writer_admission_starting=true
commit_sha=$sha
commit_point_utc=not-recorded
quest_writer_admission_started=false
quest_writer_admitted=false
quest_writer_ack_utc=not-recorded
valorant_writer_admission_started=false
valorant_writer_admitted=false
valorant_writer_ack_utc=not-recorded
writer_admitted=false
previous_release=$fixture/releases/$previous_sha
cutover_type=steady-state
quest_project=quest-prod
valorant_project=valorant-prod
shared_network=quest-shared
EOF
}

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

setup_fixture bad-alias-binding
export BAD_ALIAS_BINDING=1
assert_failed bad-alias-binding run_release

setup_fixture service-ownership-failure
export FAIL_SERVICE_OWNERSHIP=1
assert_failed service-ownership-failure run_release

setup_fixture termination-before-either-admission
make_failed_bundle 2222222222222222222222222222222222222222
export OLD_VALORANT_WAS_STOPPED=1
bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture" >/dev/null
assert_contains "$rollback_fixture/recovery-evidence.txt" 'result=completed'

setup_fixture termination-after-quest-admission
make_failed_bundle 3333333333333333333333333333333333333333
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/^writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
assert_failed termination-after-quest-admission bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
bash "$script_directory/deploy/rollback.sh" post-commit >/dev/null
assert_contains "$rollback_fixture/recovery-evidence.txt" 'boundary=post-commit-recovery'
assert_contains "$TEST_LOG" 'quest-writer-stop'
assert_contains "$TEST_LOG" 'valorant-writer-stop'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'reconciliation_decision=fix-forward'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'selected_recovery_action=fix-forward'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'expected_loss_rpo=owner-approved'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'incident_owner_approval=INCIDENT_OWNER_APPROVAL'

setup_fixture durable-commit-point
make_failed_bundle 4444444444444444444444444444444444444444
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/' "$rollback_fixture/commit-point.txt"
assert_failed durable-commit-point bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture stale-backup
export STALE_BACKUP=1
assert_failed stale-backup run_release

setup_fixture pending-without-approval
export MIGRATION_PENDING=1
assert_failed pending-without-approval run_release

setup_fixture failed-readiness
export FAIL_QUEST_HEALTH=1
assert_failed failed-readiness run_release
assert_contains "$TEST_LOG" 'action=compose --env-file'

setup_fixture failed-valorant-health
export BAD_VALORANT_HEALTH=1
assert_failed failed-valorant-health run_release

setup_fixture standalone-rollback-consumes-record
make_failed_bundle 5555555555555555555555555555555555555555
export OLD_VALORANT_WAS_STOPPED=1
bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture" >/dev/null
assert_contains "$TEST_LOG" 'old-application-restart'

setup_fixture unsafe-rollback-path
unsafe_rollback="$fixture/releases/$rollback_sha/../$previous_sha"
assert_failed unsafe-rollback-path bash "$script_directory/deploy/rollback.sh" pre-commit "$unsafe_rollback"

setup_fixture rollback-predecessor-metadata-mismatch
make_failed_bundle 9999999999999999999999999999999999999999
sed -i 's#^previous_release=.*#previous_release=supabase#; s/^cutover_type=.*/cutover_type=first-supabase-cutover/' "$rollback_fixture/release-metadata.txt"
assert_failed rollback-predecessor-metadata-mismatch bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-steady-state-predecessor-mismatch
make_failed_bundle 9999999999999999999999999999999999999999
steady_state_metadata_predecessor=8888888888888888888888888888888888888888
make_failed_bundle "$steady_state_metadata_predecessor"
rollback_fixture="$fixture/releases/9999999999999999999999999999999999999999"
sed -i "s#^previous_release=.*#previous_release=$fixture/releases/$steady_state_metadata_predecessor#" "$rollback_fixture/release-metadata.txt"
assert_contains "$fixture/releases/$steady_state_metadata_predecessor/release-metadata.txt" 'cutover_type=steady-state'
assert_failed rollback-steady-state-predecessor-mismatch bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-sentinel-normal-predecessor-mismatch
make_failed_bundle 9999999999999999999999999999999999999999
sed -i 's#^previous_release=.*#previous_release=supabase#; s/^cutover_type=.*/cutover_type=first-supabase-cutover/' "$rollback_fixture/commit-point.txt"
assert_failed rollback-sentinel-normal-predecessor-mismatch bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-duplicate-previous-metadata
make_failed_bundle aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf 'previous_release=%s\n' "$fixture/releases/$previous_sha" >> "$rollback_fixture/release-metadata.txt"
assert_failed rollback-duplicate-previous-metadata bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-duplicate-cutover-metadata
make_failed_bundle bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
printf '%s\n' 'cutover_type=steady-state' >> "$rollback_fixture/release-metadata.txt"
assert_failed rollback-duplicate-cutover-metadata bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-missing-predecessor-metadata
make_failed_bundle cccccccccccccccccccccccccccccccccccccccc
sed -i '/^previous_release=/d' "$rollback_fixture/release-metadata.txt"
assert_failed rollback-missing-predecessor-metadata bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture rollback-malformed-predecessor-metadata
make_failed_bundle dddddddddddddddddddddddddddddddddddddddd
sed -i 's/^cutover_type=.*/cutover_type=steady state/' "$rollback_fixture/release-metadata.txt"
assert_failed rollback-malformed-predecessor-metadata bash "$script_directory/deploy/rollback.sh" pre-commit "$rollback_fixture"

setup_fixture valorant-digest-mismatch
export BAD_VALORANT_DIGEST=1
assert_failed valorant-digest-mismatch run_release

setup_fixture wrong-postgres-approved-reference
sed -i 's#^POSTGRES_IMAGE_APPROVED_REF=.*#POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:3333333333333333333333333333333333333333333333333333333333333333#' "$fixture/release.env"
assert_failed wrong-postgres-approved-reference run_release

setup_fixture migrator-digest-mismatch
export MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export BAD_MIGRATOR=1
assert_failed migrator-digest-mismatch run_release

setup_fixture successful-approved-release
export MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
run_release >/dev/null
assert_contains "$TEST_LOG" 'candidate-start freeze=--write-freeze=validation readonly=--read-only'
# The held release lock must reach the backup scripts as descriptor 8.
# Re-opening the canonical path, directly or through /proc/self/fd,
# deadlocks against the lock this controller already holds.
assert_contains "$TEST_LOG" "freshness lock=$fixture/release.lock held=1 inherited=$fixture/release.lock"
assert_contains "$TEST_LOG" "backup lock=$fixture/release.lock held=1 inherited=$fixture/release.lock"
assert_contains "$TEST_LOG" 'old-mask'
[[ "$(grep -nm1 'freeze-enable' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -nm1 'old-stop' "$TEST_LOG" | cut -d: -f1)" ]] || { printf 'FAIL: freeze did not precede old VALORANT stop\n' >&2; exit 1; }
[[ "$(grep -nm1 'old-stop' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -nm1 'candidate-start' "$TEST_LOG" | cut -d: -f1)" ]] || { printf 'FAIL: old VALORANT stop did not precede candidate start\n' >&2; exit 1; }

setup_fixture empty-candidate-before-start
export FAIL_START=1
assert_failed empty-candidate-before-start run_release
if grep -Fq 'ps project=' "$TEST_LOG"; then
  printf 'FAIL: active cardinality was checked before candidate start\n' >&2
  exit 1
fi
gate_file_contains "$fixture/releases/1111111111111111111111111111111111111111/recovery-evidence.txt" 'boundary=pre-commit-rollback' 'pre-admission failure entered post-commit recovery'
gate_file_contains "$fixture/releases/1111111111111111111111111111111111111111/recovery-evidence.txt" 'supabase_authority_boundary=preserved-before-first-vps-write' 'pre-admission failure recorded stale-after-first-vps-write'

setup_fixture admission-failure-before-mask
export FAIL_QUEST_WRITER_ENABLE=1
assert_failed admission-failure-before-mask run_release
if grep -Fq 'old-mask' "$TEST_LOG"; then
  printf 'FAIL: old VALORANT units were masked before writer admission\n' >&2
  exit 1
fi

setup_fixture post-commit-boundary
make_failed_bundle 6666666666666666666666666666666666666666
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/valorant_writer_admission_started=false/valorant_writer_admission_started=true/; s/valorant_writer_admitted=false/valorant_writer_admitted=true/; s/valorant_writer_ack_utc=not-recorded/valorant_writer_ack_utc=20260828T120000Z/; s/writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
bash "$script_directory/deploy/rollback.sh" post-commit >/dev/null
assert_contains "$TEST_LOG" 'freeze-enable'

setup_fixture complete-two-group-admission
make_failed_bundle 7777777777777777777777777777777777777777
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/valorant_writer_admission_started=false/valorant_writer_admission_started=true/; s/valorant_writer_admitted=false/valorant_writer_admitted=true/; s/valorant_writer_ack_utc=not-recorded/valorant_writer_ack_utc=20260828T120000Z/; s/writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
bash "$script_directory/deploy/rollback.sh" post-commit >/dev/null
assert_contains "$rollback_fixture/recovery-evidence.txt" 'boundary=post-commit-recovery'

setup_fixture post-commit-capture-failure
make_failed_bundle 8888888888888888888888888888888888888888
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL FAIL_CAPTURE=1
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/valorant_writer_admission_started=false/valorant_writer_admission_started=true/; s/valorant_writer_admitted=false/valorant_writer_admitted=true/; s/valorant_writer_ack_utc=not-recorded/valorant_writer_ack_utc=20260828T120000Z/; s/writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
assert_failed post-commit-capture-failure bash "$script_directory/deploy/rollback.sh" post-commit
assert_contains "$rollback_fixture/recovery-evidence.txt" 'result=incomplete'

setup_fixture post-commit-missing-reconciliation-decision
make_failed_bundle 8989898989898989898989898989898989898989
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
sed -i '/^SUPABASE_RECONCILIATION_DECISION=/d' "$fixture/release.env"
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/valorant_writer_admission_started=false/valorant_writer_admission_started=true/; s/valorant_writer_admitted=false/valorant_writer_admitted=true/; s/valorant_writer_ack_utc=not-recorded/valorant_writer_ack_utc=20260828T120000Z/; s/writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
assert_failed post-commit-missing-reconciliation-decision bash "$script_directory/deploy/rollback.sh" post-commit
assert_contains "$failure_output" 'explicit reconciliation/data-loss decision'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'reconciliation_decision=not-recorded'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'selected_recovery_action=not-selected'

setup_fixture post-commit-rejects-supabase-url-rollback
make_failed_bundle 8989898989898989898989898989898989898989
export ROLLBACK_RELEASE_DIR="$rollback_fixture" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL TRY_SUPABASE_URL_ROLLBACK=1 SUPABASE_URL_ROLLBACK_COMMAND="$fixture/bin/supabase-url-rollback"
sed -i 's/quest_writer_admission_started=false/quest_writer_admission_started=true/; s/quest_writer_admitted=false/quest_writer_admitted=true/; s/quest_writer_ack_utc=not-recorded/quest_writer_ack_utc=20260828T120000Z/; s/valorant_writer_admission_started=false/valorant_writer_admission_started=true/; s/valorant_writer_admitted=false/valorant_writer_admitted=true/; s/valorant_writer_ack_utc=not-recorded/valorant_writer_ack_utc=20260828T120000Z/; s/writer_admitted=false/writer_admitted=true/' "$rollback_fixture/commit-point.txt"
assert_failed post-commit-rejects-supabase-url-rollback bash "$script_directory/deploy/rollback.sh" post-commit
assert_contains "$rollback_fixture/recovery-evidence.txt" 'supabase_authority_boundary=stale-after-first-vps-write'
assert_contains "$rollback_fixture/recovery-evidence.txt" 'supabase_url_rollback=prohibited'
if grep -Fq 'supabase-url-rollback' "$TEST_LOG"; then
  printf 'FAIL: post-commit recovery invoked the prohibited Supabase URL rollback command\n' >&2
  exit 1
fi

setup_fixture fixed-projects
run_release >/dev/null
assert_contains "$TEST_LOG" 'project=quest-prod'
assert_contains "$TEST_LOG" 'project=valorant-prod'
[[ -e "$fixture/current" ]] || { printf 'FAIL: current pointer was not retained\n' >&2; exit 1; }
export TEST_PREVIOUS="$fixture/releases/1111111111111111111111111111111111111111"
env VERIFY_STEADY_STATE=1 bash "$script_directory/deploy/verify-release.sh" >/dev/null
metadata_backup="$fixture/release-metadata.good"
cp "$TEST_PREVIOUS/release-metadata.txt" "$metadata_backup"
printf '%s\n' 'unexpected=metadata' >> "$TEST_PREVIOUS/release-metadata.txt"
assert_failed malformed-metadata env VERIFY_STEADY_STATE=1 bash "$script_directory/deploy/verify-release.sh"
mv "$metadata_backup" "$TEST_PREVIOUS/release-metadata.txt"

workflow_source="$(cat "$workflow_file")"
if grep -Fq 'POSTGRES_17_BOOKWORM_DIGEST#sha256' <<<"$workflow_source"; then
  printf 'FAIL: workflow strips the PostgreSQL sha256 algorithm prefix\n' >&2
  exit 1
fi
approved_postgres_ref='postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
grep -Fq "$approved_postgres_ref" "$workflow_file" || {
  printf 'FAIL: workflow does not pin the approved PostgreSQL digest reference\n' >&2
  exit 1
}
if grep -Eq 'postgres:17-bookworm@sha256:\[0-9a-f\]\{64\}|postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675' "$workflow_file"; then
  printf 'FAIL: workflow retains a flexible or rejected PostgreSQL digest contract\n' >&2
  exit 1
fi

deploy_workflow_source="$(< "$deploy_workflow_file")"
grep -Fq 'vnd.docker.reference.digest' "$deploy_workflow_file" || { printf 'FAIL: attestation descriptors are not bound to the image digest\n' >&2; exit 1; }
grep -Fq 'subject' "$deploy_workflow_file" || { printf 'FAIL: deploy workflow does not decode attestation subjects\n' >&2; exit 1; }
grep -Fq 'predicateType' "$deploy_workflow_file" || { printf 'FAIL: deploy workflow does not inspect the in-toto predicate type\n' >&2; exit 1; }
grep -Fq 'QUEST_BUILD_WORKFLOW' "$workflow_file" || { printf 'FAIL: build workflow does not carry the expected workflow identity into provenance\n' >&2; exit 1; }
builder_identity='https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main'
[[ "$(grep -Fc 'builder-id=https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main' "$workflow_file")" == 4 ]] || { printf 'FAIL: build workflow does not carry the stable builder identity into all provenance builds\n' >&2; exit 1; }
grep -Fq "$builder_identity" "$deploy_workflow_file" || { printf 'FAIL: deploy workflow does not enforce the approved stable builder identity\n' >&2; exit 1; }
for ssh_contract in 'StrictHostKeyChecking=yes' 'BatchMode=yes' 'ConnectTimeout=10' 'timeout --foreground' 'UserKnownHostsFile=' 'GlobalKnownHostsFile=/dev/null'; do
  grep -Fq -- "$ssh_contract" "$deploy_workflow_file" || { printf 'FAIL: Compose SSH contract lacks %s\n' "$ssh_contract" >&2; exit 1; }
done
if grep -Fq '"sudo -n -- /usr/local/sbin/quest-esports-release' "$deploy_workflow_file"; then
  printf 'FAIL: Compose remote command is still generated as a quote-breaking shell string\n' >&2
  exit 1
fi
# Execute the exact embedded in-toto statement validator against malformed,
# missing, and mismatched fixtures. This test never contacts a registry.
attestation_validator="$work_directory/attestation-validator.sh"
awk '/^          validate_buildkit_statement\(\) \{$/ { capture=1 } capture && /^          while IFS= read -r image_key; do$/ { exit } capture { sub(/^          /, ""); print }' "$deploy_workflow_file" > "$attestation_validator"
printf '%s\n' 'validate_buildkit_statement "$@"' >> "$attestation_validator"
chmod 755 "$attestation_validator"
attestation_digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
attestation_sha=1111111111111111111111111111111111111111
attestation_repo=Russelrip/QuestEsports
attestation_image=ghcr.io/russelrip/quest-backend
attestation_valid="$work_directory/attestation-valid.json"
python3 -c "import json,sys; p,d,s,r,i,b=sys.argv[1:]; json.dump({'_type':'https://in-toto.io/Statement/v1','subject':[{'name':'_','digest':{'sha256':d}}],'predicateType':'https://slsa.dev/provenance/v1','predicate':{'buildDefinition':{'buildType':'https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md','externalParameters':{'request':{'args':{'QUEST_BUILD_REVISION':s,'QUEST_BUILD_REPOSITORY':r,'QUEST_BUILD_BRANCH':'main','QUEST_BUILD_WORKFLOW':'Build container images'}}}},'runDetails':{'builder':{'id':b}}}},open(p,'w',encoding='utf-8'))" "$attestation_valid" "$attestation_digest" "$attestation_sha" "$attestation_repo" "$attestation_image" 'https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main'
run_attestation_validator() { "$attestation_validator" "$1" 'https://slsa.dev/provenance/v1' "$attestation_image" "sha256:$attestation_digest" "$attestation_sha" "$attestation_repo" main 'Build container images' 'https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main'; }
run_attestation_validator "$attestation_valid"
printf '%s\n' '{not-json}' > "$work_directory/attestation-malformed.json"
assert_failed malformed-attestation run_attestation_validator "$work_directory/attestation-malformed.json"
python3 -c "import json,sys; d=json.load(open(sys.argv[2],encoding='utf-8')); d.pop('subject'); json.dump(d,open(sys.argv[1],'w',encoding='utf-8'))" "$work_directory/attestation-missing-subject.json" "$attestation_valid"
assert_failed missing-attestation-subject run_attestation_validator "$work_directory/attestation-missing-subject.json"
for mismatch in digest repository branch workflow revision buildtype builder; do
  python3 -c "import json,sys; p,s,m=sys.argv[1:]; d=json.load(open(s,encoding='utf-8')); a=d['predicate']['buildDefinition']['externalParameters']['request']['args']; d['subject'][0]['digest']['sha256']='b'*64 if m=='digest' else None; a['QUEST_BUILD_REPOSITORY']='attacker/other' if m=='repository' else a['QUEST_BUILD_REPOSITORY']; a['QUEST_BUILD_BRANCH']='feature' if m=='branch' else a['QUEST_BUILD_BRANCH']; a['QUEST_BUILD_WORKFLOW']='Untrusted workflow' if m=='workflow' else a['QUEST_BUILD_WORKFLOW']; a['QUEST_BUILD_REVISION']='2'*40 if m=='revision' else a['QUEST_BUILD_REVISION']; d['predicate']['buildDefinition']['buildType']='https://attacker.invalid/build' if m=='buildtype' else d['predicate']['buildDefinition']['buildType']; d['predicate']['runDetails']['builder']['id']='wrong-builder' if m=='builder' else d['predicate']['runDetails']['builder']['id']; json.dump(d,open(p,'w',encoding='utf-8'))" "$work_directory/attestation-$mismatch.json" "$attestation_valid" "$mismatch"
  assert_failed "wrong-attestation-$mismatch" run_attestation_validator "$work_directory/attestation-$mismatch.json"
done
setup_fixture host-validator-backup-client-active-name
[[ "$(run_host_validation)" == validated ]] || { printf 'FAIL: active POSTGRES_CA_FILE backup contract was rejected\n' >&2; exit 1; }

setup_fixture host-validator-backup-client-stale-name
sed -i '/^POSTGRES_CA_FILE=/d' "$fixture/release.env"
printf '%s\n' "BACKUP_CLIENT_CA_FILE=$fixture/backup-client/backup-client-ca.crt" >> "$fixture/release.env"
assert_failed host-validator-backup-client-stale-name run_host_validation
if grep -Fq 'BACKUP_CLIENT_CA_FILE' "$host_validation_script"; then
  printf 'FAIL: host validator still references stale BACKUP_CLIENT_CA_FILE\n' >&2
  exit 1
fi
if grep -Eq '^\s+attestations:\s+write$' "$workflow_file"; then
  printf 'FAIL: image workflow requests unnecessary GitHub attestations write permission\n' >&2
  exit 1
fi
grep -Fq 'actions/runs/$build_run_id/artifacts?per_page=100' "$deploy_workflow_file" || {
  printf 'FAIL: deploy workflow does not enumerate artifacts from the selected build run\n' >&2
  exit 1
}
grep -Fq 'ci_run_id="${BASH_REMATCH[1]}"' "$deploy_workflow_file" || {
  printf 'FAIL: deploy workflow does not bind the artifact to its upstream CI run ID\n' >&2
  exit 1
}
grep -Fq 'release_sha="${BASH_REMATCH[2]}"' "$deploy_workflow_file" || {
  printf 'FAIL: deploy workflow does not bind release SHA to the artifact name\n' >&2
  exit 1
}
if grep -Eq 'release_sha=.*headSha|release_sha=.*head_sha' "$deploy_workflow_file"; then
  printf 'FAIL: deploy workflow derives release SHA from the downstream build run SHA\n' >&2
  exit 1
fi
# Executable binding fixture: extract and run the resolver body from the actual
# deployment workflow with mocked GitHub REST responses. The successful fixture
# uses one matching SHA through CI, image build, artifact, and main head; the
# following cases deliberately break that lineage.
resolver_script="$work_directory/resolve-release.sh"
awk '
  /^        run: \|$/ { capture=1; next }
  capture && (/^      - name:/ || /^  [a-z-]+:/) { exit }
  capture { sub(/^          /, ""); print }
' "$deploy_workflow_file" > "$resolver_script"
chmod 755 "$resolver_script"
resolver_bin="$work_directory/resolver-bin"
mkdir -p "$resolver_bin"
cat > "$resolver_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == run && "$2" == list ]]; then
  [[ "$*" == *"--repo Russelrip/QuestEsports"* ]] || exit 1
  [[ "$*" == *"--workflow build-container-images.yml"* ]] || exit 1
  [[ "$*" == *"--branch main"* ]] || exit 1
  if [[ -n "${REQUESTED_ROLLBACK_SHA:-}" ]]; then
    [[ "$*" == *"--commit $RESOLVER_EXPECTED_ROLLBACK_SHA"* ]] || exit 1
  else
    [[ "$*" != *'--commit '* ]] || exit 1
  fi
  [[ "$*" == *"--status success"* ]] || exit 1
  [[ "$*" == *"--json databaseId"* ]] || exit 1
  printf '%s\n' '[{"databaseId":999}]'
  exit 0
fi
[[ "$1" == api ]] || exit 1
endpoint="$2"
jq_filter=""
shift 2
while (($#)); do
  case "$1" in
    --jq) jq_filter="$2"; shift 2 ;;
    *) shift ;;
  esac
done
response=""
case "$endpoint" in
  repos/Russelrip/QuestEsports/actions/workflows/build-container-images.yml)
    response='{"id":7001,"name":"Build container images","path":".github/workflows/build-container-images.yml"}'
    ;;
  repos/Russelrip/QuestEsports/actions/workflows/ci.yml)
    response='{"id":7002,"name":"CI","path":".github/workflows/ci.yml"}'
    ;;
  repos/Russelrip/QuestEsports/actions/runs/999)
    build_sha="${RESOLVER_BUILD_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    repository="${RESOLVER_REPOSITORY:-Russelrip/QuestEsports}"
    head_repository="${RESOLVER_HEAD_REPOSITORY:-Russelrip/QuestEsports}"
    response="$(printf '{\"id\":999,\"name\":\"Build container images\",\"path\":\".github/workflows/build-container-images.yml@refs/heads/main\",\"workflow_id\":7001,\"head_sha\":\"%s\",\"head_branch\":\"main\",\"conclusion\":\"success\",\"event\":\"workflow_run\",\"repository\":{\"id\":4242,\"full_name\":\"%s\"},\"head_repository\":{\"id\":4242,\"full_name\":\"%s\"}}' "$build_sha" "$repository" "$head_repository")"
    ;;
  repos/Russelrip/QuestEsports/actions/runs/123456)
    ci_sha="${RESOLVER_CI_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    response="$(printf '{\"id\":123456,\"name\":\"CI\",\"path\":\".github/workflows/ci.yml@refs/heads/main\",\"workflow_id\":7002,\"head_sha\":\"%s\",\"head_branch\":\"main\",\"conclusion\":\"success\",\"event\":\"push\",\"repository\":{\"id\":4242,\"full_name\":\"Russelrip/QuestEsports\"},\"head_repository\":{\"id\":4242,\"full_name\":\"Russelrip/QuestEsports\"}}' "$ci_sha")"
    ;;
  repos/Russelrip/QuestEsports/actions/runs/999/artifacts\?per_page=100)
    artifact_sha="${RESOLVER_ARTIFACT_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
    artifact_run_id="${RESOLVER_ARTIFACT_RUN_ID:-999}"
    artifact_repository_id="${RESOLVER_ARTIFACT_REPOSITORY_ID:-4242}"
    artifact_head_repository_id="${RESOLVER_ARTIFACT_HEAD_REPOSITORY_ID:-4242}"
    response="$(printf '{\"artifacts\":[{\"id\":7654321,\"expired\":false,\"name\":\"container-release-manifest-123456-%s\",\"workflow_run\":{\"id\":%s,\"repository_id\":%s,\"head_repository_id\":%s,\"head_branch\":\"main\",\"head_sha\":\"%s\"}}]}' "$artifact_sha" "$artifact_run_id" "$artifact_repository_id" "$artifact_head_repository_id" "$artifact_sha")"
    ;;
  repos/Russelrip/QuestEsports/git/ref/heads/main)
    response="$(printf '{\"object\":{\"sha\":\"%s\"}}' "${RESOLVER_MAIN_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}")"
    ;;
  *) exit 1 ;;
esac
if [[ "$jq_filter" == '.object.sha' ]]; then
  [[ "$endpoint" == repos/Russelrip/QuestEsports/git/ref/heads/main ]] || exit 1
  printf '%s\n' "${RESOLVER_MAIN_SHA:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
else
  printf '%s\n' "$response"
fi
EOF
chmod 755 "$resolver_bin/gh"
cat > "$resolver_bin/jq" <<'EOF'
#!/usr/bin/env node
const fs = require("node:fs");

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const filter = process.argv.slice(2).join(" ");
const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
const matchingArtifacts = artifacts.filter(
  (artifact) => artifact.expired === false && /^container-release-manifest-[0-9]+-[0-9a-f]{40}$/.test(artifact.name),
);

if (filter.includes("| length") && !filter.includes("if length == 1")) {
  process.stdout.write(`${matchingArtifacts.length}\n`);
} else if (filter.includes("if length == 1")) {
  if (matchingArtifacts.length !== 1) process.exit(1);
  process.stdout.write(`${JSON.stringify(matchingArtifacts[0])}\n`);
} else if (filter.includes(".workflow_run.id")) process.stdout.write(`${input.workflow_run.id}\n`);
else if (filter.includes(".workflow_run.head_sha")) process.stdout.write(`${input.workflow_run.head_sha}\n`);
else if (filter.includes(".databaseId")) process.stdout.write(`${Array.isArray(input) ? input[0].databaseId : input.databaseId}\n`);
else if (filter.includes(".head_repository.id | tostring")) process.stdout.write(`${input.head_repository.id}\n`);
else if (filter.includes(".repository.id | tostring")) process.stdout.write(`${input.repository.id}\n`);
else if (filter.includes(".id | tostring")) process.stdout.write(`${input.id}\n`);
else if (filter.includes(".workflow_id | tostring")) process.stdout.write(`${input.workflow_id}\n`);
else if (filter.includes(".path")) process.stdout.write(`${input.path}\n`);
else if (filter.includes(".name")) process.stdout.write(`${input.name}\n`);
else if (filter.includes(".conclusion")) process.stdout.write(`${input.conclusion}\n`);
else if (filter.includes(".event")) process.stdout.write(`${input.event}\n`);
else if (filter.includes(".workflow_run.repository_id")) process.stdout.write(`${input.workflow_run.repository_id}\n`);
else if (filter.includes(".workflow_run.head_repository_id")) process.stdout.write(`${input.workflow_run.head_repository_id}\n`);
else if (filter.includes(".workflow_run.head_branch")) process.stdout.write(`${input.workflow_run.head_branch}\n`);
else if (filter.includes(".head_branch")) process.stdout.write(`${input.head_branch}\n`);
else if (filter.includes(".head_repository.full_name")) process.stdout.write(`${input.head_repository.full_name}\n`);
else if (filter.includes(".repository.full_name")) process.stdout.write(`${input.repository.full_name}\n`);
else if (filter.includes(".head_repository.id")) process.stdout.write(`${input.head_repository.id}\n`);
else if (filter.includes(".repository.id")) process.stdout.write(`${input.repository.id}\n`);
else if (filter.includes(".head_sha")) {
  if (/^[0-9a-f]{40}$/.test(input.head_sha)) process.stdout.write(`${input.head_sha}\n`);
  else process.exit(1);
} else if (filter.includes(".expired")) process.stdout.write(`${input.expired}\n`);
else {
  process.exit(1);
}
EOF
chmod 755 "$resolver_bin/jq"
resolver_output="$work_directory/resolver-good.out"
resolver_environment=(
  "PATH=$resolver_bin:$base_path"
  GITHUB_EVENT_NAME=workflow_dispatch
  GITHUB_REPOSITORY=Russelrip/QuestEsports
  REQUESTED_ROLLBACK_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  RESOLVER_EXPECTED_ROLLBACK_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  "GITHUB_OUTPUT=$resolver_output"
)
env "${resolver_environment[@]}" bash "$resolver_script"
test -s "$resolver_output"
grep -Fxq -- 'artifact_name=container-release-manifest-123456-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$resolver_output" || exit 1
grep -Fxq -- 'release_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$resolver_output" || exit 1
grep -Fxq -- 'build_run_id=999' "$resolver_output" || exit 1
grep -Fxq -- 'release_mode=rollback' "$resolver_output" || exit 1
if grep -Fq 'release_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$resolver_output"; then
  printf 'FAIL: resolver selected downstream build headSha instead of upstream CI SHA\n' >&2
  exit 1
fi
resolver_normal_output="$work_directory/resolver-normal.out"
env "${resolver_environment[@]}" REQUESTED_ROLLBACK_SHA= RESOLVER_EXPECTED_ROLLBACK_SHA= GITHUB_OUTPUT="$resolver_normal_output" bash "$resolver_script"
test -s "$resolver_normal_output"
grep -Fxq -- 'release_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$resolver_normal_output" || exit 1
grep -Fxq -- 'release_mode=normal' "$resolver_normal_output" || exit 1
resolver_mismatch_output="$work_directory/resolver-mismatch.out"
assert_failed resolver-ci-sha-mismatch env "${resolver_environment[@]}" RESOLVER_CI_SHA=cccccccccccccccccccccccccccccccccccccccc GITHUB_OUTPUT="$resolver_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the CI/artifact SHA mismatch\n' >&2
  exit 1
fi
resolver_artifact_mismatch_output="$work_directory/resolver-artifact-mismatch.out"
assert_failed resolver-artifact-sha-mismatch env "${resolver_environment[@]}" RESOLVER_ARTIFACT_SHA=cccccccccccccccccccccccccccccccccccccccc GITHUB_OUTPUT="$resolver_artifact_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_artifact_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the artifact lineage mismatch\n' >&2
  exit 1
fi
resolver_head_repository_mismatch_output="$work_directory/resolver-head-repository-mismatch.out"
assert_failed resolver-head-repository-mismatch env "${resolver_environment[@]}" RESOLVER_HEAD_REPOSITORY=evil/fork GITHUB_OUTPUT="$resolver_head_repository_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_head_repository_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the head repository mismatch\n' >&2
  exit 1
fi
resolver_repository_mismatch_output="$work_directory/resolver-repository-mismatch.out"
assert_failed resolver-repository-mismatch env "${resolver_environment[@]}" RESOLVER_REPOSITORY=evil/repository GITHUB_OUTPUT="$resolver_repository_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_repository_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the repository mismatch\n' >&2
  exit 1
fi
resolver_artifact_run_mismatch_output="$work_directory/resolver-artifact-run-mismatch.out"
assert_failed resolver-artifact-run-mismatch env "${resolver_environment[@]}" RESOLVER_ARTIFACT_RUN_ID=998 GITHUB_OUTPUT="$resolver_artifact_run_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_artifact_run_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the artifact run mismatch\n' >&2
  exit 1
fi
resolver_artifact_head_repository_mismatch_output="$work_directory/resolver-artifact-head-repository-mismatch.out"
assert_failed resolver-artifact-head-repository-mismatch env "${resolver_environment[@]}" RESOLVER_ARTIFACT_HEAD_REPOSITORY_ID=999 GITHUB_OUTPUT="$resolver_artifact_head_repository_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_artifact_head_repository_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the artifact head-repository mismatch\n' >&2
  exit 1
fi

if ! grep -Fq 'test "${ci_run_path%@*}" = '\''.github/workflows/ci.yml'\''' "$deploy_workflow_file" || ! grep -Fq 'test "$(jq -er '\''.workflow_id | tostring'\'' <<< "$ci_run_json")" = "$ci_workflow_id"' "$deploy_workflow_file"; then
  printf 'FAIL: deploy workflow does not validate the upstream CI workflow identity\n' >&2
  exit 1
fi

resolver_artifact_repository_mismatch_output="$work_directory/resolver-artifact-repository-mismatch.out"
assert_failed resolver-artifact-repository-mismatch env "${resolver_environment[@]}" RESOLVER_ARTIFACT_REPOSITORY_ID=999 GITHUB_OUTPUT="$resolver_artifact_repository_mismatch_output" bash "$resolver_script"
if [[ -s "$resolver_artifact_repository_mismatch_output" ]]; then
  printf 'FAIL: resolver emitted deployment outputs after rejecting the artifact repository mismatch\n' >&2
  exit 1
fi

setup_fixture external-postgres-bind
sed -i 's/^POSTGRES_TARGET_HOST=.*/POSTGRES_TARGET_HOST=10.0.0.7/' "$fixture/release.env"
assert_failed external-postgres-bind run_release

setup_fixture postgres-port-collision
sed -i 's/^POSTGRES_TARGET_PORT=.*/POSTGRES_TARGET_PORT=5432/' "$fixture/release.env"
assert_failed postgres-port-collision run_release

setup_fixture missing-postgres-data-root
rm -rf -- "$fixture/postgres/17/data"
assert_failed missing-postgres-data-root run_release

setup_fixture mismatched-postgres-digest
sed -i 's/^postgres_image=.*/postgres_image=postgres:17-bookworm@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/' "$fixture/manifest.txt"
assert_failed mismatched-postgres-digest run_release

setup_fixture rejected-postgres-index-digest
sed -i 's/^postgres_image=.*/postgres_image=postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675/' "$fixture/manifest.txt"
assert_failed rejected-postgres-index-digest run_release

setup_fixture tag-only-postgres-image
sed -i 's/^postgres_image=.*/postgres_image=postgres:17/' "$fixture/manifest.txt"
assert_failed tag-only-postgres-image run_release

setup_fixture missing-postgres-tls-key
rm -f -- "$fixture/postgres.key"
assert_failed missing-postgres-tls-key run_release

setup_fixture nonquest-target-url
printf '%s\n' 'DATABASE_URL=postgresql://127.0.0.1:55432/notquest' > "$fixture/quest.production.env"
assert_failed nonquest-target-url run_release

setup_fixture recovery-pg16-url
printf '%s\n' 'postgresql://quest_recovery_admin:fixture@127.0.0.1:5432/quest' > "$fixture/recovery-admin-url"
assert_failed recovery-pg16-url run_release

setup_fixture missing-valorant-asyncpg-contract
sed -i '/VALORANT_DATABASE_SSL_VERIFY/d' "$fixture/valorant.compose.yml"
assert_failed missing-valorant-asyncpg-contract run_release

setup_fixture missing-valorant-network-alias
export BAD_VALORANT_ALIASES=missing
assert_failed missing-valorant-network-alias run_release

setup_fixture altered-valorant-network-alias
export BAD_VALORANT_ALIASES=1
assert_failed altered-valorant-network-alias run_release

setup_fixture valorant-libpq-url-rejected
sed -i 's#postgresql+asyncpg://val_runtime:fixture@db\.supabase\.test:5432/quest?ssl=require#postgresql+asyncpg://val_runtime:fixture@db.supabase.test:5432/quest?sslmode=verify-full\&sslrootcert=/run/secrets/quest-private-ca.crt#' "$fixture/valorant.production.env"
assert_failed valorant-libpq-url-rejected run_release

setup_fixture cutover-target-sentinel
sed -i 's/^POSTGRES_TARGET_HOST=.*/POSTGRES_TARGET_HOST=10.0.0.7/' "$fixture/release.env"
assert_failed cutover-target-sentinel env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"

# Focused host-validator fixtures exercise the real validator rather than the
# release wrapper acknowledgement used by older release-path cases.
setup_fixture host-validator-unsafe-port
sed -i 's/^POSTGRES_TARGET_PORT=.*/POSTGRES_TARGET_PORT=5432/' "$fixture/release.env"
assert_failed host-validator-unsafe-port run_host_validation

setup_fixture host-validator-unsafe-major
sed -i 's/^POSTGRES_TARGET_MAJOR=.*/POSTGRES_TARGET_MAJOR=16/' "$fixture/release.env"
assert_failed host-validator-unsafe-major run_host_validation

setup_fixture host-validator-unsafe-data-root
ln -s "$fixture/postgres/17/data" "$fixture/postgres/17/data-link"
sed -i "s#^POSTGRES_TARGET_DATA_ROOT=.*#POSTGRES_TARGET_DATA_ROOT=$fixture/postgres/17/data-link#" "$fixture/release.env"
assert_failed host-validator-unsafe-data-root run_host_validation

setup_fixture host-validator-malformed-sentinel
export SENTINEL_MALFORMED=1
assert_failed host-validator-malformed-sentinel run_host_validation

setup_fixture host-validator-failing-sentinel
export SENTINEL_FAIL=1
assert_failed host-validator-failing-sentinel run_host_validation

setup_fixture host-validator-mismatched-sentinel
export SENTINEL_MISMATCH=1
assert_failed host-validator-mismatched-sentinel run_host_validation

setup_fixture host-validator-writable-sentinel
export SENTINEL_WRITABLE=1
assert_failed host-validator-writable-sentinel run_host_validation

setup_fixture host-validator-runtime-url
printf '%s\n' 'DATABASE_URL=postgresql://127.0.0.1:55432/notquest' > "$fixture/quest.production.env"
assert_failed host-validator-runtime-url run_host_validation

setup_fixture host-validator-quest-runtime-role
sed -i 's#quest_runtime:fixture#quest_wrong_role:fixture#g' "$fixture/quest.production.env"
assert_failed host-validator-quest-runtime-role run_host_validation

setup_fixture host-validator-valorant-runtime-role
sed -i 's#val_runtime:fixture#val_wrong_role:fixture#g' "$fixture/valorant.production.env"
assert_failed host-validator-valorant-runtime-role run_host_validation

setup_fixture host-validator-canonical-tls
sed -i "s#^POSTGRES_COMPOSE_CERT_FILE=.*#POSTGRES_COMPOSE_CERT_FILE=$fixture/alternate.crt#" "$fixture/release.env"
: > "$fixture/alternate.crt"
assert_failed host-validator-canonical-tls run_host_validation

setup_fixture host-validator-key-mode
export TLS_KEY_WORLD_READABLE=1
assert_failed host-validator-key-mode run_host_validation

setup_fixture host-validator-backup-client-hierarchy
chmod 700 "$fixture/backup-client"
export BACKUP_CLIENT_DIR_MODE=700
assert_failed host-validator-backup-client-hierarchy run_host_validation

setup_fixture host-validator-backup-client-ca
rm -f "$fixture/backup-client/backup-client-ca.crt"
assert_failed host-validator-backup-client-ca run_host_validation

setup_fixture host-validator-backup-ca-chain
if command -v openssl >/dev/null 2>&1; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture/issuer.key" -out "$fixture/issuer.crt" -subj /CN=fixture-issuer -days 1 >/dev/null 2>&1
  openssl req -new -newkey rsa:2048 -nodes -keyout "$fixture/postgres.key" -subj /CN=quest-postgres -out "$fixture/postgres.csr" >/dev/null 2>&1
  openssl x509 -req -in "$fixture/postgres.csr" -CA "$fixture/issuer.crt" -CAkey "$fixture/issuer.key" -CAcreateserial -out "$fixture/postgres.crt" -days 1 -sha256 >/dev/null 2>&1
  cp "$fixture/issuer.crt" "$fixture/backup-client/backup-client-ca.crt"
  chmod 640 "$fixture/backup-client/backup-client-ca.crt"
  export QUEST_DEPLOY_FIXTURE_ENFORCE_BACKUP_CA_CHAIN=1
  [[ "$(run_host_validation)" == validated ]] || { printf 'FAIL: valid backup CA issuer bundle was rejected\n' >&2; exit 1; }
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture/wrong-issuer.key" -out "$fixture/wrong-issuer.crt" -subj /CN=wrong-issuer -days 1 >/dev/null 2>&1
  cp "$fixture/wrong-issuer.crt" "$fixture/backup-client/backup-client-ca.crt"
  assert_failed host-validator-wrong-backup-ca-issuer run_host_validation
else
  printf '%s\n' 'SKIP: backup CA issuer-bundle fixture skipped because openssl is unavailable.'
fi

setup_fixture host-validator-canonical-tls-ownership
sed -i "s#^POSTGRES_COMPOSE_CERT_FILE=.*#POSTGRES_COMPOSE_CERT_FILE=$fixture/alternate.crt#; s#^POSTGRES_COMPOSE_KEY_FILE=.*#POSTGRES_COMPOSE_KEY_FILE=$fixture/alternate.key#; s#^VALIDATE_HOST_COMMAND=.*#VALIDATE_HOST_COMMAND=$fixture/bin/validate-host#" "$fixture/release.env"
ownership_fixture_supported=1
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ownership_fixture_supported=0 ;; esac
if (( ownership_fixture_supported == 0 )); then
  printf '%s\n' 'SKIP: canonical TLS ownership fixture skipped because Windows Git Bash cannot create or observe POSIX ownership changes.'
elif [[ "$(stat -c '%u' "$fixture/alternate.key" 2>/dev/null)" == 0 ]] && chown 1000 "$fixture/alternate.key" 2>/dev/null && [[ "$(stat -c '%u' "$fixture/alternate.key" 2>/dev/null)" == 1000 ]]; then
  export QUEST_DEPLOY_FIXTURE_ENFORCE_TLS_OWNERSHIP=1
  assert_failed host-validator-canonical-tls-ownership run_host_validation
  assert_failed release-canonical-tls-ownership run_release
  assert_failed cutover-canonical-tls-ownership env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
else
  printf '%s\n' 'SKIP: canonical TLS ownership fixture skipped because this platform cannot create or observe a non-root-owned fixture file.'
fi

setup_fixture first-cutover
[[ "$(run_host_validation)" == validated ]] || {
  printf 'FAIL: host trust fixture did not validate the signed exact manifest\n' >&2
  exit 1
}
sed -i 's/postgres_image=postgres:17-bookworm@sha256:.*/postgres_image=postgres:17-bookworm@sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/' "$fixture/manifest.txt"
assert_failed uppercase-postgres-digest run_release
setup_fixture first-cutover
run_first_cutover() { DATABASE_AUTHORITY=supabase bash "$release_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"; }
assert_failed steady-release-rejects-first-cutover run_first_cutover
assert_contains "$failure_output" 'first cutover requires cutover.sh'

setup_fixture first-cutover-success
export MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
if ! bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >/dev/null; then
  printf '%s\n' 'expected current cutover fixture failure is recorded by the Oracle Gate assertions below' >&2
fi
assert_contains "$TEST_LOG" 'quest-writer-enable'
[[ "$(grep -n 'migrate' "$TEST_LOG" | cut -d: -f1 | head -n1)" -lt "$(grep -n 'candidate-start' "$TEST_LOG" | cut -d: -f1 | head -n1)" ]] || { printf 'FAIL: candidate started before migration completed\n' >&2; exit 1; }
[[ "$(grep -n 'freeze-enable' "$TEST_LOG" | cut -d: -f1 | head -n1)" -lt "$(grep -n 'old-stop' "$TEST_LOG" | cut -d: -f1 | head -n1)" ]] || { printf 'FAIL: cutover froze writers after stopping them\n' >&2; exit 1; }
[[ "$(grep -n 'old-stop' "$TEST_LOG" | cut -d: -f1 | head -n1)" -lt "$(grep -n 'candidate-start' "$TEST_LOG" | cut -d: -f1 | head -n1)" ]] || { printf 'FAIL: candidate started before old writers stopped\n' >&2; exit 1; }
[[ "$(grep -n 'candidate-start' "$TEST_LOG" | cut -d: -f1 | head -n1)" -lt "$(grep -n 'writer-enable' "$TEST_LOG" | cut -d: -f1 | head -n1)" ]] || { printf 'FAIL: writer admission preceded candidate validation\n' >&2; exit 1; }
restore_line="$(grep -nF 'cutover-restore' "$TEST_LOG" | cut -d: -f1 | head -n1)"
candidate_line="$(grep -nF 'candidate-start' "$TEST_LOG" | cut -d: -f1 | head -n1)"
security_line="$(grep -nF 'security-verify' "$TEST_LOG" | cut -d: -f1 | tail -n1)"
first_migration_line="$(grep -nF 'migrator repo=' "$TEST_LOG" | cut -d: -f1 | head -n1)"
[[ -n "$security_line" && -n "$first_migration_line" && "$restore_line" -lt "$first_migration_line" && "$first_migration_line" -lt "$security_line" && "$security_line" -lt "$candidate_line" ]] || { printf 'FAIL: final security verification was not ordered after migrations and before candidate startup\n' >&2; exit 1; }
sentinel_before_restore="$(awk -v boundary="$restore_line" 'NR < boundary && $0 == "postgres-target" { line=NR } END { print line }' "$TEST_LOG")"
sentinel_after_restore="$(awk -v boundary="$restore_line" -v limit="$candidate_line" 'NR > boundary && NR < limit && $0 == "postgres-target" { line=NR } END { print line }' "$TEST_LOG")"
[[ -n "$sentinel_before_restore" && -n "$sentinel_after_restore" ]] || { printf 'FAIL: cutover did not execute the target sentinel before restore and again before candidate switching\n' >&2; exit 1; }

[[ -x "$cutover_script" ]] || { printf 'FAIL: cutover.sh is missing or not executable\n' >&2; exit 1; }
[[ -x "$host_validation_script" ]] || { printf 'FAIL: validate-host.sh is missing or not executable\n' >&2; exit 1; }
grep -q 'writer_admission_starting' "$cutover_script" || {
  printf 'FAIL: cutover does not record writer admission boundary\n' >&2
  exit 1
}
[[ "$(grep -n 'writer_admission_starting' "$cutover_script" | cut -d: -f1 | head -n1)" -lt "$(grep -n 'WRITER_ENABLE_COMMAND' "$cutover_script" | cut -d: -f1 | tail -n1)" ]] || {
  printf 'FAIL: writer admission is enabled before its boundary is recorded\n' >&2
  exit 1
}
[[ "$(grep -n 'run_migrator' "$cutover_script" | head -n1 | cut -d: -f1)" -lt "$(grep -n 'CANDIDATE_FROZEN_START_COMMAND' "$cutover_script" | head -n1 | cut -d: -f1)" ]] || {
  printf 'FAIL: candidate startup precedes migration\n' >&2
  exit 1
}
grep -q 'postcommit_boundary' "$cutover_script" || {
  printf 'FAIL: cutover lacks post-commit recovery boundary\n' >&2
  exit 1
}

# Oracle Gate 1 regressions. These cases intentionally use a disposable command
# fixture so the current implementation fails for missing contracts rather
# than contacting Supabase, PM2, Docker, or a real release host.
setup_fixture independent-writer-admission-release
export FAIL_VALORANT_WRITER_ENABLE=1
if run_release >"$work_directory/independent-release.out" 2>&1; then
  gate_failure 'release accepted a VALORANT writer-enable failure'
fi
gate_log_contains "$TEST_LOG" 'quest-writer-enable' 'release did not request an independent Quest writer acknowledgement'
gate_log_contains "$TEST_LOG" 'valorant-writer-enable' 'release did not request an independent VALORANT writer acknowledgement'
gate_log_before "$TEST_LOG" 'post-commit-recovery-arm' 'quest-writer-enable' 'release did not arm post-commit recovery before the first writer enable'
gate_log_not_contains "$TEST_LOG" 'old-application-restart' 'release entered the legacy Supabase/PM2 application restart path after VALORANT admission failed'
gate_log_not_contains "$TEST_LOG" 'old-restart' 'release restarted the legacy VALORANT unit after VALORANT admission failed'

setup_fixture independent-writer-admission-cutover
export FAIL_VALORANT_WRITER_ENABLE=1
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/independent-cutover.out" 2>&1; then
  gate_failure 'cutover accepted a VALORANT writer-enable failure'
fi
gate_log_contains "$TEST_LOG" 'quest-writer-enable' 'cutover did not request an independent Quest writer acknowledgement'
gate_log_contains "$TEST_LOG" 'valorant-writer-enable' 'cutover did not request an independent VALORANT writer acknowledgement'
gate_log_before "$TEST_LOG" 'post-commit-recovery-arm' 'quest-writer-enable' 'cutover did not arm post-commit recovery before the first writer enable'
gate_log_not_contains "$TEST_LOG" 'old-application-restart' 'cutover entered the legacy Supabase/PM2 application restart path after VALORANT admission failed'
gate_log_not_contains "$TEST_LOG" 'old-restart' 'cutover restarted the legacy VALORANT unit after VALORANT admission failed'

setup_fixture first-cutover-gates
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/first-cutover-gates.out" 2>&1; then
  :
else
  gate_failure 'first cutover did not complete its disposable happy path'
fi
gate_log_contains "$TEST_LOG" 'old-quest-stop' 'first cutover did not explicitly stop legacy Quest/PM2 before candidate startup'
gate_log_before "$TEST_LOG" 'old-quest-stop' 'candidate-start' 'first cutover started the candidate before stopping legacy Quest/PM2'
gate_log_exact "$TEST_LOG" 'compose project=quest-prod action=config' 'first cutover did not validate the staged Quest Compose project'
gate_log_exact "$TEST_LOG" 'compose project=valorant-prod action=config' 'first cutover did not validate the staged VALORANT Compose project'
gate_log_contains "$TEST_LOG" 'compose project=quest-prod action=config-images' 'first cutover did not validate staged Quest Compose images'
gate_log_contains "$TEST_LOG" 'compose project=valorant-prod action=config-images' 'first cutover did not validate staged VALORANT Compose images'
gate_log_before "$TEST_LOG" 'compose project=quest-prod action=config-images' 'quest-writer-enable' 'first cutover admitted Quest writers before validating staged Quest images'
gate_log_before "$TEST_LOG" 'compose project=valorant-prod action=config-images' 'valorant-writer-enable' 'first cutover admitted VALORANT writers before validating staged VALORANT images'
gate_log_before "$TEST_LOG" 'quest-url-switch' 'valorant-url-switch' 'first cutover did not switch Quest URLs before VALORANT URLs'
gate_log_before "$TEST_LOG" 'valorant-url-switch' 'quest-service-restart' 'first cutover restarted Quest before switching both URL sets'
gate_log_before "$TEST_LOG" 'quest-service-restart' 'valorant-service-restart' 'first cutover did not restart VALORANT after Quest'
gate_log_before "$TEST_LOG" 'valorant-service-restart' 'quest-readiness-ack' 'first cutover acknowledged Quest readiness before both services restarted'
gate_log_before "$TEST_LOG" 'quest-readiness-ack' 'valorant-readiness-ack' 'first cutover did not require both post-switch readiness acknowledgements'
gate_log_before "$TEST_LOG" 'valorant-readiness-ack' 'quest-writer-enable' 'first cutover admitted Quest writers before both readiness acknowledgements'
gate_log_before "$TEST_LOG" 'ps project=quest-prod' 'quest-writer-enable' 'first cutover admitted Quest writers before validating active Quest topology'
gate_log_before "$TEST_LOG" 'ps project=valorant-prod' 'valorant-writer-enable' 'first cutover admitted VALORANT writers before validating active VALORANT topology'
gate_log_before "$TEST_LOG" 'validate-host' 'old-authoritative' 'first cutover checked authority before freeze'
gate_log_before "$TEST_LOG" 'old-authoritative' 'quest-freeze-enable' 'first cutover did not establish authority before freezing writers'
gate_log_before "$TEST_LOG" 'cutover-restore' 'security-verify' 'first cutover did not verify restored roles and privileges after restore'
gate_log_before "$TEST_LOG" 'backup-evidence' 'cutover-restore' 'first cutover restored before final backup evidence'
gate_log_before "$TEST_LOG" 'migration-status repo=quest target=quest-postgres state=none' 'security-verify' 'first cutover did not verify security after migration status was clean'
gate_log_before "$TEST_LOG" 'valorant-health' 'quest-url-switch' 'first cutover switched URLs before smoke validation'
gate_log_contains "$TEST_LOG" 'quest-url-effective' 'first cutover did not validate the effective Quest URL host and database'
gate_log_contains "$TEST_LOG" 'valorant-url-effective' 'first cutover did not validate the effective VALORANT URL host and database'
gate_log_before "$TEST_LOG" 'valorant-writer-enable' 'commit-point' 'first cutover recorded its final commit point before both writer admissions completed'
gate_log_before "$TEST_LOG" 'validate-host' 'old-authoritative' 'first cutover did not validate the host before checking database authority'
gate_log_before "$TEST_LOG" 'old-authoritative' 'quest-freeze-enable' 'first cutover did not check authority before Quest freeze'
gate_log_before "$TEST_LOG" 'quest-freeze-enable' 'valorant-freeze-enable' 'first cutover did not complete Quest freeze before VALORANT freeze'
gate_log_before "$TEST_LOG" 'backup-evidence' 'cutover-restore' 'first cutover restored before durable backup evidence'
gate_log_before "$TEST_LOG" 'valorant-health' 'quest-url-switch' 'first cutover switched URLs before smoke validation'
gate_log_before "$TEST_LOG" 'quest-url-switch' 'quest-url-effective' 'first cutover did not verify Quest URL state immediately after its switch'
gate_log_before "$TEST_LOG" 'valorant-url-switch' 'valorant-url-effective' 'first cutover did not verify VALORANT URL state immediately after its switch'
gate_log_before "$TEST_LOG" 'quest-readiness-ack' 'valorant-readiness-ack' 'first cutover did not complete both readiness acknowledgements in order'
gate_log_before "$TEST_LOG" 'valorant-readiness-ack' 'quest-writer-enable' 'first cutover admitted Quest before both readiness acknowledgements'
gate_log_before "$TEST_LOG" 'quest-writer-enable' 'valorant-writer-enable' 'first cutover did not admit writer groups in order'

cutover_release_dir="$fixture/releases/1111111111111111111111111111111111111111"
gate_file_contains "$cutover_release_dir/release-metadata.txt" 'previous_release=supabase' 'first cutover metadata did not name Supabase as the predecessor'
gate_file_contains "$cutover_release_dir/commit-point.txt" 'previous_release=supabase' 'first cutover commit-point did not name Supabase as the predecessor'
gate_file_contains "$cutover_release_dir/commit-point.txt" 'cutover_type=first-supabase-cutover' 'first cutover commit-point did not identify the cutover type'
export TEST_PREVIOUS="$cutover_release_dir"
if env VERIFY_STEADY_STATE=1 bash "$script_directory/deploy/verify-release.sh" >"$work_directory/first-cutover-verify.out" 2>&1; then
  :
else
  gate_failure 'first cutover metadata was not accepted by verify-release.sh'
fi

setup_fixture cutover-requires-supabase-authority
assert_failed cutover-requires-supabase-authority env DATABASE_AUTHORITY=quest-postgres bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'freeze-enable' "$TEST_LOG"; then
  gate_failure 'cutover froze writers after refusing non-Supabase authority'
fi

setup_fixture cutover-requires-final-evidence
export INCOMPLETE_BACKUP=1
assert_failed cutover-requires-final-evidence env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'cutover-restore' "$TEST_LOG"; then
  gate_failure 'cutover restored PostgreSQL before rejecting incomplete final evidence'
fi

setup_fixture cutover-requires-post-restore-security
export FAIL_SECURITY_VERIFY=1
assert_failed cutover-requires-post-restore-security env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'security-verify' 'cutover did not attempt post-restore role and privilege verification'
if grep -Fq 'quest-candidate-start' "$TEST_LOG"; then
  gate_failure 'cutover started candidates after post-restore security verification failed'
fi

setup_fixture cutover-requires-coordinated-freeze
export FAIL_FREEZE=1
assert_failed cutover-requires-coordinated-freeze env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'old-stop' "$TEST_LOG"; then
  gate_failure 'cutover stopped either legacy writer after coordinated freeze failed'
fi

setup_fixture cutover-requires-quest-freeze
export FAIL_QUEST_FREEZE=1
assert_failed cutover-requires-quest-freeze env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'old-stop' "$TEST_LOG"; then gate_failure 'cutover stopped legacy writers after Quest freeze refusal'; fi

setup_fixture cutover-requires-valorant-freeze
export FAIL_VALORANT_FREEZE=1
assert_failed cutover-requires-valorant-freeze env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'old-stop' "$TEST_LOG"; then gate_failure 'cutover stopped legacy writers after VALORANT freeze refusal'; fi

setup_fixture cutover-requires-both-url-switches
export FAIL_VALORANT_URL_SWITCH=1
assert_failed cutover-requires-both-url-switches env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'quest-url-switch' 'cutover did not attempt the Quest URL switch before failing'
gate_log_contains "$TEST_LOG" 'cutover-url-restore' 'cutover did not restore Supabase URLs after a partial URL switch'
if grep -Fq 'quest-service-restart' "$TEST_LOG" || grep -Fq 'quest-writer-enable' "$TEST_LOG"; then
  gate_failure 'cutover restarted or admitted writers after only one URL set switched'
fi

setup_fixture cutover-quest-url-switch-failure
export FAIL_QUEST_URL_SWITCH=1
assert_failed cutover-quest-url-switch-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'valorant-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched VALORANT URLs after Quest URL switch refusal'; fi

setup_fixture cutover-valorant-url-switch-failure
export FAIL_VALORANT_URL_SWITCH=1
assert_failed cutover-valorant-url-switch-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'quest-url-switch' 'cutover did not complete the independent Quest URL switch before VALORANT failure'
gate_log_contains "$TEST_LOG" 'cutover-url-restore' 'cutover did not restore Supabase URLs after independent VALORANT switch failure'
if grep -Fq 'valorant-service-restart' "$TEST_LOG"; then gate_failure 'cutover restarted VALORANT after its URL switch refusal'; fi

setup_fixture cutover-rejects-noop-valorant-url-switch
export NOOP_VALORANT_URL_SWITCH=1
assert_failed cutover-rejects-noop-valorant-url-switch env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'valorant-url-effective' 'cutover did not inspect the effective VALORANT URL after a no-op switch'
if grep -Fq 'valorant-service-restart' "$TEST_LOG"; then gate_failure 'cutover restarted VALORANT after a no-op URL switch'; fi
grep -q '@db\.supabase\.test:' "$fixture/quest.production.env" || gate_failure 'cutover did not restore Quest Supabase URLs after no-op transition refusal'
grep -q '@db\.supabase\.test:' "$fixture/valorant.production.env" || gate_failure 'cutover did not restore VALORANT Supabase URLs after no-op transition refusal'

setup_fixture cutover-rejects-missing-valorant-url-switch
sed -i '/^VALORANT_DATABASE_URL_SWITCH_COMMAND=/d' "$fixture/release.env"
export VALORANT_DATABASE_URL_SWITCH_COMMAND="$fixture/bin/missing-valorant-url-switch"
assert_failed cutover-rejects-missing-valorant-url-switch env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fxq 'quest-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched Quest when the independent VALORANT switch contract was missing'; fi
if grep -Fxq 'valorant-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched VALORANT when its switch contract was missing'; fi

setup_fixture cutover-valorant-url-effective-failure
export FAIL_VALORANT_URL_EFFECTIVE=1
assert_failed cutover-valorant-url-effective-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'quest-service-restart' "$TEST_LOG" || grep -Fq 'valorant-service-restart' "$TEST_LOG"; then gate_failure 'cutover restarted services after VALORANT effective URL validation refusal'; fi

setup_fixture cutover-quest-candidate-failure
export FAIL_QUEST_CANDIDATE_START=1
assert_failed cutover-quest-candidate-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'valorant-candidate-start' "$TEST_LOG"; then gate_failure 'cutover started VALORANT after Quest frozen/read-only startup refusal'; fi

setup_fixture cutover-valorant-frozen-ack-failure
export FAIL_VALORANT_FROZEN_ACK=1
assert_failed cutover-valorant-frozen-ack-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'quest-url-switch' "$TEST_LOG" || grep -Fq 'valorant-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched URLs after VALORANT frozen/read-only acknowledgement refusal'; fi

setup_fixture cutover-quest-frozen-ack-failure
export FAIL_QUEST_FROZEN_ACK=1
assert_failed cutover-quest-frozen-ack-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'quest-url-switch' "$TEST_LOG" || grep -Fq 'valorant-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched URLs after Quest frozen/read-only acknowledgement refusal'; fi

setup_fixture cutover-valorant-candidate-failure
export FAIL_VALORANT_CANDIDATE_START=1
assert_failed cutover-valorant-candidate-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'quest-url-switch' "$TEST_LOG"; then gate_failure 'cutover switched URLs after VALORANT frozen/read-only startup refusal'; fi

setup_fixture cutover-quest-restart-failure
export FAIL_QUEST_SERVICE_RESTART=1
assert_failed cutover-quest-restart-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'valorant-service-restart' "$TEST_LOG" || grep -Fq 'quest-writer-enable' "$TEST_LOG"; then gate_failure 'cutover continued after Quest service restart refusal'; fi

setup_fixture cutover-valorant-restart-failure
export FAIL_VALORANT_SERVICE_RESTART=1
assert_failed cutover-valorant-restart-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'quest-service-restart' 'cutover did not restart Quest before independent VALORANT restart failure'
if grep -Fq 'quest-readiness-ack' "$TEST_LOG" || grep -Fq 'valorant-readiness-ack' "$TEST_LOG"; then gate_failure 'cutover acknowledged readiness after VALORANT service restart refusal'; fi

setup_fixture cutover-quest-readiness-failure
export FAIL_QUEST_READINESS_ACK=1
assert_failed cutover-quest-readiness-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
if grep -Fq 'quest-writer-enable' "$TEST_LOG" || grep -Fq 'valorant-writer-enable' "$TEST_LOG"; then gate_failure 'cutover admitted writers after Quest readiness refusal'; fi

setup_fixture cutover-valorant-readiness-failure
export FAIL_VALORANT_READINESS_ACK=1
assert_failed cutover-valorant-readiness-failure env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'quest-readiness-ack' 'cutover did not request Quest readiness before independent VALORANT readiness failure'
if grep -Fq 'quest-writer-enable' "$TEST_LOG" || grep -Fq 'valorant-writer-enable' "$TEST_LOG"; then gate_failure 'cutover admitted writers after VALORANT readiness refusal'; fi

setup_fixture cutover-requires-both-readiness-acks
export FAIL_VALORANT_READINESS_ACK=1
assert_failed cutover-requires-both-readiness-acks env DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"
gate_log_contains "$TEST_LOG" 'quest-readiness-ack' 'cutover did not request Quest readiness acknowledgement'
gate_log_contains "$TEST_LOG" 'valorant-readiness-ack' 'cutover did not request VALORANT readiness acknowledgement'
if grep -Fq 'quest-writer-enable' "$TEST_LOG" || grep -Fq 'valorant-writer-enable' "$TEST_LOG"; then
  gate_failure 'cutover admitted a writer after only one service acknowledged readiness'
fi

setup_fixture first-cutover-provisional-recovery
export FAIL_QUEST_WRITER_ENABLE=1
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/first-cutover-provisional-recovery.out" 2>&1; then
  gate_failure 'first cutover unexpectedly accepted the failed Quest writer admission fixture'
fi
cutover_release_dir="$fixture/releases/1111111111111111111111111111111111111111"
gate_file_contains "$cutover_release_dir/release-metadata.txt" 'previous_release=supabase' 'first cutover did not persist provisional Supabase metadata before writer admission'
gate_file_contains "$cutover_release_dir/writer-admission-state.txt" 'quest_writer_admission_started=true' 'first cutover failure did not retain the durable Quest admission-start record'
export ROLLBACK_RELEASE_DIR="$cutover_release_dir" EXPECTED_LOSS_RPO=owner-approved INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL
if bash "$script_directory/deploy/rollback.sh" post-commit >"$work_directory/first-cutover-standalone-recovery.out" 2>&1; then
  :
else
  gate_failure 'standalone rollback rejected the provisional first-cutover recovery bundle'
fi
gate_file_contains "$cutover_release_dir/recovery-evidence.txt" 'boundary=post-commit-recovery' 'first-cutover standalone rollback did not record post-commit recovery evidence'

setup_fixture artifact-specific-trust
if run_release >"$work_directory/artifact-trust-release.out" 2>&1; then
  :
else
  gate_failure 'release could not create the artifact-specific trust fixture release'
fi
export TEST_PREVIOUS="$fixture/releases/1111111111111111111111111111111111111111"
export REQUIRE_ARTIFACT_TRUST_POLICY=1
if RELEASE_SHA=1111111111111111111111111111111111111111 RELEASE_MANIFEST="$fixture/manifest.txt" bash "$host_validation_script" >"$work_directory/artifact-trust-host.out" 2>&1; then
  :
else
  gate_failure 'host verification rejected the artifact-specific PostgreSQL/VALORANT trust policy'
fi
if env VERIFY_STEADY_STATE=1 bash "$script_directory/deploy/verify-release.sh" >"$work_directory/artifact-trust-verify.out" 2>&1; then
  :
else
  gate_failure 'release verification rejected the artifact-specific PostgreSQL/VALORANT trust policy'
fi
gate_log_contains "$TEST_LOG" 'cosign image=ghcr.io/quest/frontend@sha256:1111111111111111111111111111111111111111111111111111111111111111 identity=fixture-identity issuer=fixture-issuer' 'host verification did not use the Quest signer for the frontend image'
gate_log_contains "$TEST_LOG" 'cosign image=ghcr.io/quest/backend@sha256:2222222222222222222222222222222222222222222222222222222222222222 identity=fixture-identity issuer=fixture-issuer' 'host verification did not use the Quest signer for the backend image'
gate_log_contains "$TEST_LOG" 'cosign image=ghcr.io/quest/migrator@sha256:4444444444444444444444444444444444444444444444444444444444444444 identity=fixture-identity issuer=fixture-issuer' 'host verification did not use the Quest signer for the migrator image'
gate_log_contains "$TEST_LOG" 'cosign image=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555 identity=fixture-identity issuer=fixture-issuer' 'host verification did not use the Quest signer for the VALORANT image'
if grep -Eq 'cosign image=postgres:' "$TEST_LOG"; then
  gate_failure 'external PostgreSQL image reached the Quest Cosign verifier'
fi

check_migration_contract() {
  local label="$1" migration_count
  migration_count="$(grep -c '^migration-status ' "$TEST_LOG" || true)"
  [[ "$migration_count" -ge 4 ]] || gate_failure "$label did not recheck migration status after migration"
  gate_log_contains "$TEST_LOG" 'migration-status repo=quest target=quest-postgres state=pending' "$label did not pass the explicit target authority to Quest migration status"
  gate_log_contains "$TEST_LOG" 'migration-status repo=valorant target=quest-postgres state=pending' "$label did not pass the explicit target authority to VALORANT migration status"
  gate_log_contains "$TEST_LOG" 'migration-status repo=quest target=quest-postgres state=none' "$label did not observe the post-migration Quest status"
  gate_log_contains "$TEST_LOG" 'migration-status repo=valorant target=quest-postgres state=none' "$label did not observe the post-migration VALORANT status"
  gate_log_contains "$TEST_LOG" 'migrator repo=quest target=quest-postgres' "$label did not pass the explicit target authority to the Quest migrator"
  gate_log_contains "$TEST_LOG" 'migrator repo=valorant target=quest-postgres' "$label did not pass the explicit target authority to the VALORANT migrator"
}

setup_fixture migration-contract-release
export MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
if run_release >"$work_directory/migration-release.out" 2>&1; then
  :
else
  gate_failure 'release migration contract fixture did not complete'
fi
check_migration_contract release

setup_fixture migration-contract-cutover
export MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/migration-cutover.out" 2>&1; then
  :
else
  gate_failure 'cutover migration contract fixture did not complete'
fi
check_migration_contract cutover

setup_fixture frontend-api-egress
frontend_services="$(awk '/^  frontend:/{inside=1} inside && /^  backend:/{exit} inside {print}' "$fixture/quest.compose.yml")"
if ! grep -Eq '(INTERNAL|SERVER|BACKEND|API)[A-Z_]*(URL|EGRESS)[A-Z_]*:[[:space:]]*https?://(backend|quest-backend)(:|/)|API_EGRESS_ALLOWED:[[:space:]]*("true"|true)' <<<"$frontend_services"; then
  gate_failure 'frontend Compose has no deliberate server-side API egress or internal backend URL'
fi

# Oracle Gate 2 regressions. These cases deliberately exercise the failure and
# acknowledgement boundaries that must remain observable in disposable tests.
setup_fixture post-commit-containment-all-actions
export FAIL_VALORANT_WRITER_ENABLE=1 FAIL_QUEST_WRITER_STOP=1
if run_release >"$work_directory/post-commit-containment.out" 2>&1; then
  gate_failure 'release accepted a writer admission failure before post-commit containment'
fi
gate_log_contains "$TEST_LOG" 'quest-writer-stop' 'post-commit containment did not attempt Quest writer stop after a containment hook failed'
gate_log_contains "$TEST_LOG" 'valorant-writer-stop' 'post-commit containment did not attempt VALORANT writer stop after a containment hook failed'
gate_log_contains "$TEST_LOG" 'freeze-enable' 'post-commit containment did not attempt freeze enable after a containment hook failed'
gate_log_contains "$TEST_LOG" 'capture' 'post-commit containment did not attempt current-state capture after a containment hook failed'

setup_fixture cutover-old-service-state
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/cutover-old-service-state.out" 2>&1; then
  [[ "$(< "$fixture/old-quest.state")" == inactive ]] || gate_failure 'cutover did not leave old Quest/PM2 inactive after stopping it'
  [[ "$(< "$fixture/old-valorant.state")" == inactive ]] || gate_failure 'cutover did not leave old VALORANT inactive after stopping it'
  [[ "$(< "$fixture/old-quest.persistence")" == masked ]] || gate_failure 'cutover did not disable or mask old Quest/PM2 persistence after admission'
  [[ "$(< "$fixture/old-valorant.persistence")" == masked ]] || gate_failure 'cutover did not disable or mask old VALORANT persistence after admission'
else
  gate_failure 'cutover old-service state fixture did not complete its disposable happy path'
fi
gate_log_contains "$TEST_LOG" 'old-quest-active-check state=active' 'cutover did not inspect old Quest/PM2 state before stopping it'
gate_log_contains "$TEST_LOG" 'old-val-active-check state=active' 'cutover did not inspect old VALORANT state before stopping it'
gate_log_contains "$TEST_LOG" 'old-quest-active-check state=inactive' 'cutover did not verify old Quest/PM2 was inactive after stopping it'
gate_log_contains "$TEST_LOG" 'old-val-active-check state=inactive' 'cutover did not verify old VALORANT was inactive after stopping it'
gate_log_contains "$TEST_LOG" 'old-quest-mask' 'cutover did not execute the old Quest/PM2 persistence disable or mask hook'
gate_log_contains "$TEST_LOG" 'old-mask' 'cutover did not execute the old VALORANT persistence disable or mask hook'

setup_fixture cutover-partial-stop-recovery
export FAIL_OLD_VALORANT_STOP=1
if DATABASE_AUTHORITY=supabase bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt" >"$work_directory/cutover-partial-stop-recovery.out" 2>&1; then
  gate_failure 'cutover accepted a failed old VALORANT stop'
fi
gate_log_contains "$TEST_LOG" 'old-stop' 'cutover did not attempt the old VALORANT stop before failing'
gate_log_contains "$TEST_LOG" 'old-restart' 'pre-commit recovery did not track and restore a partially attempted old VALORANT stop'

setup_fixture cutover-requires-explicit-legacy-evidence
export BAD_LEGACY_STATE=1
assert_failed cutover-requires-explicit-legacy-evidence bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"

setup_fixture cutover-requires-reboot-persistence
export FAIL_REBOOT_PERSISTENCE=1
assert_failed cutover-requires-reboot-persistence bash "$cutover_script" 1111111111111111111111111111111111111111 "$fixture/manifest.txt"

for topology_script in "$release_script" "$cutover_script" "$script_directory/deploy/verify-release.sh"; do
  if { ! grep -Fq -- '{{json .}}' "$topology_script" && ! grep -Fq -- '--format json' "$topology_script"; } || ! grep -Eq 'Service|State|Image|Project' "$topology_script"; then
    gate_failure "$(basename "$topology_script") does not validate structured service, running-state, image, and project ownership records"
  fi
done
setup_fixture active-topology-structured
export TOPOLOGY_STRUCTURED=1
if run_release >"$work_directory/active-topology-structured.out" 2>&1; then
  :
else
  gate_failure 'release did not accept the exact structured active-topology fixture'
fi
setup_fixture active-topology-stale
export TOPOLOGY_STRUCTURED=1 TOPOLOGY_STALE=1
assert_failed active-topology-stale run_release
setup_fixture active-topology-missing-service
export TOPOLOGY_STRUCTURED=1 TOPOLOGY_MISSING=1
assert_failed active-topology-missing-service run_release

for migration_script in "$release_script" "$cutover_script" "$script_directory/deploy/verify-release.sh"; do
  if ! grep -Eq 'pending.*target=|target=.*pending|none.*target=' "$migration_script"; then
    gate_failure "$(basename "$migration_script") does not validate target identity in migration status acknowledgements"
  fi
done
for migrator_script in "$release_script" "$cutover_script"; do
  if ! grep -Eq 'migrated image=.*target=|target=.*migrated image=' "$migrator_script"; then
    gate_failure "$(basename "$migrator_script") does not validate target identity in migrator acknowledgements"
  fi
done
setup_fixture target-identity-honest
export TARGET_ACK_MODE=1 MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
if run_release >"$work_directory/target-identity-honest.out" 2>&1; then
  :
else
  gate_failure 'release rejected honest target-bound migration and readiness acknowledgements'
fi
setup_fixture target-identity-lies
export TARGET_ACK_MODE=1 TARGET_ACK_LIES=1 MIGRATION_PENDING=1 REQUIRE_MIGRATION_RECHECK=1 BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION
export QUEST_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
export VALORANT_MIGRATION_OWNER_APPROVAL_SHA=1111111111111111111111111111111111111111
assert_failed target-identity-lies run_release

setup_fixture artifact-trust-external-images
export REQUIRE_ARTIFACT_TRUST_POLICY=1
sed -i -e 's#@db\.supabase\.test:5432#@quest-postgres:5432#g' \
  -e 's#quest_migrator:fixture#quest_runtime:fixture#g' \
  -e 's#valorant_runtime:fixture#val_runtime:fixture#g' \
  -e 's#valorant_migrator:fixture#val_runtime:fixture#g' \
  "$fixture/quest.production.env" "$fixture/valorant.production.env"
if RELEASE_SHA=1111111111111111111111111111111111111111 RELEASE_MANIFEST="$fixture/manifest.txt" bash "$host_validation_script" >"$work_directory/external-image-trust.out" 2>&1; then
  :
else
  gate_failure 'host verification rejected exact-digest external-image trust'
fi
gate_log_contains "$TEST_LOG" 'cosign image=ghcr.io/quest/valorant@sha256:5555555555555555555555555555555555555555555555555555555555555555 identity=fixture-identity issuer=fixture-issuer' 'monorepo VALORANT image was not passed to the Quest Cosign verifier'
if grep -Eq 'cosign image=postgres:' "$TEST_LOG"; then
  gate_failure 'external PostgreSQL image was passed to the Quest Cosign verifier'
fi
if grep -Eq 'POSTGRES_COSIGN|VALORANT_COSIGN' "$fixture/release.env"; then
  gate_failure 'external-image Cosign policy settings remain in the host trust configuration'
fi
grep -Fq -- 'valorant_image' "$deploy_workflow_file" || gate_failure 'Compose deployment does not include the VALORANT image in its signed manifest contract'
if grep -Fq -- 'VALORANT_IMAGE_APPROVED_REF' "$deploy_workflow_file"; then
  gate_failure 'Compose deployment still depends on a stale static VALORANT image allowlist'
fi

setup_fixture steady-state-supabase-metadata
run_release >/dev/null
export TEST_PREVIOUS="$fixture/releases/1111111111111111111111111111111111111111"
sed -i 's#^previous_release=.*#previous_release=supabase#' "$TEST_PREVIOUS/release-metadata.txt"
steady_state_verify_output="$work_directory/steady-state-supabase-metadata.out"
if env VERIFY_STEADY_STATE=1 bash "$script_directory/deploy/verify-release.sh" >"$steady_state_verify_output" 2>&1; then
  gate_failure 'verify-release.sh accepted previous_release=supabase for steady-state metadata'
fi

cutover_source="$(< "$cutover_script")"
cutover_source_line="$(grep -nF -- 'source "$release_env_file"' "$cutover_script" 2>/dev/null | cut -d: -f1 | head -n1 || true)"
cutover_env_stat_line="$(grep -nE 'stat -c .*release_env_file|release_env_file.*stat -c' "$cutover_script" | cut -d: -f1 | head -n1 || true)"
cutover_env_path_line="$(grep -nE 'realpath .*release_env_file|release_env_file.*realpath' "$cutover_script" | cut -d: -f1 | head -n1 || true)"
cutover_env_mode_line="$(grep -nE 'env_mode|%u %a.*release_env_file|release_env_file.*%a' "$cutover_script" | cut -d: -f1 | head -n1 || true)"
if [[ -z "$cutover_source_line" || -z "$cutover_env_stat_line" || -z "$cutover_env_path_line" || -z "$cutover_env_mode_line" || "$cutover_env_stat_line" -ge "$cutover_source_line" || "$cutover_env_path_line" -ge "$cutover_source_line" || "$cutover_env_mode_line" -ge "$cutover_source_line" ]]; then
  gate_failure 'cutover sources release-env before validating its canonical path/ownership'
fi
if ! grep -Fq -- 'env_stat=' "$cutover_script" || ! grep -Eq 'env_mode.*(600|640)' <<<"$cutover_source"; then
  gate_failure 'cutover does not validate release-env mode before sourcing it'
fi

if (( new_gate_failures != 0 )); then
  printf 'deploy release fixture tests failed: %d Oracle Gate 2 assertion(s) failed as expected against the current implementation\n' "$new_gate_failures" >&2
  exit 1
fi

bash "$script_directory/tests/task-6-attestation-ssh.test.sh"
printf '%s\n' 'deploy release fixture tests passed'
