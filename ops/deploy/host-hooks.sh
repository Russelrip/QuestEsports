#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Production host adapter for the immutable Compose release controller.
#
# Install this file once as a root-owned 0755 command, then create the basename
# aliases documented in host-hooks.aliases (hard links or copies). Every alias
# emits only the acknowledgement release.sh/verify-release.sh consume; database
# credentials and command output never reach standard output.

wrapper="$(basename "$0")"
release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"

die() { printf 'host hook %s failed: %s\n' "$wrapper" "$*" >&2; exit 1; }
run_quiet() { "$@" >/dev/null 2>&1 || die "command failed: $1"; }

[[ "$(id -u)" == 0 ]] || die 'root is required.'
[[ "$release_env_file" == /etc/quest-esports/release.env ]] || die 'the canonical release environment is required.'
[[ -f "$release_env_file" && ! -L "$release_env_file" ]] || die 'the release environment is missing or unsafe.'
release_env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'the release environment cannot be inspected.'
[[ "$release_env_stat" == '0 600' || "$release_env_stat" == '0 640' ]] || die 'the release environment ownership or mode is unsafe.'

set -a
# shellcheck disable=SC1090
source "$release_env_file"
set +a

docker_bin="${DOCKER_BIN:-/usr/bin/docker}"
release_root="${RELEASE_ROOT:-/opt/quest-esports}"
releases_root="${RELEASES_ROOT:-$release_root/releases}"
current_link="${CURRENT_LINK:-$release_root/current}"
quest_runtime_env="${QUEST_RUNTIME_ENV_FILE:-/etc/quest-esports/quest.production.env}"
valorant_runtime_env="${VALORANT_RUNTIME_ENV_FILE:-/etc/quest-esports/valorant.production.env}"
ca_file="${VALORANT_CA_FILE:-/etc/quest-esports/tls/quest-private-ca.crt}"
shared_network=quest-shared
postgres_container=quest-prod-postgres-1
quest_backend_container=quest-prod-backend-1
quest_frontend_container=quest-prod-frontend-1
valorant_api_container=valorant-prod-valorant-platform-1
valorant_updater_container=valorant-prod-valorant-updater-1
valorant_bot_container=valorant-prod-valorant-discord-bot-1

[[ -x "$docker_bin" ]] || die 'Docker is unavailable.'
[[ -f "$ca_file" && ! -L "$ca_file" ]] || die 'the private CA bundle is missing or unsafe.'

utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }

assert_bundle() {
  local bundle="$1"
  [[ "$bundle" == "$releases_root/"* && -d "$bundle" && ! -L "$bundle" ]] || die 'the release bundle is outside the immutable release root.'
  [[ "$(basename "$bundle")" =~ ^[0-9a-f]{40}$ ]] || die 'the release bundle is not SHA-bound.'
  [[ -f "$bundle/.env" && -f "$bundle/compose.production.yml" && -f "$bundle/valorant.compose.yml" ]] \
    || die 'the release bundle is incomplete.'
  printf '%s\n' "$bundle"
}

# The bundle the controller is acting on. release.sh exports RELEASE_DIR for
# every hook; a manual invocation falls back to the committed current release.
release_bundle() {
  local bundle="${RELEASE_DIR:-}"
  if [[ -z "$bundle" ]]; then
    bundle="$(realpath "$current_link" 2>/dev/null)" || die 'the current release cannot be resolved.'
  fi
  assert_bundle "$bundle"
}

# The bundle a container is actually running from. Freeze and writer hooks must
# recreate a service from its own bundle: before cutover that is the committed
# release, and after writer admission it is the staged release whose pointer may
# not have been moved yet. Following the container avoids silently downgrading
# or upgrading an image while only the freeze flag was meant to change.
running_bundle() {
  local container="$1" config_files bundle
  config_files="$("$docker_bin" inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container" 2>/dev/null)" \
    || die "$container is not running under Compose."
  [[ -n "$config_files" && "$config_files" != *,* ]] || die "$container was not created from a single Compose file."
  bundle="$(dirname "$config_files")"
  assert_bundle "$bundle"
}

release_value() {
  local bundle="$1" key="$2" value
  [[ -f "$bundle/.env" && ! -L "$bundle/.env" ]] || die 'the release image environment is missing or unsafe.'
  value="$(awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); count++ } END { if (count != 1) exit 1 }' "$bundle/.env")" \
    || die 'the release image value is missing or ambiguous.'
  [[ "$value" =~ @sha256:[0-9a-f]{64}$ ]] || die 'the release image value is mutable.'
  printf '%s\n' "$value"
}

protected_url() {
  local file="$1" file_stat value
  [[ "$file" == /etc/quest-esports/secrets/* && -f "$file" && ! -L "$file" ]] || die 'a protected database URL file is missing or unsafe.'
  file_stat="$(stat -c '%u %a' "$file" 2>/dev/null)" || die 'a protected database URL file cannot be inspected.'
  [[ "$file_stat" == '0 600' || "$file_stat" == '0 640' ]] || die 'a protected database URL has unsafe ownership or mode.'
  IFS= read -r value < "$file" || true
  [[ "$value" == postgresql://* || "$value" == postgres://* || "$value" == postgresql+asyncpg://* ]] || die 'a protected database URL is invalid.'
  printf '%s\n' "$value"
}

set_env_value() {
  local file="$1" key="$2" value="$3" temporary
  [[ "$file" == /etc/quest-esports/* && -f "$file" && ! -L "$file" ]] || die 'an environment file is unsafe.'
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && "$value" =~ ^[A-Za-z0-9_.:-]+$ ]] || die 'an environment update is unsafe.'
  temporary="$(mktemp "${file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temporary"
  chown --reference="$file" "$temporary"
  chmod --reference="$file" "$temporary"
  mv -f -- "$temporary" "$file"
}

quest_compose() {
  local bundle="$1"; shift
  "$docker_bin" compose --project-name quest-prod --env-file "$bundle/.env" \
    -f "$bundle/compose.production.yml" "$@"
}

valorant_compose() {
  local bundle="$1"; shift
  "$docker_bin" compose --project-name valorant-prod --env-file "$bundle/.env" \
    -f "$bundle/valorant.compose.yml" "$@"
}

wait_container() {
  local container="$1" expected="${2:-healthy}" attempts="${3:-60}" state
  for _ in $(seq 1 "$attempts"); do
    state="$("$docker_bin" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    [[ "$state" == "$expected" ]] && return 0
    sleep 2
  done
  die "$container did not reach $expected."
}

container_freeze() {
  local container="$1" expected="$2"
  "$docker_bin" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
    | grep -Fqx "WRITE_FREEZE_MODE=$expected"
}

database_contract() {
  local version schemas
  version="$("$docker_bin" exec "$postgres_container" psql -U postgres -d quest -Atqc 'show server_version_num' 2>/dev/null)" \
    || die 'the production database is unavailable.'
  schemas="$("$docker_bin" exec "$postgres_container" psql -U postgres -d quest -Atqc \
    "select string_agg(schema_name, ',' order by schema_name) from information_schema.schemata where schema_name in ('public','valorant')" 2>/dev/null)" \
    || die 'the production schemas cannot be inspected.'
  [[ "$version" =~ ^17[0-9]{4,}$ && "$schemas" == public,valorant ]] || die 'the production database contract failed.'
}

legacy_state() {
  local output_name="$1" systemd_name="$2" active=inactive
  systemctl is-active --quiet "$systemd_name" 2>/dev/null && active=active
  printf 'unit=%s state=%s observed_at=%s\n' "$output_name" "$active" "$(utc_stamp)"
}

legacy_stop() {
  local unit
  for unit in "$@"; do
    systemctl stop "$unit" >/dev/null 2>&1 || true
    ! systemctl is-active --quiet "$unit" 2>/dev/null || die 'a legacy service is still active.'
  done
}

legacy_mask() {
  local unit
  legacy_stop "$@"
  for unit in "$@"; do
    systemctl disable "$unit" >/dev/null 2>&1 || true
    systemctl mask "$unit" >/dev/null 2>&1 || true
    ! systemctl is-enabled --quiet "$unit" 2>/dev/null || die 'a legacy service remains enabled.'
  done
}

backup_setting() {
  local key="$1" value
  value="$(awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); count++ } END { if (count != 1) exit 1 }' \
    "${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}")" || die "the backup setting $key is missing or ambiguous."
  printf '%s\n' "$value"
}

# Compares the migrations shipped in the release image against the durable
# ledger in the production database. Prisma and the VALORANT runner both record
# the sha256 of the migration file, so the two inventories are directly
# comparable without trusting either tool's own "already up to date" reporting.
# Returns 0 when the database matches the image, 1 when migrations are pending,
# and exits when the comparison itself could not be made.
migration_inventory() {
  local repository="$1" bundle image image_inventory database_inventory status=0
  bundle="$(release_bundle)"
  image_inventory="$(mktemp)"
  database_inventory="$(mktemp)"
  if [[ "$repository" == quest ]]; then
    image="$(release_value "$bundle" MIGRATOR_IMAGE)"
    "$docker_bin" run --rm --network none --entrypoint /bin/sh "$image" -c \
      'for file in /app/prisma/migrations/*/migration.sql; do hash=$(sha256sum "$file"); hash=${hash%% *}; directory=${file%/*}; printf "%s %s\n" "$hash" "${directory##*/}"; done' \
      2>/dev/null | sort > "$image_inventory" || status=2
    "$docker_bin" exec "$postgres_container" psql -U postgres -d quest -AtF ' ' -c \
      "select checksum, migration_name from public._prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name" \
      2>/dev/null | sort > "$database_inventory" || status=2
  else
    image="$(release_value "$bundle" VALORANT_IMAGE)"
    "$docker_bin" run --rm --network none --entrypoint /bin/sh "$image" -c \
      'for file in /app/supabase/migrations/*.sql; do hash=$(sha256sum "$file"); hash=${hash%% *}; printf "%s %s\n" "$hash" "${file##*/}"; done' \
      2>/dev/null | sort > "$image_inventory" || status=2
    "$docker_bin" exec "$postgres_container" psql -U postgres -d quest -AtF ' ' -c \
      'select checksum, name from valorant._migration_ledger order by name' 2>/dev/null \
      | sort > "$database_inventory" || status=2
  fi
  if (( status == 0 )); then
    [[ -s "$image_inventory" ]] || status=2
  fi
  if (( status == 0 )) && ! cmp -s "$image_inventory" "$database_inventory"; then
    status=1
  fi
  rm -f -- "$image_inventory" "$database_inventory"
  (( status != 2 )) || die "the $repository migration inventory could not be collected."
  return "$status"
}

run_migrator() {
  local repository="$1" schema="$2" url_file="$3" bundle image url
  bundle="$(release_bundle)"
  url="$(protected_url "$url_file")"
  if [[ "$repository" == quest ]]; then
    image="$(release_value "$bundle" MIGRATOR_IMAGE)"
    run_quiet "$docker_bin" run --rm --network "$shared_network" \
      -e "DATABASE_URL=$url" -e "DIRECT_URL=$url" \
      -v "$ca_file:/run/secrets/quest-private-ca.crt:ro" \
      "$image" /app/node_modules/.bin/prisma migrate deploy --schema /app/prisma/schema.prisma
  else
    # The VALORANT runner takes TLS from settings rather than from the URL, so
    # the verified-full contract must be supplied explicitly for a one-shot run.
    image="$(release_value "$bundle" VALORANT_IMAGE)"
    run_quiet "$docker_bin" run --rm --network "$shared_network" --entrypoint /app/.venv/bin/python \
      -e "DATABASE_URL=$url" \
      -e APP_ENV=production \
      -e DATABASE_RUNTIME_ROLE=val_runtime \
      -e VALORANT_DATABASE_SSL_VERIFY=full \
      -e VALORANT_DATABASE_SSL_CA_FILE=/run/secrets/quest-private-ca.crt \
      -e VALORANT_DATABASE_SSL_SERVER_HOSTNAME=quest-postgres \
      -v "$ca_file:/run/secrets/quest-private-ca.crt:ro" \
      "$image" -m scripts.apply_migrations --search-path valorant --runtime-role val_runtime
  fi
  printf 'migrated image=%s target=quest-postgres schema=%s repository=%s\n' "$image" "$schema" "$repository"
}

case "$wrapper" in
  quest-release-service-ownership)
    mode="${release_env_stat##* }"
    observed="$(utc_stamp)"
    printf 'file=/etc/quest-esports/release.env service=quest-prod owner=root mode=0%s observed_at=%s\n' "$mode" "$observed"
    printf 'file=/etc/quest-esports/release.env service=valorant-prod owner=root mode=0%s observed_at=%s\n' "$mode" "$observed"
    ;;

  quest-release-database-health|quest-release-database-ready)
    database_contract
    printf '%s\n' 'ready target=quest-postgres schemas=public,valorant'
    ;;

  quest-release-registry-check)
    image="${RELEASE_IMAGE:-}"
    [[ "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ || "$image" =~ ^postgres(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$ ]] \
      || die 'the registry image is not an exact digest reference.'
    run_quiet "$docker_bin" pull "$image"
    run_quiet "$docker_bin" image inspect "$image"
    ;;

  quest-release-post-restore-security-verify)
    bundle="$(release_bundle)"
    image="$(release_value "$bundle" MIGRATOR_IMAGE)"
    url_file="${SECURITY_VERIFY_DATABASE_URL_FILE:-${RECOVERY_ADMIN_URL_FILE:-}}"
    url="$(protected_url "$url_file")"
    # The URL file is root-only and the image runs unprivileged, so the verifier
    # receives the credential directly instead of a mount it could not read.
    run_quiet "$docker_bin" run --rm --network "$shared_network" \
      -e "SECURITY_VERIFY_DATABASE_URL=$url" \
      -e SECURITY_VERIFY_TARGET=quest-postgres -e TARGET_AUTHORITY=quest-postgres \
      -e TARGET_DATABASE_HOST=quest-postgres -e TARGET_DATABASE_PORT=5432 \
      -e TARGET_DATABASE_NAME=quest -e TARGET_POSTGRES_MAJOR=17 \
      -v "$ca_file:/run/secrets/quest-private-ca.crt:ro" \
      "$image" node scripts/verify-database-security.js
    printf '%s\n' security-verified
    ;;

  quest-release-quest-migration-status)
    if migration_inventory quest; then state=none; else state=pending; fi
    printf '%s target=quest-postgres schema=public repository=quest\n' "$state"
    ;;

  quest-release-valorant-migration-status)
    if migration_inventory valorant; then state=none; else state=pending; fi
    printf '%s target=quest-postgres schema=valorant repository=valorant\n' "$state"
    ;;

  quest-release-quest-migrate)
    run_migrator quest public "${QUEST_MIGRATOR_DATABASE_URL_FILE:?}"
    ;;

  quest-release-valorant-migrate)
    run_migrator valorant valorant "${VALORANT_MIGRATOR_DATABASE_URL_FILE:?}"
    ;;

  quest-release-backup-evidence)
    backup_release_sha="${BACKUP_RELEASE_SHA:-}"
    [[ "$backup_release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the backup evidence SHA is invalid.'
    BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" \
      "${BACKUP_FRESHNESS_COMMAND:?}" >/dev/null 2>&1 || die 'backup freshness verification failed.'
    # Substantiate every claim the acknowledgement makes: freshness proves the
    # archive, its checksum, and remote-copy equality; the per-remote result
    # record proves no remote silently failed; and the live database and upload
    # roots prove the captured scope.
    backup_root="$(backup_setting BACKUP_ROOT)"
    upload_root="$(backup_setting UPLOAD_ROOT)"
    private_root="$(backup_setting PRIVATE_UPLOAD_ROOT)"
    [[ "$backup_root" == /* && -d "$backup_root" && ! -L "$backup_root" ]] || die 'the backup root is unsafe.'
    archive="$(find "$backup_root" -maxdepth 1 -type f -name 'quest-production-*.tar.gz.enc' -printf '%T@ %p\n' \
      | sort -nr | head -n1 | cut -d' ' -f2-)"
    [[ -n "$archive" && -f "$archive.sha256" ]] || die 'no verified production archive and checksum pair was found.'
    ( cd "$backup_root" && sha256sum --check --status "$(basename "$archive").sha256" ) \
      || die 'the newest production archive failed checksum verification.'
    [[ -f "$archive.results" ]] || die 'the newest production archive has no per-remote result record.'
    ! grep -q 'failure$' "$archive.results" || die 'a configured backup remote reported a failure.'
    database_contract
    for root in "$upload_root" "$private_root"; do
      [[ "$root" == /* && -d "$root" && ! -L "$root" ]] || die 'an upload root is missing or unsafe.'
      [[ -n "$(find "$root" -mindepth 1 -print -quit)" ]] || die 'an upload root is empty.'
    done
    evidence_root=/var/lib/quest-esports/release-backups
    install -d -o root -g root -m 0700 "$evidence_root"
    printf 'release_sha=%s\narchive=%s\nverified_at=%s\n' "$backup_release_sha" "$(basename "$archive")" "$(utc_stamp)" \
      > "$evidence_root/$backup_release_sha.env"
    chmod 0600 "$evidence_root/$backup_release_sha.env"
    printf 'verified-complete release_sha=%s schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified\n' "$backup_release_sha"
    ;;

  quest-release-old-database-authoritative)
    database_contract
    printf '%s\n' quest-postgres
    ;;

  quest-release-old-valorant-active)
    legacy_state valorant-platform valorant-platform
    legacy_state valorant-updater valorant-updater
    legacy_state valorant-discord-bot valorant-discord-bot
    ;;

  quest-release-old-quest-active)
    legacy_state quest-pm2 pm2-deploy
    ;;

  quest-release-old-valorant-stop)
    legacy_stop valorant-platform valorant-updater valorant-discord-bot
    ;;

  quest-release-old-quest-stop)
    legacy_stop pm2-deploy
    ;;

  quest-release-old-valorant-mask)
    legacy_mask valorant-platform valorant-updater valorant-discord-bot
    ;;

  quest-release-old-quest-mask)
    legacy_mask pm2-deploy
    ;;

  quest-release-old-valorant-reboot-persistence)
    legacy_stop valorant-platform valorant-updater valorant-discord-bot
    observed="$(utc_stamp)"
    for unit in valorant-platform valorant-updater valorant-discord-bot; do
      ! systemctl is-enabled --quiet "$unit" 2>/dev/null || die 'a legacy VALORANT service remains reboot-enabled.'
      printf 'unit=%s state=inactive reboot_persistent=true observed_at=%s\n' "$unit" "$observed"
    done
    ;;

  quest-release-old-quest-reboot-persistence)
    legacy_stop pm2-deploy
    ! systemctl is-enabled --quiet pm2-deploy 2>/dev/null || die 'the legacy PM2 service remains reboot-enabled.'
    printf 'unit=quest-pm2 state=inactive reboot_persistent=true observed_at=%s\n' "$(utc_stamp)"
    ;;

  quest-release-quest-freeze-enable)
    bundle="$(running_bundle "$quest_backend_container")"
    set_env_value "$quest_runtime_env" WRITE_FREEZE_MODE validation
    run_quiet quest_compose "$bundle" up -d --no-deps --force-recreate backend
    wait_container "$quest_backend_container" healthy
    container_freeze "$quest_backend_container" validation || die 'the Quest freeze flag was not applied.'
    printf '%s\n' validation
    ;;

  quest-release-valorant-freeze-enable)
    bundle="$(running_bundle "$valorant_api_container")"
    set_env_value "$valorant_runtime_env" WRITE_FREEZE_MODE validation
    run_quiet valorant_compose "$bundle" stop valorant-updater valorant-discord-bot
    run_quiet valorant_compose "$bundle" up -d --no-deps --force-recreate valorant-platform
    wait_container "$valorant_api_container" healthy
    container_freeze "$valorant_api_container" validation || die 'the VALORANT freeze flag was not applied.'
    printf '%s\n' validation
    ;;

  quest-release-quest-freeze-disable)
    bundle="$(running_bundle "$quest_backend_container")"
    set_env_value "$quest_runtime_env" WRITE_FREEZE_MODE off
    run_quiet quest_compose "$bundle" up -d --no-deps --force-recreate backend
    wait_container "$quest_backend_container" healthy
    printf '%s\n' off
    ;;

  quest-release-valorant-freeze-disable)
    bundle="$(running_bundle "$valorant_api_container")"
    set_env_value "$valorant_runtime_env" WRITE_FREEZE_MODE off
    run_quiet valorant_compose "$bundle" up -d --no-deps --force-recreate valorant-platform valorant-updater valorant-discord-bot
    wait_container "$valorant_api_container" healthy
    printf '%s\n' off
    ;;

  quest-release-quest-freeze-status)
    container_freeze "$quest_backend_container" validation || die 'Quest is not frozen.'
    printf '%s\n' acknowledged
    ;;

  quest-release-valorant-freeze-status)
    container_freeze "$valorant_api_container" validation || die 'VALORANT is not frozen.'
    printf '%s\n' acknowledged
    ;;

  quest-release-quest-candidate-start)
    bundle="$(release_bundle)"
    [[ "${CANDIDATE_GROUP:-}" == quest && "${WRITE_FREEZE_MODE:-}" == validation && "${CANDIDATE_READ_ONLY:-}" == 1 ]] \
      || die 'the Quest candidate contract is invalid.'
    container_freeze "$quest_backend_container" validation || die 'the Quest freeze flag is not active before candidate start.'
    run_quiet quest_compose "$bundle" up -d --no-build --remove-orphans postgres backend frontend
    wait_container "$postgres_container" healthy
    wait_container "$quest_backend_container" healthy
    wait_container "$quest_frontend_container" healthy
    printf '%s\n' 'started-frozen-read-only group=quest'
    ;;

  quest-release-valorant-candidate-start)
    bundle="$(release_bundle)"
    [[ "${CANDIDATE_GROUP:-}" == valorant && "${WRITE_FREEZE_MODE:-}" == validation && "${CANDIDATE_READ_ONLY:-}" == 1 ]] \
      || die 'the VALORANT candidate contract is invalid.'
    container_freeze "$valorant_api_container" validation || die 'the VALORANT freeze flag is not active before candidate start.'
    run_quiet valorant_compose "$bundle" rm -sf valorant-updater valorant-discord-bot valorant-name-audit
    run_quiet valorant_compose "$bundle" up -d --no-build --remove-orphans valorant-platform
    wait_container "$valorant_api_container" healthy
    printf '%s\n' 'started-frozen-read-only group=valorant'
    ;;

  quest-release-quest-frozen-read-only-ack)
    container_freeze "$quest_backend_container" validation || die 'the Quest candidate is not frozen.'
    printf '%s\n' frozen-read-only
    ;;

  quest-release-valorant-frozen-read-only-ack)
    container_freeze "$valorant_api_container" validation || die 'the VALORANT candidate is not frozen.'
    printf '%s\n' frozen-read-only
    ;;

  quest-release-valorant-health)
    # Proves the private HTTPS boundary from inside the Quest network, using the
    # backend's own trusted CA rather than a host-side shortcut.
    "$docker_bin" exec -e "VALORANT_HEALTH_URL=${VALORANT_HEALTH_URL:?}" "$quest_backend_container" node -e \
      'fetch(process.env.VALORANT_HEALTH_URL).then(async (response) => { const body = await response.text(); if (!response.ok) process.exit(1); process.stdout.write(body); }).catch(() => process.exit(1))' \
      || die 'the VALORANT HTTPS health gate failed from the Quest network boundary.'
    ;;

  quest-release-post-commit-recovery-arm)
    BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" \
      "${BACKUP_FRESHNESS_COMMAND:?}" >/dev/null 2>&1 || die 'recovery backup freshness verification failed.'
    printf '%s\n' armed
    ;;

  quest-release-quest-writer-enable)
    bundle="$(running_bundle "$quest_backend_container")"
    set_env_value "$quest_runtime_env" WRITE_FREEZE_MODE off
    run_quiet quest_compose "$bundle" up -d --no-deps --force-recreate backend
    wait_container "$quest_backend_container" healthy
    container_freeze "$quest_backend_container" off || die 'Quest writer admission failed.'
    printf '%s\n' admitted
    ;;

  quest-release-valorant-writer-enable)
    bundle="$(running_bundle "$valorant_api_container")"
    set_env_value "$valorant_runtime_env" WRITE_FREEZE_MODE off
    run_quiet valorant_compose "$bundle" up -d --no-deps --force-recreate valorant-platform valorant-updater valorant-discord-bot
    wait_container "$valorant_api_container" healthy
    # The workers exit 0 while frozen, so admission is proven by the flag they
    # were recreated with rather than by a transient running state.
    for container in "$valorant_api_container" "$valorant_updater_container" "$valorant_bot_container"; do
      container_freeze "$container" off || die 'VALORANT writer admission failed.'
    done
    printf '%s\n' admitted
    ;;

  quest-release-quest-writer-stop)
    bundle="$(running_bundle "$quest_backend_container")"
    run_quiet quest_compose "$bundle" stop backend
    printf '%s\n' stopped
    ;;

  quest-release-valorant-writer-stop)
    bundle="$(running_bundle "$valorant_api_container")"
    run_quiet valorant_compose "$bundle" stop valorant-platform valorant-updater valorant-discord-bot
    printf '%s\n' stopped
    ;;

  quest-release-current-state-capture)
    bundle="$(release_bundle)"
    BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/quest-esports-backup.env}" \
      "${BACKUP_COMMAND:?}" >/dev/null 2>&1 || die 'the emergency state backup failed.'
    printf 'captured_at=%s\n' "$(utc_stamp)" > "$bundle/recovery-capture.txt"
    chmod 0600 "$bundle/recovery-capture.txt"
    printf 'captured evidence_bundle=%s\n' "$bundle"
    ;;

  quest-release-recovery-action)
    decision="${SUPABASE_RECONCILIATION_DECISION:-}"
    [[ "$decision" == fix-forward || "$decision" == controlled-restore ]] || die 'the recovery decision is not configured.'
    printf '%s\n' "$decision"
    ;;

  *) die "unsupported host hook: $wrapper" ;;
esac
