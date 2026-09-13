#!/usr/bin/env bash
# Contract coverage for ops/docker/portainer/compose.yaml.
#
# Portainer mounts the Docker socket, so anyone who reaches it is root on the
# production host. It is meant to be reachable only over Tailscale, through
# `tailscale serve` to host loopback. These checks fail if the file or the
# public Nginx ingress drifts toward exposing it.
set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repository_root/ops/docker/portainer/compose.yaml"
nginx_config="$repository_root/ops/docker/nginx/quest.conf"

command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'python3 is required.' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'docker (with the compose plugin) is required.' >&2; exit 1; }

# Render with Compose itself so short and long port syntax are judged the same.
rendered="$(docker compose -f "$compose_file" config --format json)"

python3 - "$rendered" <<'PY'
import json, re, sys

config = json.loads(sys.argv[1])
failures = []

services = config.get("services", {})
if set(services) != {"portainer"}:
    failures.append(f"expected exactly one service named portainer, found {sorted(services)}")
portainer = services.get("portainer", {})

ports = portainer.get("ports") or []
published = [(p.get("host_ip"), str(p.get("published")), p.get("target")) for p in ports]
if published != [("127.0.0.1", "9443", 9443)]:
    failures.append(f"the only publication must be 127.0.0.1:9443->9443, found {published}")

if portainer.get("network_mode") == "host":
    failures.append("network_mode: host would expose every Portainer port on the public interface")

if "--http-disabled" not in (portainer.get("command") or []):
    failures.append("--http-disabled must stay set so the plain-HTTP port 9000 is off")

image = portainer.get("image", "")
if not re.fullmatch(r"portainer/portainer-ce:\d+\.\d+\.\d+", image):
    failures.append(f"image must be pinned to an exact portainer-ce version, found {image!r}")

if "no-new-privileges:true" not in (portainer.get("security_opt") or []):
    failures.append("security_opt must keep no-new-privileges:true")

for failure in failures:
    print(f"FAIL: {failure}", file=sys.stderr)
sys.exit(1 if failures else 0)
PY

if grep -nE '9443|portainer' "$nginx_config" >&2; then
  printf 'FAIL: %s must never proxy Portainer; it is tailnet-only.\n' "$nginx_config" >&2
  exit 1
fi

printf '%s\n' 'Portainer tailnet-only contract passed'
