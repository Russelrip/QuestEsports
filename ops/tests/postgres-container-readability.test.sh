#!/usr/bin/env bash
set -euo pipefail

# Disposable, secret-free proof that the pinned server process can read every
# file that Compose mounts while running as UID/GID 999. This never starts a
# database and never contacts a production target.
image='postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'SKIP: Docker daemon unavailable; server-file readability fixture not run.'
  exit 0
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf '%s\n' 'SKIP: pinned PostgreSQL 17 image is not available locally; readability fixture not run.'
  exit 0
fi

root="$(mktemp -d "${TMPDIR:-/tmp}/quest-postgres-files.XXXXXXXX")"
trap 'rm -rf -- "$root"' EXIT
printf '%s\n' 'disposable-password' > "$root/password"
printf '%s\n' 'disposable-certificate' > "$root/server.crt"
printf '%s\n' 'disposable-key' > "$root/server.key"
printf '%s\n' 'disposable-ca' > "$root/ca.crt"
mkdir "$root/backup-client"
printf '%s\n' 'disposable-backup-ca' > "$root/backup-client/backup-client-ca.crt"
printf '%s\n' 'disposable-backup-certificate' > "$root/backup-client/backup-client.crt"
printf '%s\n' 'disposable-backup-key' > "$root/backup-client/backup-client.key"
chmod 640 "$root/password" "$root/server.key"
chmod 640 "$root/server.crt"
chmod 644 "$root/ca.crt"

# Docker root establishes the same ownership contract as host bootstrap. The
# test process below is not privileged and must read the files as 999:999.
docker run --rm --user 0:0 --entrypoint sh \
  --mount "type=bind,source=$root,target=/fixture" \
  "$image" -ec 'chown 0:999 /fixture/password /fixture/server.crt /fixture/server.key; chmod 0640 /fixture/password /fixture/server.crt /fixture/server.key; chown 0:0 /fixture/ca.crt; chmod 0644 /fixture/ca.crt'

# The backup client uses the scheduled service UID with the deploy group, while
# the mounted TLS directory and files retain their root:deploy 0750/0640 shape.
docker run --rm --user 0:0 --entrypoint sh \
  --mount "type=bind,source=$root/backup-client,target=/fixture" \
  "$image" -ec 'chown 0:1001 /fixture /fixture/*; chmod 0750 /fixture; chmod 0640 /fixture/*'

docker run --rm --network none --user 1002:1001 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --entrypoint bash \
  --mount "type=bind,source=$root/backup-client,target=/run/quest-backup-tls,readonly" \
  "$image" -ceu '
    test -r /run/quest-backup-tls/backup-client-ca.crt
    test -r /run/quest-backup-tls/backup-client.crt
    test -r /run/quest-backup-tls/backup-client.key
    test "$(stat -c %a /run/quest-backup-tls)" = 750
    test "$(stat -c %a /run/quest-backup-tls/backup-client.key)" = 640
    case "$(/usr/bin/psql --version)" in *"PostgreSQL) 17."*) ;; *) exit 1 ;; esac
    case "$(/usr/bin/pg_dump --version)" in *"PostgreSQL) 17."*) ;; *) exit 1 ;; esac
  '

docker run --rm --user 999:999 --entrypoint sh \
  --mount "type=bind,source=$root/password,target=/run/secrets/postgres-admin-password,readonly" \
  --mount "type=bind,source=$root/server.crt,target=/run/postgresql/tls/server.crt,readonly" \
  --mount "type=bind,source=$root/ca.crt,target=/run/postgresql/tls/ca.crt,readonly" \
  --mount "type=bind,source=$root/server.key,target=/run/postgresql/tls/server.key,readonly" \
  "$image" -ec '
    test "$(id -u):$(id -g)" = 999:999
    test -r /run/secrets/postgres-admin-password
    test -r /run/postgresql/tls/server.crt
    test -r /run/postgresql/tls/ca.crt
    test -r /run/postgresql/tls/server.key
    test "$(stat -c %a /run/secrets/postgres-admin-password)" = 640
    test "$(stat -c %a /run/postgresql/tls/server.crt)" = 640
    test "$(stat -c %a /run/postgresql/tls/ca.crt)" = 644
    test "$(stat -c %a /run/postgresql/tls/server.key)" = 640
  '

printf '%s\n' 'PostgreSQL server and backup-client file readability fixtures passed'
