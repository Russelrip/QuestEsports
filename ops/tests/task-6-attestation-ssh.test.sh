#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
repository_root="$script_directory/.."
deploy_workflow_file="$repository_root/.github/workflows/deploy-compose.yml"
legacy_workflow_file="$repository_root/.github/workflows/cd.yml"
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT

assert_failed() {
  local label="$1"
  shift
  if "$@" >"$work_directory/$label.out" 2>&1; then
    printf 'FAIL: %s unexpectedly passed\n' "$label" >&2
    exit 1
  fi
}

extract_step() {
  local workflow_file="$1" step_name="$2" output_file="$3"
  awk -v step_name="$step_name" '
    $0 == "      - name: " step_name { wanted=1; next }
    wanted && /^        run: \|$/ { capture=1; next }
    capture && (/^      - name:/ || /^  [a-z-]+:/) { exit }
    capture { sub(/^          /, ""); print }
  ' "$workflow_file" > "$output_file"
  test -s "$output_file"
  chmod 755 "$output_file"
}

attestation_helper="$work_directory/attestation-functions.sh"
awk '/^          verify_buildkit_attestations\(\) \{$/ { capture=1 } capture && /^          while IFS= read -r image_key; do$/ { exit } capture { sub(/^          /, ""); print }' "$deploy_workflow_file" > "$attestation_helper"
test -s "$attestation_helper"

python3 - "$work_directory" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
platform_digest = 'a' * 64
release_sha = '1' * 40
repository = 'Russelrip/QuestEsports'
builder_id = 'https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main'
empty_config_digest = 'sha256:' + hashlib.sha256(b'{}').hexdigest()

def statement(predicate_type, predicate, name='_', version='v1'):
    return {'_type': 'https://in-toto.io/Statement/' + version,
            'subject': [{'name': name, 'digest': {'sha256': platform_digest}}],
            'predicateType': predicate_type, 'predicate': predicate}

def write_blob(path, value):
    data = json.dumps(value, separators=(',', ':')).encode()
    path.write_bytes(data)
    digest = 'sha256:' + hashlib.sha256(data).hexdigest()
    path.with_name(digest.removeprefix('sha256:')).write_bytes(data)
    return digest, len(data)

def make_case(case):
    case_root = root / 'oci' / case
    blobs = case_root / 'blobs'
    blobs.mkdir(parents=True)
    revision = release_sha if case != 'wrong-provenance' else '2' * 40
    actual_builder_id = builder_id if case != 'wrong-builder' else 'wrong-builder'
    sbom_digest, sbom_size = write_blob(blobs / 'sbom', statement('https://spdx.dev/Document', {}))
    provenance = statement('https://slsa.dev/provenance/v0.2', {
        'buildType': 'https://mobyproject.org/buildkit@v1',
        'builder': {'id': actual_builder_id},
        'invocation': {'parameters': {
            'build-arg:QUEST_BUILD_REVISION': revision,
            'build-arg:QUEST_BUILD_REPOSITORY': repository,
            'build-arg:QUEST_BUILD_BRANCH': 'main',
            'build-arg:QUEST_BUILD_WORKFLOW': 'Build container images'}},
        }, 'linux/amd64', 'v0.1')
    provenance_digest, provenance_size = write_blob(blobs / 'provenance', provenance)
    if case == 'malformed-statement':
        data = b'{not-json}'
        (blobs / 'provenance').write_bytes(data)
        provenance_digest, provenance_size = 'sha256:' + hashlib.sha256(data).hexdigest(), len(data)
        (blobs / (provenance_digest.removeprefix('sha256:'))).write_bytes(data)
    if case == 'wrong-layer-digest':
        (blobs / ('f' * 64)).write_bytes((blobs / 'provenance').read_bytes())
        provenance_digest = 'sha256:' + 'f' * 64
    subject_digest = 'sha256:' + ('e' * 64 if case == 'wrong-subject' else platform_digest)

    def layer(digest, size, predicate_type):
        return {'mediaType': 'application/vnd.in-toto+json', 'digest': digest, 'size': size,
                'annotations': {'in-toto.io/predicate-type': predicate_type}}

    def manifest(layers):
        return {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
          'artifactType': 'application/vnd.docker.attestation.manifest.v1+json',
          'config': {'mediaType': 'application/vnd.oci.empty.v1+json', 'digest': empty_config_digest, 'size': 2},
          'subject': {'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': subject_digest, 'size': 123},
          'layers': layers}

    layers = [layer(sbom_digest, sbom_size, 'https://spdx.dev/Document'), layer(provenance_digest, provenance_size, 'https://slsa.dev/provenance/v0.2')]
    if case == 'wrong-layer-size':
        layers[0]['size'] += 1
    if case == 'unknown-layer':
        layers[0]['mediaType'] = 'application/octet-stream'
    if case == 'duplicate-provenance':
        layers = [layer(provenance_digest, provenance_size, 'https://slsa.dev/provenance/v0.2'), layer(provenance_digest, provenance_size, 'https://slsa.dev/provenance/v0.2')]
    (case_root / 'attestation-b.json').write_text(json.dumps(manifest(layers)), encoding='utf-8')
    descriptors = [
      {'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:' + platform_digest, 'size': 123, 'platform': {'os': 'linux', 'architecture': 'amd64'}},
      {'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:' + 'b' * 64, 'size': 1, 'annotations': {'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': 'sha256:' + platform_digest}},
    ]
    if case == 'ambiguous-platform':
        descriptors.insert(1, {'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:' + 'd' * 64, 'size': 123, 'platform': {'os': 'linux', 'architecture': 'amd64'}})
    if case == 'missing-attestation':
        descriptors.pop()
    (case_root / 'index.json').write_text(json.dumps({'schemaVersion': 2, 'manifests': descriptors}), encoding='utf-8')

for case in ('valid', 'malformed-statement', 'missing-attestation', 'ambiguous-platform', 'wrong-subject', 'wrong-layer-digest', 'wrong-layer-size', 'unknown-layer', 'wrong-provenance', 'wrong-builder', 'duplicate-provenance'):
    make_case(case)
PY

mock_bin="$work_directory/bin"
mkdir -p "$mock_bin"
cat > "$mock_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
digest="${!#}"
digest="${digest##*@}"
case "$digest" in
  sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) cat "$OCI_CASE_ROOT/index.json" ;;
  sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) cat "$OCI_CASE_ROOT/attestation-b.json" ;;
  *) exit 1 ;;
esac
EOF
cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
digest="${!#}"
digest="${digest##*/}"
cat "$OCI_CASE_ROOT/blobs/${digest#sha256:}"
EOF
cat > "$mock_bin/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
platform_digest=''
raw=''
while (($#)); do
  case "$1" in
    --arg) [[ "$2" == platform_digest ]] && platform_digest="$3"; shift 3 ;;
    -e|-r|-er) shift ;;
    *) raw="$1"; shift; [[ "$raw" == *"'"* ]] || break ;;
  esac
done
expression="$raw"
file="${!#}"
python3 - "$expression" "$file" "$platform_digest" <<'PY'
import json
import sys

expression, path, platform_digest = sys.argv[1:]
try:
    with open(path, encoding='utf-8') as source:
        document = json.load(source)
except Exception:
    raise SystemExit(1)

if 'platform.os' in expression:
    values = [item['digest'] for item in document.get('manifests', [])
              if item.get('platform', {}).get('os') == 'linux'
              and item.get('platform', {}).get('architecture') == 'amd64']
    if len(values) != 1:
        raise SystemExit(1)
    sys.stdout.buffer.write((values[0] + '\n').encode())
elif 'vnd.docker.reference.type' in expression:
    values = [item['digest'] for item in document.get('manifests', [])
              if item.get('annotations', {}).get('vnd.docker.reference.type') == 'attestation-manifest'
              and item.get('annotations', {}).get('vnd.docker.reference.digest') == platform_digest]
    if len(values) != 1 or len(set(values)) != 1:
        raise SystemExit(1)
    sys.stdout.buffer.write(('\n'.join(values) + '\n').encode())
elif '.layers[]' in expression and '@tsv' in expression:
    for layer in document.get('layers', []):
        sys.stdout.buffer.write(('\t'.join((layer['digest'], str(layer['size']), layer['annotations']['in-toto.io/predicate-type'])) + '\n').encode())
elif '.artifactType' in expression:
    config = document.get('config', {})
    subject = document.get('subject', {})
    layers = document.get('layers', [])
    valid = (
        document.get('mediaType') == 'application/vnd.oci.image.manifest.v1+json'
        and document.get('artifactType') == 'application/vnd.docker.attestation.manifest.v1+json'
        and subject.get('digest') == platform_digest
        and subject.get('mediaType') in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json')
        and isinstance(subject.get('size'), int) and subject['size'] > 0
        and config.get('mediaType') == 'application/vnd.oci.empty.v1+json'
        and config.get('size') == 2
        and config.get('digest') == 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
        and layers
        and all(layer.get('mediaType') == 'application/vnd.in-toto+json' for layer in layers)
    )
    if not valid:
        raise SystemExit(1)
else:
    raise SystemExit(1)
PY
EOF
chmod 755 "$mock_bin/docker" "$mock_bin/curl"
chmod 755 "$mock_bin/jq"

run_attestation_case() {
  local case_name="$1"
  OCI_CASE_ROOT="$work_directory/oci/$case_name" PATH="$mock_bin:$PATH" \
    RELEASE_SHA=1111111111111111111111111111111111111111 GITHUB_REPOSITORY=Russelrip/QuestEsports \
    bash -c 'set -euo pipefail; source "$1"; attestation_tmp_dir="$(mktemp -d)"; trap "rm -rf -- \"$attestation_tmp_dir\"" EXIT; verify_buildkit_attestations ghcr.io/russelrip/quest-backend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' _ "$attestation_helper"
}
run_attestation_case valid
for case_name in malformed-statement missing-attestation ambiguous-platform wrong-subject wrong-layer-digest wrong-layer-size unknown-layer wrong-provenance wrong-builder duplicate-provenance; do
  assert_failed "attestation-$case_name" run_attestation_case "$case_name"
done

compose_config="$work_directory/compose-configure.sh"
legacy_config="$work_directory/legacy-configure.sh"
compose_transfer="$work_directory/compose-transfer.sh"
legacy_deploy="$work_directory/legacy-deploy.sh"
compose_cleanup="$work_directory/compose-cleanup.sh"
legacy_cleanup="$work_directory/legacy-cleanup.sh"
extract_step "$deploy_workflow_file" 'Configure the pinned deploy SSH connection' "$compose_config"
extract_step "$legacy_workflow_file" 'Configure SSH' "$legacy_config"
extract_step "$deploy_workflow_file" 'Transfer the verified manifest and invoke the fixed root deployment script' "$compose_transfer"
extract_step "$legacy_workflow_file" 'Deploy backend over SSH' "$legacy_deploy"
extract_step "$deploy_workflow_file" 'Cleanup temporary deploy SSH material' "$compose_cleanup"
extract_step "$legacy_workflow_file" 'Cleanup temporary legacy SSH material' "$legacy_cleanup"

ssh_runner_temp="$work_directory/runner-temp"
mkdir -p "$ssh_runner_temp"
valid_host_key='[example.test]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey task-6'
run_configure() {
  local script="$1" port="$2" host_key="$3" env_file="$4"
  SSH_PRIVATE_KEY='private-key' SSH_HOST=example.test SSH_PORT="$port" SSH_USER=deploy SSH_HOST_KEY="$host_key" RUNNER_TEMP="$ssh_runner_temp" GITHUB_ENV="$env_file" bash "$script"
}
run_configure "$compose_config" 2222 "$valid_host_key" "$work_directory/compose.env"
run_configure "$legacy_config" 2222 "$valid_host_key" "$work_directory/legacy.env"
run_configure "$compose_config" 22 'example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey task-6' "$work_directory/compose-default.env"
bad_runner_temp="$work_directory/bad-runner-temp"
mkdir -p "$bad_runner_temp"
ssh_runner_temp="$bad_runner_temp"
assert_failed compose-wrong-host-key run_configure "$compose_config" 2222 'wrong.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey task-6' "$work_directory/bad.env"
assert_failed legacy-wrong-host-key run_configure "$legacy_config" 2222 'wrong.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey task-6' "$work_directory/bad-legacy.env"
test "$(find "$bad_runner_temp" -mindepth 1 -maxdepth 1 -type d -print | wc -l)" = 0
ssh_runner_temp="$work_directory/runner-temp"

ssh_material="$ssh_runner_temp/ssh-material"
mkdir -p "$ssh_material"
printf '%s\n' private-key > "$ssh_material/id_ed25519"
printf '%s\n' "$valid_host_key" > "$ssh_material/known_hosts"
chmod 600 "$ssh_material/id_ed25519" "$ssh_material/known_hosts"
ssh_log="$work_directory/ssh.log"
cat > "$mock_bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'timeout:' >> "$SSH_LOG"
printf '<%s>' "$@" >> "$SSH_LOG"
printf '\n' >> "$SSH_LOG"
[[ "${TIMEOUT_FAIL:-0}" == 1 ]] && exit 124
[[ "$1" == --foreground ]] && shift
shift
exec "$@"
EOF
cat > "$mock_bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ssh_host=''
remote_command=''
while (($#)); do
  case "$1" in
    -o|-p|-i) shift 2 ;;
    --)
      shift
      ssh_host="$1"
      shift
      remote_command="$*"
      break
      ;;
    *) shift ;;
  esac
done
printf 'ssh-host:<%s>\n' "$ssh_host" >> "$SSH_LOG"
printf 'ssh-remote-command:<%s>\n' "$remote_command" >> "$SSH_LOG"
if [[ "$remote_command" == 'bash -s -- '* ]]; then
  remote_command="$FAKE_REMOTE_SCRIPT ${remote_command#bash -s -- }"
fi
/usr/bin/bash -c "$remote_command"
EOF
cat > "$mock_bin/scp" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'scp:' >> "$SSH_LOG"
printf '<%s>' "$@" >> "$SSH_LOG"
printf '\n' >> "$SSH_LOG"
exit 0
EOF
cat > "$mock_bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == -n ]] && shift
[[ "${1:-}" == -- ]] && shift
[[ "${1:-}" == /usr/local/sbin/quest-esports-release ]] || { echo 'unexpected sudo command' >&2; exit 1; }
shift
exec "$FAKE_REMOTE_SCRIPT" "$@"
EOF
cat > "$work_directory/fake-remote-script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'remote-argv:' >> "$REMOTE_ARG_LOG"
index=0
for remote_argument in "$@"; do
  printf '<arg[%s]=%s>' "$index" "$remote_argument" >> "$REMOTE_ARG_LOG"
  index=$((index + 1))
done
printf '\n' >> "$REMOTE_ARG_LOG"
EOF
chmod 755 "$mock_bin/timeout" "$mock_bin/ssh" "$mock_bin/scp"
chmod 755 "$mock_bin/sudo" "$work_directory/fake-remote-script"

remote_arg_log="$work_directory/remote-args.log"
SSH_LOG="$ssh_log" REMOTE_ARG_LOG="$remote_arg_log" FAKE_REMOTE_SCRIPT="$work_directory/fake-remote-script" SSH_MATERIAL_DIR="$ssh_material" RUNNER_TEMP="$ssh_runner_temp" RELEASE_SHA=1111111111111111111111111111111111111111 SSH_HOST=example.test SSH_PORT=2222 SSH_USER=deploy PATH="$mock_bin:$PATH" bash "$compose_transfer"
grep -Fq '<deploy@example.test>' "$ssh_log"
grep -Fq '</usr/local/sbin/quest-esports-release>' "$ssh_log"
grep -Fq '<1111111111111111111111111111111111111111>' "$ssh_log"
grep -Fq '<-->' "$ssh_log"
grep -Fq '<120s>' "$ssh_log"

: > "$ssh_log"
SSH_LOG="$ssh_log" REMOTE_ARG_LOG="$remote_arg_log" FAKE_REMOTE_SCRIPT="$work_directory/fake-remote-script" SSH_MATERIAL_DIR="$ssh_material" RUNNER_TEMP="$ssh_runner_temp" DEPLOY_SHA=1111111111111111111111111111111111111111 SSH_HOST=example.test SSH_PORT=2222 SSH_USER=deploy APP_DIR=/var/www/QuestEsports PM2_PROCESS=quest-backend HEALTHCHECK_URL=http://127.0.0.1:5001/api/health DESTRUCTIVE_MIGRATION_APPROVAL_SHA='' MOBILE_ANDROID_CERT_SHA256='' REPAIR_LEGACY_MEDIA=false OPTIMIZE_TOURNAMENT_BANNERS=false OPTIMIZE_EVENT_ALBUM_PHOTOS=false INITIALIZE_MATCH_ROOMS=false REPAIR_DATABASE_SSL=false REPAIR_MOBILE_ANDROID_FINGERPRINT=false REPAIR_MOBILE_OAUTH_REDIRECT=false PATH="$mock_bin:$PATH" bash "$legacy_deploy"
grep -Fq "''" "$ssh_log"
grep -Fq '/var/www/QuestEsports' "$ssh_log"
grep -Fq '1111111111111111111111111111111111111111' "$ssh_log"
grep -Fq '<180s>' "$ssh_log"
grep -Fq 'remote-argv:<arg[0]=/var/www/QuestEsports><arg[1]=quest-backend><arg[2]=http://127.0.0.1:5001/api/health><arg[3]=><arg[4]=><arg[5]=false><arg[6]=false><arg[7]=false><arg[8]=false><arg[9]=false><arg[10]=false><arg[11]=false><arg[12]=1111111111111111111111111111111111111111>' "$remote_arg_log"
remote_invocations_before_rejection="$(grep -c '^remote-argv:' "$remote_arg_log")"
assert_failed legacy-metacharacter env SSH_MATERIAL_DIR="$ssh_material" RUNNER_TEMP="$ssh_runner_temp" DEPLOY_SHA=1111111111111111111111111111111111111111 SSH_HOST=example.test SSH_PORT=2222 SSH_USER=deploy APP_DIR=/var/www/QuestEsports PM2_PROCESS='quest;touch' HEALTHCHECK_URL=http://127.0.0.1:5001/api/health DESTRUCTIVE_MIGRATION_APPROVAL_SHA='' MOBILE_ANDROID_CERT_SHA256='' REPAIR_LEGACY_MEDIA=false OPTIMIZE_TOURNAMENT_BANNERS=false OPTIMIZE_EVENT_ALBUM_PHOTOS=false INITIALIZE_MATCH_ROOMS=false REPAIR_DATABASE_SSL=false REPAIR_MOBILE_ANDROID_FINGERPRINT=false REPAIR_MOBILE_OAUTH_REDIRECT=false PATH="$mock_bin:$PATH" bash "$legacy_deploy"
test "$(grep -c '^remote-argv:' "$remote_arg_log")" = "$remote_invocations_before_rejection"
if grep -Fq 'quest;touch' "$remote_arg_log"; then
  echo 'metacharacter reached the executable remote script' >&2
  exit 1
fi
assert_failed compose-timeout env TIMEOUT_FAIL=1 SSH_LOG="$ssh_log" SSH_MATERIAL_DIR="$ssh_material" RUNNER_TEMP="$ssh_runner_temp" RELEASE_SHA=1111111111111111111111111111111111111111 SSH_HOST=example.test SSH_PORT=2222 SSH_USER=deploy PATH="$mock_bin:$PATH" bash "$compose_transfer"
SSH_MATERIAL_DIR="$ssh_material" RUNNER_TEMP="$ssh_runner_temp" bash "$compose_cleanup"
test ! -e "$ssh_material"

printf 'task-6 attestation and SSH fixtures passed\n'
