#!/usr/bin/env bash
# Fixture tests for ops/deploy/verify-backup-evidence.sh.
#
# The consumer is the release-bound replacement for trusting a free-form
# backup-evidence hook: it must recompute every claim from the archive, its
# single checksum row, the terminal result record, each configured remote, and
# the signed rehearsal bundle. These fixtures contact no database, no VPS and no
# real remote; age and rclone are replaced with local stand-ins.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CONSUMER="$ROOT/ops/deploy/verify-backup-evidence.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quest-backup-evidence-fixture.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

RELEASE_SHA=1111111111111111111111111111111111111111
ARCHIVE_NAME=quest-production-20260906T120000Z.tar.gz.enc
failures=0
pass() { printf 'ok: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }

# The consumer inventories a tree exactly as the backup producer and the restore
# path do; the fixture reuses that shape so a mismatch is a real regression.
inventory_tree() {
  local root="$1" output="$2" entry relative
  : > "$output"
  while IFS= read -r -d '' entry; do
    relative="${entry#"$root"/}"
    if [[ -d "$entry" ]]; then
      printf 'directory\t%s\n' "$relative" >> "$output"
    else
      printf 'file\t%s\t%s\t%s\n' "$relative" "$(stat -c '%s' -- "$entry")" "$(sha256sum -- "$entry" | awk '{print $1}')" >> "$output"
    fi
  done < <(find -P "$root" -mindepth 1 -print0 | sort -z)
}

write_contract() {
  local case_dir="$1"
  {
    printf 'format_version=1\n'
    printf 'record_type=quest-release-backup-evidence\n'
    printf 'release_sha=%s\n' "${CONTRACT_RELEASE_SHA:-$RELEASE_SHA}"
    printf 'archive_name=%s\n' "$ARCHIVE_NAME"
    printf 'archive_sha256=%s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME" | awk '{print $1}')"
    printf 'checksum_sha256=%s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME.sha256" | awk '{print $1}')"
    printf 'backup_result_sha256=%s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME.results" | awk '{print $1}')"
    printf 'remote_labels=%s\n' "${CONTRACT_REMOTE_LABELS:-primary}"
    printf 'rehearsal_evidence_dir=%s\n' "$case_dir/rehearsal"
    printf 'freshness_status=verified\n'
    printf 'archive_status=verified\n'
    printf 'decryption_status=verified\n'
    printf 'remote_status=verified\n'
    printf 'rehearsal_status=verified\n'
  } > "$case_dir/contract.env"
}

build_case() {
  local case_name="$1"
  local case_dir="$TEST_ROOT/$case_name"
  rm -rf -- "$case_dir"
  mkdir -p "$case_dir/backups" "$case_dir/bin" "$case_dir/payload/public/poster-images" \
           "$case_dir/payload/private/event-album-originals" "$case_dir/rehearsal"
  printf 'poster\n' > "$case_dir/payload/public/poster-images/poster.png"
  printf 'original\n' > "$case_dir/payload/private/event-album-originals/original.png"
  inventory_tree "$case_dir/payload/public" "$case_dir/payload/public-upload-inventory.tsv"
  inventory_tree "$case_dir/payload/private" "$case_dir/payload/private-upload-inventory.tsv"
  {
    printf 'release_sha=%s\n' "$RELEASE_SHA"
    printf 'database_scope=application_public_and_valorant_schemas\n'
    printf 'valorant_schema_included=true\n'
    printf 'public_upload_inventory=public-upload-inventory.tsv\n'
    printf 'private_upload_inventory=private-upload-inventory.tsv\n'
    printf 'public_upload_inventory_sha256=%s\n' "$(sha256sum "$case_dir/payload/public-upload-inventory.tsv" | awk '{print $1}')"
    printf 'private_upload_inventory_sha256=%s\n' "$(sha256sum "$case_dir/payload/private-upload-inventory.tsv" | awk '{print $1}')"
  } > "$case_dir/payload/manifest.txt"
  tar --create --gzip --file "$case_dir/plaintext.tar.gz" -C "$case_dir/payload" .

  # The fixture "encryption" is a copy; the fake age reverses it, so the consumer
  # still exercises its real tar inspection, manifest and inventory comparisons.
  cp "$case_dir/plaintext.tar.gz" "$case_dir/backups/$ARCHIVE_NAME"
  printf '%s  %s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME" | awk '{print $1}')" "$ARCHIVE_NAME" \
    > "$case_dir/backups/$ARCHIVE_NAME.sha256"
  printf 'archive=%s\nrelease_sha=%s\nstatus=success\nexit_status=0\n' "$ARCHIVE_NAME" "$RELEASE_SHA" \
    > "$case_dir/backups/$ARCHIVE_NAME.results"

  cat > "$case_dir/bin/age" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
output=""; source_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --decrypt) shift ;;
    --identity) shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) source_file="$1"; shift ;;
  esac
done
[[ -n "$output" && -n "$source_file" ]] || exit 1
cp -- "$source_file" "$output"
FAKE
  cat > "$case_dir/bin/rclone" <<'FAKE'
#!/usr/bin/env bash
[[ "${FIXTURE_REMOTE_MISSING:-0}" == 1 ]] && exit 1
exit 0
FAKE
  cat > "$case_dir/rehearsal-verify.sh" <<'FAKE'
#!/usr/bin/env bash
[[ "${FIXTURE_REHEARSAL_INVALID:-0}" == 1 ]] && exit 1
exit 0
FAKE
  chmod 755 "$case_dir/bin/age" "$case_dir/bin/rclone" "$case_dir/rehearsal-verify.sh"
  printf 'fixture identity\n' > "$case_dir/age-identity.txt"
  printf 'fixture key\n' > "$case_dir/signing-public.pem"
  printf 'fixture config\n' > "$case_dir/primary.conf"

  {
    printf 'BACKUP_EVIDENCE_CONTRACT_FILE=%s\n' "$case_dir/contract.env"
    printf 'BACKUP_ROOT=%s\n' "$case_dir/backups"
    printf 'BACKUP_AGE_IDENTITY_FILE=%s\n' "$case_dir/age-identity.txt"
    printf 'REHEARSAL_VERIFY_COMMAND=%s\n' "$case_dir/rehearsal-verify.sh"
    printf 'REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY=%s\n' "$case_dir/signing-public.pem"
    printf 'BACKUP_RCLONE_REMOTES=primary=primary:quest/backups\n'
    printf 'BACKUP_RCLONE_CONFIGS=primary=%s\n' "$case_dir/primary.conf"
  } > "$case_dir/backup.env"
  write_contract "$case_dir"
  printf '%s\n' "$case_dir"
}

run_consumer() {
  local case_dir="$1"
  PATH="$case_dir/bin:$PATH" QUEST_DEPLOY_FIXTURE=1 BACKUP_ENV_FILE="$case_dir/backup.env" \
    bash "$CONSUMER" --release-sha "$RELEASE_SHA" 2>&1
}

expect_success() {
  local label="$1" case_dir="$2" output
  if output="$(run_consumer "$case_dir")" && [[ "$output" == "verified-complete release_sha=$RELEASE_SHA schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified" ]]; then
    pass "$label"
  else
    fail "$label (output: $output)"
  fi
}

expect_refusal() {
  local label="$1" case_dir="$2" needle="$3" output
  if output="$(run_consumer "$case_dir")"; then
    fail "$label unexpectedly succeeded"
  elif [[ "$output" == *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label refused with the wrong diagnostic (output: $output)"
  fi
}

case_dir="$(build_case happy)"
expect_success 'a complete release-bound evidence set is verified end to end' "$case_dir"

case_dir="$(build_case legacy-single-remote)"
sed -i '/^BACKUP_RCLONE_REMOTES=/d; /^BACKUP_RCLONE_CONFIGS=/d' "$case_dir/backup.env"
printf 'BACKUP_RCLONE_REMOTE=primary:quest/backups\nRCLONE_CONFIG=%s\n' "$case_dir/primary.conf" >> "$case_dir/backup.env"
CONTRACT_REMOTE_LABELS=legacy write_contract "$case_dir"
expect_success 'the transition-only singular remote contract is verified symmetrically' "$case_dir"

case_dir="$(build_case wrong-release)"
CONTRACT_RELEASE_SHA=2222222222222222222222222222222222222222 write_contract "$case_dir"
expect_refusal 'a contract naming another release is refused' "$case_dir" 'not bound to the requested release'

case_dir="$(build_case credential-leak)"
printf 'rehearsal_evidence_dir=rclone://token@example.invalid\n' >> "$case_dir/contract.env"
expect_refusal 'a contract carrying a URL or credential is refused' "$case_dir" 'contains'

case_dir="$(build_case checksum-mismatch)"
printf '%s  %s\n' "$(printf 'other' | sha256sum | awk '{print $1}')" "$ARCHIVE_NAME" > "$case_dir/backups/$ARCHIVE_NAME.sha256"
write_contract "$case_dir"
expect_refusal 'a checksum row that does not hash the archive is refused' "$case_dir" 'archive checksum is not bound to the selected archive'

case_dir="$(build_case extra-checksum-row)"
printf '%s  %s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME" | awk '{print $1}')" "decoy.tar.gz.enc" >> "$case_dir/backups/$ARCHIVE_NAME.sha256"
write_contract "$case_dir"
expect_refusal 'an ambiguous multi-row checksum file is refused' "$case_dir" 'exactly one row'

case_dir="$(build_case failed-result)"
printf 'archive=%s\nrelease_sha=%s\nstatus=failed\nexit_status=1\n' "$ARCHIVE_NAME" "$RELEASE_SHA" > "$case_dir/backups/$ARCHIVE_NAME.results"
write_contract "$case_dir"
expect_refusal 'a non-terminal or failed backup result is refused' "$case_dir" 'backup result is not successful'

case_dir="$(build_case tampered-upload-tree)"
printf 'tampered\n' > "$case_dir/payload/public/poster-images/poster.png"
tar --create --gzip --file "$case_dir/plaintext.tar.gz" -C "$case_dir/payload" .
cp "$case_dir/plaintext.tar.gz" "$case_dir/backups/$ARCHIVE_NAME"
printf '%s  %s\n' "$(sha256sum "$case_dir/backups/$ARCHIVE_NAME" | awk '{print $1}')" "$ARCHIVE_NAME" > "$case_dir/backups/$ARCHIVE_NAME.sha256"
write_contract "$case_dir"
expect_refusal 'an upload tree that diverges from its source inventory is refused' "$case_dir" 'does not match its source inventory'

case_dir="$(build_case remote-label-mismatch)"
CONTRACT_REMOTE_LABELS='primary,secondary' write_contract "$case_dir"
expect_refusal 'a contract label set wider than the configuration is refused' "$case_dir" 'remote evidence label set is incomplete'

case_dir="$(build_case remote-missing-archive)"
export FIXTURE_REMOTE_MISSING=1
expect_refusal 'a remote without the verified archive pair is refused' "$case_dir" 'configured remote does not contain the verified archive pair'
unset FIXTURE_REMOTE_MISSING

case_dir="$(build_case rehearsal-invalid)"
export FIXTURE_REHEARSAL_INVALID=1
expect_refusal 'a failed signed rehearsal verification is refused' "$case_dir" 'signed rehearsal evidence verification failed'
unset FIXTURE_REHEARSAL_INVALID

(( failures == 0 )) || { printf '%s backup evidence consumer test(s) failed.\n' "$failures" >&2; exit 1; }
printf 'backup evidence consumer fixture tests passed (no database, VPS, or remote contacted).\n'
