#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'verification failed: %s\n' "$*" >&2; exit 1; }
release_lock_path="${RELEASE_LOCK_PATH:-/var/lock/quest-esports-release.lock}"
[[ "$release_lock_path" == /* && "$release_lock_path" != / && -e "$release_lock_path" ]] || die 'the canonical release lock must be a pre-created absolute path.'
if [[ "${QUEST_DEPLOY_FIXTURE:-0}" != 1 ]]; then
  [[ "$release_lock_path" == /var/lock/quest-esports-release.lock ]] || die 'the canonical release lock path cannot be overridden.'
fi
exec 9>"$release_lock_path" || die 'the canonical release lock is not writable.'
flock -n 9 || die 'another release operation is already running.'
fixture_mode="${QUEST_DEPLOY_FIXTURE:-0}"
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(id -u)" == 0 ]] || die 'verify-release.sh must run as root.'
  [[ "$(stat -c '%u %a' "$release_lock_path" 2>/dev/null)" == '0 660' ]] || die 'canonical release lock must be root-owned with mode 0660.'
fi
release_env_file="${RELEASE_ENV_FILE:-/etc/quest-esports/release.env}"
[[ "$release_env_file" == /* && "$release_env_file" != / ]] || die 'release environment must be an absolute non-root path.'
[[ -f "$release_env_file" && -r "$release_env_file" && ! -L "$release_env_file" ]] || die 'release environment is missing or unsafe.'
if [[ "$fixture_mode" != 1 ]]; then
  env_stat="$(stat -c '%u %a' "$release_env_file" 2>/dev/null)" || die 'cannot inspect release environment ownership.'
  [[ "$env_stat" == 0\ * ]] || die 'release environment must be root-owned.'
  env_mode="${env_stat##* }"
  [[ "$env_mode" == 600 || "$env_mode" == 640 ]] || die 'release environment must be mode 0600 or 0640.'
  [[ "$(realpath "$release_env_file" 2>/dev/null)" == /etc/quest-esports/release.env ]] || die 'release environment must use the canonical host path.'
fi
# shellcheck disable=SC1090
source "$release_env_file"
require_setting() { [[ -n "${!1:-}" ]] || die "missing release setting: $1"; }
require_setting RELEASE_ENVIRONMENT
require_setting RELEASE_ENVIRONMENT_PROTECTED
[[ "$RELEASE_ENVIRONMENT" == production && "$RELEASE_ENVIRONMENT_PROTECTED" == 1 ]] || die 'release environment is not the protected production environment.'
for setting in RELEASE_ROOT DOCKER_BIN QUEST_HEALTH_URL QUEST_READINESS_URL VALORANT_HEALTH_URL VALORANT_CA_FILE CURL_BIN DATABASE_READINESS_COMMAND SECURITY_VERIFY_COMMAND VALORANT_CONTAINER_HEALTH_COMMAND COSIGN_BIN QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP QUEST_COSIGN_OIDC_ISSUER POSTGRES_IMAGE_APPROVED_REF VALORANT_RUNTIME_COMPOSE_CONTRACT RECOVERY_ADMIN_URL_FILE; do require_setting "$setting"; done
[[ "${QUEST_HEALTH_URL}" == http://127.0.0.1:5001/api/health/live ]] || die 'Quest liveness endpoint identity is not fixed.'
[[ "${QUEST_READINESS_URL}" == http://127.0.0.1:5001/api/health/ready ]] || die 'Quest readiness endpoint identity is not fixed.'
[[ "${VALORANT_HEALTH_URL}" == https://valorant-platform:8000/api/v1/health ]] || die 'VALORANT health endpoint identity is not fixed.'
[[ "$RELEASE_ROOT" == /* && "$RELEASE_ROOT" != / ]] || die 'RELEASE_ROOT must be absolute and non-root.'
releases_root="${RELEASES_ROOT:-$RELEASE_ROOT/releases}"
[[ "$releases_root" == /* && "$releases_root" != / && -d "$RELEASE_ROOT" && ! -L "$RELEASE_ROOT" ]] || die 'release roots must be absolute existing non-symlink directories.'
[[ -d "$releases_root" && ! -L "$releases_root" ]] || die 'RELEASES_ROOT must be an existing non-symlink directory.'
canonical_releases_root="$(realpath "$releases_root" 2>/dev/null)" || die 'RELEASES_ROOT cannot be canonicalized.'
[[ "$canonical_releases_root" == "$releases_root" ]] || die 'RELEASES_ROOT must not contain a symlink.'
[[ -x "$DOCKER_BIN" && -x "$CURL_BIN" && -x "$DATABASE_READINESS_COMMAND" && -x "$SECURITY_VERIFY_COMMAND" && -x "$VALORANT_CONTAINER_HEALTH_COMMAND" && -x "$COSIGN_BIN" ]] || die 'verification command is not executable.'
[[ -f "$VALORANT_CA_FILE" && -r "$VALORANT_CA_FILE" && ! -L "$VALORANT_CA_FILE" ]] || die 'VALORANT_CA_FILE is missing or unsafe.'
[[ -f "$RECOVERY_ADMIN_URL_FILE" && -r "$RECOVERY_ADMIN_URL_FILE" && ! -L "$RECOVERY_ADMIN_URL_FILE" ]] || die 'recovery administrator URL file is missing or unsafe.'
if [[ "$fixture_mode" != 1 ]]; then
  [[ "$(stat -c '%u %a' "$RECOVERY_ADMIN_URL_FILE" 2>/dev/null)" == '0 600' || "$(stat -c '%u %a' "$RECOVERY_ADMIN_URL_FILE" 2>/dev/null)" == '0 640' ]] || die 'recovery administrator URL file must be root-owned and private.'
fi
validate_security_url_file() {
  python3 - "$(< "$RECOVERY_ADMIN_URL_FILE")" <<'PY' || die 'recovery administrator URL is not the canonical verify-full private target.'
from urllib.parse import urlsplit
import sys
u = urlsplit(sys.argv[1])
if (u.scheme not in ("postgres", "postgresql") or u.hostname != "quest-postgres" or u.port != 5432 or
        u.username != "quest_recovery_admin" or not u.password or u.path != "/quest" or u.fragment or
        u.query.split("&") != ["sslmode=verify-full", "sslrootcert=/run/secrets/quest-private-ca.crt"]):
    raise SystemExit(1)
PY
}
validate_security_url_file
validate_rendered_valorant_compose() {
  local source_json_file contract_json_file expected_image
  expected_image="$(awk -F= '$1 == "VALORANT_IMAGE" { print substr($0, index($0,"=")+1); exit }' "$release_dir/.env")"
  source_json_file="$(mktemp)" || die 'could not create the rendered VALORANT Compose source file.'
  contract_json_file="$(mktemp)" || { rm -f "$source_json_file"; die 'could not create the rendered VALORANT Compose contract file.'; }
  chmod 600 "$source_json_file" "$contract_json_file"
  "$DOCKER_BIN" compose --env-file "$release_dir/.env" -f "$release_dir/valorant.compose.yml" --project-name valorant-prod config --no-env-resolution --format json >"$source_json_file" 2>/dev/null || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose source is invalid.'; }
  "$DOCKER_BIN" compose --env-file "$release_dir/.env" -f "$VALORANT_RUNTIME_COMPOSE_CONTRACT" --project-name valorant-prod config --no-env-resolution --format json >"$contract_json_file" 2>/dev/null || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose contract is invalid.'; }
  python3 - "$source_json_file" "$contract_json_file" "$expected_image" "$release_dir/valorant.compose.yml" "$VALORANT_RUNTIME_COMPOSE_CONTRACT" <<'PY' || { rm -f "$source_json_file" "$contract_json_file"; die 'rendered VALORANT Compose source does not satisfy the asyncpg TLS runtime contract.'; }
import json, re, sys

ENV_FILE_PATH = "/etc/quest-esports/valorant.production.env"
CA_SOURCE = "/etc/quest-esports/tls/quest-private-ca.crt"
CA_TARGET = "/run/secrets/quest-private-ca.crt"
# Only these keys are compared. Compose >= 2.40 inlines the protected env file
# into `environment` even under --no-env-resolution, so every other rendered key
# may be a resolved secret and must never enter this comparison.
CONTRACT_ENV_KEYS = ("APP_ENV", "VALORANT_PLATFORM_IMAGE", "VALORANT_DATABASE_SSL_CA_FILE",
                     "VALORANT_DATABASE_SSL_SERVER_HOSTNAME", "VALORANT_DATABASE_SSL_VERIFY")
ENV_FILE_BLOCK = re.compile(
    r"^(?P<indent> +)env_file: *\n"
    r"(?P=indent)  - path: (?P<path>\S+) *\n"
    r"(?P=indent)    required: (?P<required>\S+) *$",
    re.MULTILINE)
SERVICES_BLOCK = re.compile(r"^services:[ ]*\n(?P<body>(?:[ \t].*\n|\n)*)", re.MULTILINE)
SERVICE_NAME = re.compile(r"^  (?P<name>[A-Za-z0-9][A-Za-z0-9_.-]*):[ ]*$", re.MULTILINE)

def fail(reason):
    print("VALORANT Compose contract: " + reason, file=sys.stderr)
    raise SystemExit(1)

def declared_env_files(yaml_path):
    # Compose >= 2.40 resolves env_file into `environment` and renders env_file
    # as null even with --no-env-resolution, so the declaration is read from the
    # pinned YAML. Line endings are normalised so a CRLF copy still validates.
    with open(yaml_path, encoding="utf-8") as source:
        text = source.read().replace("\r\n", "\n")
    declarations = tuple((m.group("path"), m.group("required")) for m in ENV_FILE_BLOCK.finditer(text))
    if not declarations:
        fail("no env_file declaration was found in the pinned Compose file")
    if len(declarations) != text.count("env_file:"):
        fail("an env_file declaration is not the pinned single-entry form")
    services = SERVICES_BLOCK.search(text)
    if services is None:
        fail("the pinned Compose file declares no services")
    if len(declarations) != len(SERVICE_NAME.findall(services.group("body"))):
        fail("a service does not load the protected runtime environment")
    for path, required in declarations:
        if path != ENV_FILE_PATH or required != "true":
            fail("an env_file declaration is not the required protected runtime environment")
    # Only distinct declarations are compared across files: the source and the
    # contract may legitimately describe a different number of services, while
    # per-file completeness is enforced against that file's own service list.
    return tuple(sorted(set(declarations)))

def contract(raw, expected_image, yaml_path):
    with open(raw, encoding="utf-8") as rendered:
        doc = json.load(rendered)
    if doc.get("name") != "valorant-prod": fail("project name is not valorant-prod")
    service = doc.get("services", {}).get("valorant-platform")
    if not isinstance(service, dict) or service.get("image") != expected_image: fail("image is not the approved digest")
    environment = service.get("environment") or {}
    if environment.get("VALORANT_DATABASE_SSL_CA_FILE") != CA_TARGET: fail("TLS CA file is not the mounted private CA")
    if environment.get("VALORANT_DATABASE_SSL_SERVER_HOSTNAME") != "quest-postgres": fail("TLS server hostname is not quest-postgres")
    if environment.get("VALORANT_DATABASE_SSL_VERIFY") != "full": fail("TLS verification is not full")
    if set(service.get("networks", {})) != {"quest-shared"}: fail("service is not attached to quest-shared alone")
    network_entry = service.get("networks", {}).get("quest-shared")
    expected_aliases = ("valorant-discord-bot", "valorant-name-audit", "valorant-platform", "valorant-updater")
    if not isinstance(network_entry, dict): fail("quest-shared attachment is malformed")
    aliases = network_entry.get("aliases")
    if not isinstance(aliases, list) or tuple(sorted(aliases)) != expected_aliases: fail("quest-shared aliases are not the fixed writer set")
    network = doc.get("networks", {}).get("quest-shared", {})
    if network.get("name") != "quest-shared" or network.get("external") is not True: fail("quest-shared is not the external shared network")
    rendered_env_files = service.get("env_file")
    if rendered_env_files:
        # Compose versions that preserve the declaration are still validated here.
        if len(rendered_env_files) != 1: fail("rendered env_file is not a single entry")
        entry = rendered_env_files[0] if isinstance(rendered_env_files[0], dict) else {"path": rendered_env_files[0], "required": True}
        if entry.get("path") != ENV_FILE_PATH or entry.get("required") is not True: fail("rendered env_file is not the required protected runtime environment")
    mounts = service.get("volumes", [])
    if not any(isinstance(m, dict) and m.get("source") == CA_SOURCE and m.get("target") == CA_TARGET and m.get("read_only") is True for m in mounts): fail("the private CA is not mounted read-only")
    return (service["image"],
            tuple((key, environment.get(key)) for key in CONTRACT_ENV_KEYS),
            declared_env_files(yaml_path),
            tuple(sorted((m.get("source"), m.get("target"), m.get("read_only")) for m in mounts if isinstance(m, dict))),
            tuple(sorted(service["networks"])),
            tuple(sorted(aliases)))
if contract(sys.argv[1], sys.argv[3], sys.argv[4]) != contract(sys.argv[2], sys.argv[3], sys.argv[5]):
    fail("the source and contract renderings differ")
PY
  rm -f "$source_json_file" "$contract_json_file"
}
verify_quest_readiness_response() {
  local response="$1"
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for exact Quest readiness validation.'
  python3 - "$response" <<'PY' || die 'Quest readiness response was malformed or not the exact supported success shape.'
import json
import sys
try:
    payload = json.loads(sys.argv[1])
except (TypeError, ValueError):
    raise SystemExit(1)
if not isinstance(payload, dict) or set(payload) != {"success", "message", "timestamp", "readiness"} or payload.get("success") is not True:
    raise SystemExit(1)
if payload.get("message") != "Quest E-sports API is healthy." or not isinstance(payload.get("timestamp"), str):
    raise SystemExit(1)
readiness = payload.get("readiness")
if not isinstance(readiness, dict) or set(readiness) not in ({"database", "storage"}, {"database", "storage", "realtime"}) or readiness.get("database") != "ready" or readiness.get("storage") != "ready":
    raise SystemExit(1)
if "realtime" in readiness and readiness["realtime"] != "ready":
    raise SystemExit(1)
if not __import__("re").fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", payload["timestamp"]):
    raise SystemExit(1)
PY
}
verify_valorant_integration_response() {
  local response="$1"
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for exact VALORANT integration validation.'
  python3 - "$response" <<'PY' || die 'VALORANT integration readiness was not the exact supported success shape.'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except (TypeError, ValueError):
    raise SystemExit(1)
if not isinstance(payload, dict) or payload.get("status") != "ok" or payload.get("db") != "up" or payload.get("integration") != "ready":
    raise SystemExit(1)
checks = payload.get("checks")
required = {"service_token", "henrik", "discord_oauth", "oauth_redirect", "discord_workers", "tls"}
if not isinstance(checks, dict) or set(checks) != required or any(value != "ready" for value in checks.values()):
    raise SystemExit(1)
PY
}
current_link="${CURRENT_LINK:-$RELEASE_ROOT/current}"
current_target="$(realpath "$current_link" 2>/dev/null || true)"
release_dir="${1:-$current_target}"
[[ -n "$release_dir" && "$release_dir" == "$canonical_releases_root/"* && -d "$release_dir" && ! -L "$release_dir" ]] || die 'release directory is missing or unsafe.'
[[ "$(basename "$release_dir")" =~ ^[0-9a-fA-F]{40}$ ]] || die 'release directory must be named by a full release SHA.'
[[ "$(realpath "$release_dir" 2>/dev/null)" == "$release_dir" ]] || die 'release directory is not canonical.'
[[ "$current_target" == "$release_dir" ]] || die 'current pointer does not identify the verified release.'
[[ -f "$release_dir/compose.production.yml" && -f "$release_dir/.env" && -f "$release_dir/valorant.compose.yml" ]] || die 'release bundle is incomplete.'
for bundle_file in compose.production.yml valorant.compose.yml .env release-metadata.txt; do
  [[ -f "$release_dir/$bundle_file" && ! -L "$release_dir/$bundle_file" && -r "$release_dir/$bundle_file" ]] || die "release bundle has an unsafe $bundle_file."
  if [[ "$fixture_mode" != 1 ]]; then
    bundle_stat="$(stat -c '%u %a' "$release_dir/$bundle_file" 2>/dev/null)" || die "cannot inspect release bundle $bundle_file."
    [[ "$bundle_stat" == 0\ * ]] || die "release bundle $bundle_file must be root-owned."
    bundle_mode="${bundle_stat##* }"
    [[ "$bundle_mode" == 600 || "$bundle_mode" == 640 ]] || die "release bundle $bundle_file has an unsafe mode."
  fi
done
validate_rendered_valorant_compose

validate_metadata() {
  local metadata_file="$1" release_name="$2" metadata_line metadata_key
  declare -A metadata=()
  while IFS= read -r metadata_line || [[ -n "$metadata_line" ]]; do
    [[ "$metadata_line" =~ ^[a-z][a-z0-9_]*=[^[:space:]]+$ ]] || die 'release metadata contains an ambiguous entry.'
    metadata_key="${metadata_line%%=*}"
    case "$metadata_key" in
      commit_sha|commit_point_utc|writer_admitted|current_pointer_updated|previous_release|quest_project|valorant_project|shared_network|database_schemas|writer_groups|owner_approval_sha|cutover_type) ;;
      *) die "release metadata contains an unknown entry: $metadata_key" ;;
    esac
    [[ -z "${metadata[$metadata_key]+present}" ]] || die "release metadata contains a duplicate entry: $metadata_key"
    metadata["$metadata_key"]="${metadata_line#*=}"
  done < "$metadata_file"
  for metadata_key in commit_sha commit_point_utc writer_admitted current_pointer_updated previous_release quest_project valorant_project shared_network database_schemas writer_groups cutover_type; do
    [[ -n "${metadata[$metadata_key]:-}" ]] || die "release metadata is missing $metadata_key."
  done
  [[ "${metadata[commit_sha],,}" == "${release_name,,}" && "${metadata[commit_sha]}" =~ ^[0-9a-fA-F]{40}$ ]] || die 'release metadata commit_sha is not bound to the release directory.'
  [[ "${metadata[commit_point_utc]}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die 'release metadata commit_point_utc is invalid.'
  [[ "${metadata[writer_admitted]}" == true ]] || die 'release metadata writer_admitted must be true.'
  [[ "${metadata[current_pointer_updated]}" == true ]] || die 'release metadata current_pointer_updated must be true.'
  [[ "${metadata[quest_project]}" == quest-prod && "${metadata[valorant_project]}" == valorant-prod && "${metadata[shared_network]}" == quest-shared ]] || die 'release metadata has an invalid project or network identity.'
  [[ "${metadata[database_schemas]}" == public,valorant && "${metadata[writer_groups]}" == quest,valorant ]] || die 'release metadata does not retain both schemas and writer groups.'
  if [[ "${metadata[previous_release]}" == supabase ]]; then
    [[ "${metadata[cutover_type]}" == first-supabase-cutover ]] || die 'previous_release=supabase requires a genuine first-cutover metadata discriminator.'
    [[ "${metadata[owner_approval_sha]:-}" == "$release_name" ]] || die 'first-cutover metadata lacks owner approval for this release.'
  else
    [[ "${metadata[cutover_type]}" == steady-state ]] || die 'steady-state metadata has an invalid cutover discriminator.'
    [[ "${metadata[previous_release]}" == "$canonical_releases_root/"[0-9a-fA-F][0-9a-fA-F]* ]] || die 'release metadata previous_release is outside RELEASES_ROOT.'
    [[ -d "${metadata[previous_release]}" && ! -L "${metadata[previous_release]}" && "$(realpath "${metadata[previous_release]}" 2>/dev/null)" == "${metadata[previous_release]}" ]] || die 'release metadata previous_release is not canonical.'
    [[ "$(basename "${metadata[previous_release]}")" =~ ^[0-9a-fA-F]{40}$ ]] || die 'release metadata previous_release is not a full-SHA bundle.'
    [[ "${metadata[previous_release]}" != "$release_dir" ]] || die 'steady-state metadata must name an immutable prior release.'
  fi
}

compose() { "$DOCKER_BIN" compose "$@"; }
validate_project() {
  local file="$1" project="$2" env_file="${3:-}" config
  if [[ -n "$env_file" ]]; then
    config="$(compose --env-file "$env_file" -f "$file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
  else
    config="$(compose -f "$file" --project-name "$project" config 2>/dev/null)" || die "Compose config failed for $project."
  fi
  [[ "$(printf '%s\n' "$config" | awk -v p="$project" '$0 == "name: " p { n++ } END { print n+0 }')" == 1 ]] || die "Compose project identity is not exactly $project."
}
validate_active_project() {
  # A "!" prefix marks a one-shot service, such as the weekly name audit, which
  # may legitimately be absent or exited between runs. Every other expectation
  # is a long-lived service that must be running on the approved image.
  local file="$1" project="$2" env_file="${3:-}" active record service state image record_project
  shift 3
  local expected_count=0 running_count=0
  declare -A expected_images=() one_shot_services=() seen_services=()
  for record in "$@"; do
    service="${record%%=*}"
    image="${record#*=}"
    if [[ "$service" == "!"* ]]; then
      service="${service#?}"
      one_shot_services["$service"]=1
    else
      expected_count=$((expected_count + 1))
    fi
    [[ -n "$service" && "$image" != "$record" ]] || die "active Compose topology expectation is invalid for $project."
    expected_images["$service"]="$image"
  done
  if [[ -n "$env_file" ]]; then
    active="$(compose --env-file "$env_file" -f "$file" --project-name "$project" ps --all --format '{{json .}}' 2>/dev/null)" || die "Compose inspection failed for $project."
  else
    active="$(compose -f "$file" --project-name "$project" ps --all --format '{{json .}}' 2>/dev/null)" || die "Compose inspection failed for $project."
  fi
  while IFS= read -r record; do
    [[ -n "$record" ]] || continue
    [[ "$record" == \{*\} ]] || die "active Compose topology for $project is not structured JSON."
    service="$(printf '%s\n' "$record" | sed -nE 's/.*"Service"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$service" ]] || die "active Compose topology for $project lacks Service."
    state="$(printf '%s\n' "$record" | sed -nE 's/.*"State"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$state" ]] || die "active Compose topology for $project lacks State."
    image="$(printf '%s\n' "$record" | sed -nE 's/.*"Image"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$image" ]] || die "active Compose topology for $project lacks Image."
    record_project="$(printf '%s\n' "$record" | sed -nE 's/.*"Project"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
    [[ -n "$record_project" ]] || die "active Compose topology for $project lacks Project."
    [[ "$record_project" == "$project" ]] || die 'active Compose topology contains an unexpected project.'
    [[ -n "${expected_images[$service]+present}" ]] || die "active Compose topology contains unexpected service $service."
    [[ -z "${seen_services[$service]+present}" ]] || die "active Compose topology contains duplicate service $service."
    [[ -n "${one_shot_services[$service]+present}" || "$state" == running ]] || die "active Compose service $service is not running."
    [[ "$image" == "${expected_images[$service]}" ]] || die "active Compose service $service has an unexpected image."
    seen_services["$service"]=1
    [[ -n "${one_shot_services[$service]+present}" ]] || running_count=$((running_count + 1))
  done <<< "$active"
  [[ "$running_count" -eq "$expected_count" ]] || die "active Compose topology is missing an expected service."
  for service in "${!expected_images[@]}"; do
    [[ -n "${one_shot_services[$service]+present}" || -n "${seen_services[$service]+present}" ]] || die "active Compose topology is missing service $service."
  done
}
validate_bundle_images() {
  local bundle="$1" key value
  for key in QUEST_FRONTEND_IMAGE QUEST_BACKEND_IMAGE MIGRATOR_IMAGE POSTGRES_IMAGE VALORANT_IMAGE; do
    value="$(awk -F= -v k="$key" '$1 == k { print substr($0, index($0,"=")+1); found=1 } END { if (!found) exit 1 }' "$bundle/.env")" || die "$bundle/.env is missing $key."
    case "$key" in
      POSTGRES_IMAGE) [[ "$value" == 'postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0' ]] || die "$bundle/.env has an unapproved PostgreSQL image." ;;
      *) [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || die "$bundle/.env has an unsafe $key." ;;
    esac
    case "$key" in
      QUEST_FRONTEND_IMAGE|QUEST_BACKEND_IMAGE|MIGRATOR_IMAGE|VALORANT_IMAGE)
        RELEASE_IMAGE="$value" "$COSIGN_BIN" verify \
          --certificate-identity-regexp "$QUEST_COSIGN_CERTIFICATE_IDENTITY_REGEXP" \
          --certificate-oidc-issuer "$QUEST_COSIGN_OIDC_ISSUER" "$value" >/dev/null 2>&1 \
          || die "Cosign signature verification failed for $key."
        ;;
      POSTGRES_IMAGE) : ;; # PostgreSQL uses exact digest equality above.
    esac
  done
}
bundle_image() {
  local key="$1"
  awk -F= -v k="$key" '$1 == k { print substr($0, index($0,"=")+1); exit }' "$release_dir/.env"
}
validate_aliases() {
  # Docker 29 no longer reports Aliases from `network inspect`, so they are read
  # from each attached container. Only the names used as HTTPS and database
  # endpoints are required to resolve to a single container: once the VALORANT
  # writers are admitted they also register their own service names, so
  # `valorant-updater` and `valorant-discord-bot` legitimately resolve to both
  # the platform (which declares them for its certificate SANs) and the worker.
  # Those shared names are still pinned to the VALORANT project and image, so no
  # foreign container may claim them.
  local containers container metadata project service image alias_list alias
  local quest_backend_image postgres_image valorant_image
  declare -A unique_expectation=() shared_expectation=() bound_container=() bound_metadata=()
  declare -a aliases=()
  quest_backend_image="$(bundle_image QUEST_BACKEND_IMAGE)"
  postgres_image="$(bundle_image POSTGRES_IMAGE)"
  valorant_image="$(bundle_image VALORANT_IMAGE)"
  unique_expectation[quest-backend]="quest-prod|backend|$quest_backend_image"
  unique_expectation[quest-postgres]="quest-prod|postgres|$postgres_image"
  unique_expectation[valorant-platform]="valorant-prod|valorant-platform|$valorant_image"
  for alias in valorant-updater valorant-discord-bot valorant-name-audit; do
    shared_expectation["$alias"]="valorant-prod|$valorant_image"
  done
  containers="$("$DOCKER_BIN" network inspect quest-shared --format '{{range .Containers}}{{println .Name}}{{end}}' 2>/dev/null)" || die 'shared-network inspection failed.'
  [[ -n "$containers" ]] || die 'shared-network inspection returned no containers.'
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    metadata="$("$DOCKER_BIN" inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{join (index .NetworkSettings.Networks "quest-shared").Aliases ","}}' 2>/dev/null)" || die 'shared-network container metadata inspection failed.'
    IFS='|' read -r project service image alias_list <<< "$metadata"
    [[ -n "$project" && -n "$service" && -n "$image" && -n "$alias_list" ]] || die 'shared-network alias inspection is ambiguous.'
    IFS=',' read -r -a aliases <<< "$alias_list"
    for alias in "${aliases[@]}"; do
      [[ -n "$alias" ]] || continue
      if [[ -n "${unique_expectation[$alias]+present}" ]]; then
        [[ -z "${bound_container[$alias]+present}" || "${bound_container[$alias]}" == "$container" ]] || die "shared-network alias $alias resolves to more than one container."
        bound_container["$alias"]="$container"
        bound_metadata["$alias"]="$project|$service|$image"
      elif [[ -n "${shared_expectation[$alias]+present}" ]]; then
        [[ "$project|$image" == "${shared_expectation[$alias]}" ]] || die "shared-network alias $alias is bound to an unexpected project or image."
      fi
    done
  done <<< "$containers"
  for alias in "${!unique_expectation[@]}"; do
    [[ -n "${bound_metadata[$alias]:-}" ]] || die "required shared-network alias is missing: $alias"
    [[ "${bound_metadata[$alias]}" == "${unique_expectation[$alias]}" ]] || die "shared-network alias $alias is bound to an unexpected project, service, or image."
  done
}
validate_metadata "$release_dir/release-metadata.txt" "$(basename "$release_dir")"
# Any migration status evidence associated with this verified release must use
# the exact `pending target=quest-postgres` or `none target=quest-postgres` form.
validate_bundle_images "$release_dir"
validate_project "$release_dir/compose.production.yml" quest-prod "$release_dir/.env"
validate_project "$release_dir/valorant.compose.yml" valorant-prod "$release_dir/.env"
validate_active_project "$release_dir/compose.production.yml" quest-prod "$release_dir/.env" \
  "frontend=$(bundle_image QUEST_FRONTEND_IMAGE)" "backend=$(bundle_image QUEST_BACKEND_IMAGE)" "postgres=$(bundle_image POSTGRES_IMAGE)"
validate_active_project "$release_dir/valorant.compose.yml" valorant-prod "$release_dir/.env" \
  "valorant-platform=$(bundle_image VALORANT_IMAGE)" \
  "valorant-updater=$(bundle_image VALORANT_IMAGE)" \
  "valorant-discord-bot=$(bundle_image VALORANT_IMAGE)" \
  "!valorant-name-audit=$(bundle_image VALORANT_IMAGE)"
validate_aliases
quest_health="$("$CURL_BIN" --fail --silent --show-error --max-time 10 "$QUEST_HEALTH_URL" 2>/dev/null)" || die 'Quest health failed.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|"success"[[:space:]]*:[[:space:]]*true' <<< "$quest_health" || die 'Quest health JSON was not healthy.'
quest_readiness="$($CURL_BIN --fail --silent --show-error --max-time 10 "$QUEST_READINESS_URL" 2>/dev/null)" || die 'Quest readiness failed.'
verify_quest_readiness_response "$quest_readiness"
valorant_json="$(VALORANT_HEALTH_URL="$VALORANT_HEALTH_URL" VALORANT_CA_FILE="$VALORANT_CA_FILE" "$VALORANT_CONTAINER_HEALTH_COMMAND" 2>/dev/null)" || die 'VALORANT HTTPS health failed from the Quest network boundary.'
verify_valorant_integration_response "$valorant_json"
database_readiness_output="$(TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres "$DATABASE_READINESS_COMMAND" 2>/dev/null)" || die 'database readiness failed.'
[[ "$database_readiness_output" =~ ^ready[[:space:]]+target=quest-postgres[[:space:]]+schemas=public,valorant([[:space:]]|$) ]] || die 'database readiness did not identify both target schemas.'
security_output="$(SECURITY_VERIFY_TARGET=quest-postgres TARGET_AUTHORITY=quest-postgres TARGET_DATABASE_HOST=quest-postgres TARGET_DATABASE_PORT=5432 TARGET_DATABASE_NAME=quest TARGET_POSTGRES_MAJOR=17 SECURITY_VERIFY_DATABASE_URL_FILE="$RECOVERY_ADMIN_URL_FILE" DATABASE_URL_FILE="$RECOVERY_ADMIN_URL_FILE" RELEASE_SHA="$(basename "$release_dir")" "$SECURITY_VERIFY_COMMAND" 2>/dev/null)" || die 'database security verification failed.'
[[ "$security_output" == security-verified ]] || die 'database security verifier returned an invalid acknowledgement.'
printf '%s\n' 'release verification passed: quest-prod, valorant-prod, health, readiness, HTTPS JSON health, and database readiness.'
