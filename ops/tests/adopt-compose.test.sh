#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
adoption_script="$script_directory/deploy/adopt-compose.sh"
[[ -f "$adoption_script" ]] || { printf 'FAIL: adoption controller is missing\n' >&2; exit 1; }

work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT
release_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
digest=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

make_fixture() {
  local fixture="$1"
  mkdir -p "$fixture/bin" "$fixture/release/releases" "$fixture/incoming" "$fixture/source"
  : > "$fixture/release.lock"
  printf '%s\n' 'name: quest-prod' > "$fixture/source/compose.production.yml"
  printf '%s\n' 'name: valorant-prod' > "$fixture/source/valorant.compose.yml"
  printf '%s\n' 'name: quest-adoption' > "$fixture/source/compose.adoption-candidate.yml"
  printf '%s\n' 'name: valorant-adoption' > "$fixture/source/valorant.adoption-candidate.yml"
  cat > "$fixture/incoming/release-manifest" <<EOF
commit_sha=$release_sha
frontend_image=ghcr.io/russelrip/quest-frontend@sha256:$digest
backend_image=ghcr.io/russelrip/quest-backend@sha256:$digest
migrator_image=ghcr.io/russelrip/quest-migrator@sha256:$digest
postgres_image=postgres:17-bookworm@sha256:$digest
valorant_image=ghcr.io/russelrip/valorant-platform-backend@sha256:$digest
EOF
  cat > "$fixture/bin/hook" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
name="$(basename "$0")"
printf '%s\n' "$name" >> "${ADOPTION_TEST_LOG:?}"
[[ "${ADOPTION_FAIL_AT:-}" != "$name" ]] || exit 1
case "$name" in
  validate-host) printf '%s\n' validated ;;
  audit-authority) printf '%s\n' 'vps-authoritative-audited source=quest-postgres:5433 schemas=public,valorant writers=quest,valorant' ;;
  verify-recovery) printf '%s\n' 'recovery-verified archive=verified checksum=verified remotes=verified restore=verified' ;;
  validate-candidate) printf '%s\n' 'candidate-validated database=postgresql17 schemas=public,valorant quest=frozen-ready valorant=frozen-ready' ;;
  arm-handoff) printf 'handoff-armed rollback=%s/rollback rpo=15m rto=60m\n' "${ADOPTION_FIXTURE:?}" ;;
  freeze-writers) printf '%s\n' 'frozen groups=quest,valorant' ;;
  stop-legacy) printf '%s\n' 'stopped groups=quest,valorant reboot_persistence=disabled' ;;
  final-backup) printf 'verified-complete release_sha=%s schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified\n' "${RELEASE_SHA:?}" ;;
  final-restore) printf '%s\n' 'restored target=quest-postgres:55432 schemas=public,valorant' ;;
  start-compose-frozen) printf '%s\n' 'started-frozen groups=quest,valorant readiness=verified' ;;
  enable-quest) printf '%s\n' 'admitted group=quest' ;;
  enable-valorant) printf '%s\n' 'admitted group=valorant' ;;
  verify-commit) printf 'compose-authoritative release_sha=%s current=verified writers=quest,valorant schemas=public,valorant\n' "${RELEASE_SHA:?}" ;;
  mask-legacy) printf '%s\n' 'masked groups=quest,valorant' ;;
  precommit-rollback|postcommit-freeze) printf '%s\n' recovered ;;
  *) exit 1 ;;
esac
HOOK
  chmod 0755 "$fixture/bin/hook"
  local name
  for name in validate-host audit-authority verify-recovery validate-candidate arm-handoff freeze-writers \
    stop-legacy final-backup final-restore start-compose-frozen enable-quest enable-valorant \
    verify-commit mask-legacy precommit-rollback postcommit-freeze; do
    cp "$fixture/bin/hook" "$fixture/bin/$name"
  done
  cat > "$fixture/release.env" <<EOF
RELEASE_ROOT=$fixture/release
RELEASES_ROOT=$fixture/release/releases
CURRENT_LINK=$fixture/release/current
RELEASE_LOCK_PATH=$fixture/release.lock
QUEST_COMPOSE_TEMPLATE=$fixture/source/compose.production.yml
VALORANT_COMPOSE_SOURCE=$fixture/source/valorant.compose.yml
QUEST_ADOPTION_COMPOSE_OVERLAY=$fixture/source/compose.adoption-candidate.yml
VALORANT_ADOPTION_COMPOSE_OVERLAY=$fixture/source/valorant.adoption-candidate.yml
QUEST_FRONTEND_IMAGE_APPROVED_REF=ghcr.io/russelrip/quest-frontend@sha256:$digest
QUEST_BACKEND_IMAGE_APPROVED_REF=ghcr.io/russelrip/quest-backend@sha256:$digest
MIGRATOR_IMAGE_APPROVED_REF=ghcr.io/russelrip/quest-migrator@sha256:$digest
POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:$digest
VALORANT_IMAGE_APPROVED_REF=ghcr.io/russelrip/valorant-platform-backend@sha256:$digest
FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA=$release_sha
ADOPTION_HOST_VALIDATE_COMMAND=$fixture/bin/validate-host
ADOPTION_AUTHORITY_AUDIT_COMMAND=$fixture/bin/audit-authority
ADOPTION_RECOVERY_VERIFY_COMMAND=$fixture/bin/verify-recovery
ADOPTION_CANDIDATE_VALIDATE_COMMAND=$fixture/bin/validate-candidate
ADOPTION_HANDOFF_ARM_COMMAND=$fixture/bin/arm-handoff
ADOPTION_FREEZE_COMMAND=$fixture/bin/freeze-writers
ADOPTION_LEGACY_STOP_COMMAND=$fixture/bin/stop-legacy
ADOPTION_FINAL_BACKUP_COMMAND=$fixture/bin/final-backup
ADOPTION_FINAL_RESTORE_COMMAND=$fixture/bin/final-restore
ADOPTION_COMPOSE_FROZEN_START_COMMAND=$fixture/bin/start-compose-frozen
ADOPTION_QUEST_WRITER_ENABLE_COMMAND=$fixture/bin/enable-quest
ADOPTION_VALORANT_WRITER_ENABLE_COMMAND=$fixture/bin/enable-valorant
ADOPTION_COMMIT_VERIFY_COMMAND=$fixture/bin/verify-commit
ADOPTION_LEGACY_MASK_COMMAND=$fixture/bin/mask-legacy
ADOPTION_PRECOMMIT_ROLLBACK_COMMAND=$fixture/bin/precommit-rollback
ADOPTION_POSTCOMMIT_FREEZE_COMMAND=$fixture/bin/postcommit-freeze
EOF
  chmod 0600 "$fixture/release.env"
}

run_adoption() {
  local fixture="$1"
  shift
  ADOPTION_TEST_FIXTURE=1 ADOPTION_FIXTURE="$fixture" ADOPTION_TEST_LOG="$fixture/hooks.log" \
    RELEASE_ENV_FILE="$fixture/release.env" "$@" bash "$adoption_script" \
    "$release_sha" "$fixture/incoming/release-manifest"
}

success_fixture="$work_directory/success"
make_fixture "$success_fixture"
run_adoption "$success_fixture"
[[ "$(realpath "$success_fixture/release/current")" == "$success_fixture/release/releases/$release_sha" ]]
grep -Fxq 'state=compose-authoritative' "$success_fixture/release/current/adoption-state.txt"
grep -Fxq 'writer_admitted=true' "$success_fixture/release/current/commit-point.txt"
grep -Fxq 'current_pointer_updated=true' "$success_fixture/release/current/release-metadata.txt"
grep -Fxq 'cutover_type=existing-vps-compose-adoption' "$success_fixture/release/current/release-metadata.txt"
grep -Fxq 'name: quest-adoption' "$success_fixture/release/current/compose.adoption-candidate.yml"
grep -Fxq 'name: valorant-adoption' "$success_fixture/release/current/valorant.adoption-candidate.yml"
grep -Fxq 'mask-legacy' "$success_fixture/hooks.log"

precommit_fixture="$work_directory/precommit"
make_fixture "$precommit_fixture"
if run_adoption "$precommit_fixture" env ADOPTION_FAIL_AT=validate-candidate >"$precommit_fixture/output" 2>&1; then
  printf 'FAIL: candidate failure was accepted\n' >&2
  exit 1
fi
[[ ! -e "$precommit_fixture/release/current" && ! -L "$precommit_fixture/release/current" ]]
grep -Fxq 'precommit-rollback' "$precommit_fixture/hooks.log"
! grep -Fxq 'postcommit-freeze' "$precommit_fixture/hooks.log"
grep -Fxq 'state=recovery-verified' "$precommit_fixture/release/releases/$release_sha/adoption-state.txt"

postcommit_fixture="$work_directory/postcommit"
make_fixture "$postcommit_fixture"
if run_adoption "$postcommit_fixture" env ADOPTION_FAIL_AT=enable-quest >"$postcommit_fixture/output" 2>&1; then
  printf 'FAIL: writer-admission failure was accepted\n' >&2
  exit 1
fi
[[ ! -e "$postcommit_fixture/release/current" && ! -L "$postcommit_fixture/release/current" ]]
grep -Fxq 'postcommit-freeze' "$postcommit_fixture/hooks.log"
! grep -Fxq 'precommit-rollback' "$postcommit_fixture/hooks.log"

approval_fixture="$work_directory/approval"
make_fixture "$approval_fixture"
sed -i 's/^FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA=.*/FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA=cccccccccccccccccccccccccccccccccccccccc/' "$approval_fixture/release.env"
if run_adoption "$approval_fixture" >"$approval_fixture/output" 2>&1; then
  printf 'FAIL: mismatched owner approval was accepted\n' >&2
  exit 1
fi
grep -Fq 'owner approval is not bound' "$approval_fixture/output"
[[ ! -e "$approval_fixture/release/current" && ! -L "$approval_fixture/release/current" ]]

printf '%s\n' 'Compose adoption controller tests passed.'
