#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
bootstrap_sql="$repository_root/ops/docker/init-local-db.sql"

[[ -f "$bootstrap_sql" ]] || {
  printf 'missing local database bootstrap: %s\n' "$bootstrap_sql" >&2
  exit 1
}

for role in quest_runtime val_runtime; do
  grep -Eq "^[[:space:]]*CREATE ROLE ${role}[[:space:]]+LOGIN" "$bootstrap_sql" || {
    printf 'local database bootstrap does not create required role: %s\n' "$role" >&2
    exit 1
  }
done

printf 'ok: local database bootstrap creates Quest and VALORANT runtime roles\n'
