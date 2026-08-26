#!/usr/bin/env bash
set -euo pipefail

# Two-service VALORANT local smoke (deployment plan Task 10). Assumes both
# services are already running (see docs/setup-and-deployment.md) against the
# same dedicated Supabase test project. Exits non-zero with a diagnostic on the
# first failed check.

FASTAPI_BASE="${FASTAPI_BASE:-http://127.0.0.1:8000}"
QUEST_BASE="${QUEST_BASE:-http://127.0.0.1:5001}"

echo "1) FastAPI health (must be 200, unauthenticated):"
curl --fail --silent "$FASTAPI_BASE/api/v1/health"
echo

echo "2) FastAPI domain route auth gate:"
# The upstream deliberately bypasses `require_service_token` when APP_ENV is
# `local` or `test` (a documented seam so audit persistence is exercisable
# without HMAC), and docker-compose.local.yml sets APP_ENV=local. This script
# was written for a shared test project where APP_ENV is NOT local, so a bare
# `expect 401` fails against the very stack it is meant to smoke. Read the
# environment from the health route and assert what that environment promises.
APP_ENV="$(curl --silent "$FASTAPI_BASE/api/v1/health" | sed -n 's/.*"env":"\([^"]*\)".*/\1/p')"
STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "$FASTAPI_BASE/api/v1/teams")"
case "$APP_ENV" in
  local|test)
    if [[ "$STATUS" != "200" ]]; then
      echo "Unexpected status for domain route in APP_ENV=$APP_ENV: $STATUS (expected 200; the token gate is bypassed here)" >&2
      exit 1
    fi
    echo "  ok ($STATUS; token gate intentionally bypassed in APP_ENV=$APP_ENV)"
    ;;
  *)
    if [[ "$STATUS" != "401" ]]; then
      echo "Unexpected status for unauthenticated domain route in APP_ENV=${APP_ENV:-unknown}: $STATUS (expected 401)" >&2
      exit 1
    fi
    echo "  ok ($STATUS)"
    ;;
esac

echo "3) Quest liveness (expect 200):"
curl --fail --silent "$QUEST_BASE/api/health/live" > /dev/null
echo "  ok"

echo "4) Quest readiness (2xx pass; 503 = reachable but maintenance/degraded WARN; other = fail):"
STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "$QUEST_BASE/api/health/ready")"
if [[ "$STATUS" =~ ^2[0-9][0-9]$ ]]; then
  echo "  ok ($STATUS)"
elif [[ "$STATUS" == "503" ]]; then
  echo "  WARN ($STATUS): service reachable but in maintenance/degraded mode" >&2
else
  echo "Unexpected status for Quest readiness: $STATUS (expected 2xx, or 503 for maintenance)" >&2
  exit 1
fi

echo "VALORANT local smoke: PASS"
