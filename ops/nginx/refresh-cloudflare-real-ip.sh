#!/bin/bash
# Regenerate /etc/nginx/cloudflare-real-ip.conf from Cloudflare's published
# ranges.
#
# The VALORANT vhost trusts these ranges to restore the real client address
# from CF-Connecting-IP. The list is a snapshot: when Cloudflare publishes a
# new range, requests arriving from it keep the edge address instead of the
# client's, silently and without error. This refreshes the snapshot.
#
# Fail closed. A partial fetch, an empty list, or anything that is not a CIDR
# leaves the existing file untouched, because trusting a truncated list is
# worse than trusting a stale one: a range dropped from the file stops being
# recognised as Cloudflare at all.
set -euo pipefail

TARGET=${TARGET:-/etc/nginx/cloudflare-real-ip.conf}
CURL_BIN=${CURL_BIN:-/usr/bin/curl}
NGINX_BIN=${NGINX_BIN:-/usr/sbin/nginx}

tmp=$(mktemp)
backup=""
# Must end in a success status: this is an EXIT trap, so its last command
# sets the script's exit code. A bare [[ -n "$backup" ]] test reports
# failure on every run that never took a backup -- that is, every run that
# found nothing to change.
cleanup() { rm -f "$tmp" ${backup:+"$backup"}; return 0; }
trap cleanup EXIT

v4=$("$CURL_BIN" --fail --silent --show-error --max-time 30 https://www.cloudflare.com/ips-v4)
v6=$("$CURL_BIN" --fail --silent --show-error --max-time 30 https://www.cloudflare.com/ips-v6)

ranges=$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '[^[:space:]]' | sort -u)
count=$(printf '%s\n' "$ranges" | grep -c .)

# Cloudflare has published ~22 ranges for years. A collapse to a handful means
# a truncated response, not a real change.
if (( count < 15 )); then
  echo "refusing to write: only $count ranges fetched" >&2
  exit 1
fi

while read -r r; do
  [[ "$r" =~ ^[0-9a-fA-F:.]+/[0-9]{1,3}$ ]] || { echo "refusing to write: bad range '$r'" >&2; exit 1; }
done <<< "$ranges"

{
  echo "# Generated $(date -u +%Y%m%dT%H%M%SZ) by refresh-cloudflare-real-ip.sh"
  echo "# Source: https://www.cloudflare.com/ips-v4 and /ips-v6"
  echo "# Do not edit by hand; edits are overwritten on the next refresh."
  printf '%s\n' "$ranges" | sed 's|^|set_real_ip_from |; s|$|;|'
  echo "real_ip_header CF-Connecting-IP;"
} > "$tmp"

# Ignore the generated-at line when deciding whether anything really changed,
# so an unchanged list does not reload Nginx every week.
if [[ -f "$TARGET" ]] && diff -q <(grep -v '^# Generated' "$tmp") <(grep -v '^# Generated' "$TARGET") >/dev/null; then
  echo "unchanged: $count ranges"
  exit 0
fi

backup=$(mktemp)
[[ -f "$TARGET" ]] && cp -a "$TARGET" "$backup"

install -o root -g root -m 0644 "$tmp" "$TARGET"

# `nginx -t` validates the live configuration, so it only means something when
# the file just written is the one Nginx includes. Writing elsewhere (tests)
# must not validate or reload the running server.
if [[ "$TARGET" != /etc/nginx/* ]]; then
  echo "wrote $count ranges to $TARGET (not an Nginx path; skipping validate and reload)"
  exit 0
fi

if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
  echo "nginx rejected the refreshed ranges; restoring previous file" >&2
  [[ -s "$backup" ]] && install -o root -g root -m 0644 "$backup" "$TARGET"
  "$NGINX_BIN" -t >/dev/null 2>&1 || echo "WARNING: nginx config invalid after restore" >&2
  exit 1
fi

systemctl reload nginx
echo "updated: $count ranges, nginx reloaded"
