#!/usr/bin/env bash
# Contract coverage for the rendered VALORANT Compose check shared by
# ops/deploy/validate-host.sh and ops/deploy/verify-release.sh.
#
# Docker Compose >= 2.40 resolves `env_file` into `environment` and renders
# `env_file: null` even under --no-env-resolution. The check must therefore read
# the declaration from the pinned YAML, and must never compare the resolved
# environment, because it now carries the protected runtime secrets.
set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
work_directory="$(mktemp -d)"
trap 'rm -rf -- "$work_directory"' EXIT

command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'python3 is required.' >&2; exit 1; }

python3 - "$repository_root" "$work_directory" <<'PY'
import json, pathlib, re, subprocess, sys, tempfile

repository_root, work_directory = (pathlib.Path(argument) for argument in sys.argv[1:3])
IMAGE = "ghcr.io/russelrip/quest-valorant-backend@sha256:" + "8" * 64
HEREDOC = re.compile(r'python3 - "\$source_json_file"[^\n]*<<\'PY\'[^\n]*\n(?P<body>.*?)\nPY\n', re.DOTALL)


def extract(relative_path):
    text = (repository_root / relative_path).read_text(encoding="utf-8")
    match = HEREDOC.search(text)
    if match is None:
        raise SystemExit(f"{relative_path}: the rendered VALORANT Compose check was not found")
    return match.group("body")


validate_host = extract("ops/deploy/validate-host.sh")
if validate_host != extract("ops/deploy/verify-release.sh"):
    raise SystemExit("validate-host.sh and verify-release.sh carry different VALORANT Compose contracts")
checker = work_directory / "contract.py"
checker.write_text(validate_host, encoding="utf-8")

pinned_yaml = (repository_root / "ops/docker/valorant.production.compose.yml").read_text(encoding="utf-8")


def rendered(*, env_file_null=True, extra_env=None, aliases=None, ca_mount=True, image=IMAGE):
    environment = {
        "APP_ENV": "production",
        "VALORANT_PLATFORM_IMAGE": image,
        "VALORANT_DATABASE_SSL_VERIFY": "full",
        "VALORANT_DATABASE_SSL_CA_FILE": "/run/secrets/quest-private-ca.crt",
        "VALORANT_DATABASE_SSL_SERVER_HOSTNAME": "quest-postgres",
    }
    environment.update(extra_env or {})
    volumes = [{"type": "bind", "source": "/etc/quest-esports/tls/valorant-platform.crt",
                "target": "/run/valorant-tls/valorant-platform.crt", "read_only": True}]
    if ca_mount:
        volumes.append({"type": "bind", "source": "/etc/quest-esports/tls/quest-private-ca.crt",
                        "target": "/run/secrets/quest-private-ca.crt", "read_only": True})
    default_aliases = ["valorant-platform", "valorant-updater", "valorant-discord-bot", "valorant-name-audit"]
    service = {
        "image": image,
        "environment": environment,
        "volumes": volumes,
        "networks": {"quest-shared": {"aliases": default_aliases if aliases is None else aliases}},
        "env_file": None if env_file_null else [{"path": "/etc/quest-esports/valorant.production.env",
                                                 "required": True}],
    }
    return {"name": "valorant-prod", "services": {"valorant-platform": service},
            "networks": {"quest-shared": {"name": "quest-shared", "external": True}}}


def run(source_document, contract_document, source_yaml, contract_yaml):
    with tempfile.TemporaryDirectory(dir=work_directory) as directory:
        base = pathlib.Path(directory)
        arguments = []
        for name, payload in (("source.json", source_document), ("contract.json", contract_document)):
            (base / name).write_text(json.dumps(payload), encoding="utf-8")
            arguments.append(str(base / name))
        arguments.append(IMAGE)
        for name, payload in (("source.yml", source_yaml), ("contract.yml", contract_yaml)):
            (base / name).write_text(payload, encoding="utf-8", newline="")
            arguments.append(str(base / name))
        completed = subprocess.run([sys.executable, str(checker), *arguments],
                                   capture_output=True, text=True)
        return completed.returncode, (completed.stderr or "").strip()


without_env_file = pinned_yaml.replace(
    "    env_file:\n      - path: /etc/quest-esports/valorant.production.env\n        required: true\n", "", 1)
cases = [
    # Compose >= 2.40 inlines env_file; this is the production failure being fixed.
    ("inlined env_file still satisfies the contract", True,
     rendered(), rendered(), pinned_yaml, pinned_yaml),
    ("a preserved env_file rendering still satisfies the contract", True,
     rendered(env_file_null=False), rendered(env_file_null=False), pinned_yaml, pinned_yaml),
    ("a CRLF copy of the pinned Compose file is accepted", True,
     rendered(), rendered(), pinned_yaml.replace("\n", "\r\n"), pinned_yaml),
    ("resolved runtime secrets are excluded from the comparison", True,
     rendered(extra_env={"DISCORD_TOKEN_1": "first", "ADMIN_API_KEY": "first"}),
     rendered(extra_env={"DISCORD_TOKEN_1": "second", "ADMIN_API_KEY": "second"}), pinned_yaml, pinned_yaml),
    ("a removed env_file declaration is rejected", False,
     rendered(), rendered(), without_env_file, pinned_yaml),
    ("an env_file pointing outside the protected path is rejected", False,
     rendered(), rendered(),
     pinned_yaml.replace("/etc/quest-esports/valorant.production.env", "/tmp/attacker.env", 1), pinned_yaml),
    ("an optional env_file declaration is rejected", False,
     rendered(), rendered(), pinned_yaml.replace("        required: true", "        required: false", 1), pinned_yaml),
    ("downgraded TLS verification is rejected", False,
     rendered(extra_env={"VALORANT_DATABASE_SSL_VERIFY": "off"}), rendered(), pinned_yaml, pinned_yaml),
    ("a dropped private CA mount is rejected", False,
     rendered(ca_mount=False), rendered(), pinned_yaml, pinned_yaml),
    ("a removed network alias is rejected", False,
     rendered(aliases=["valorant-platform"]), rendered(), pinned_yaml, pinned_yaml),
    ("an unapproved image digest is rejected", False,
     rendered(image="ghcr.io/example/other@sha256:" + "1" * 64), rendered(), pinned_yaml, pinned_yaml),
    ("a source and contract Compose disagreement is rejected", False,
     rendered(), rendered(), pinned_yaml,
     pinned_yaml.replace("/etc/quest-esports/valorant.production.env", "/etc/quest-esports/other.env")),
]

failures = 0
for name, expect_pass, *arguments in cases:
    code, stderr = run(*arguments)
    passed = (code == 0) if expect_pass else (code != 0)
    print(("ok   " if passed else "FAIL ") + name + ("" if passed else f"  [exit {code}] {stderr}"))
    failures += 0 if passed else 1

if failures:
    raise SystemExit(f"{failures} VALORANT Compose contract case(s) failed")
print(f"VALORANT Compose contract: {len(cases)}/{len(cases)} cases passed")
PY
