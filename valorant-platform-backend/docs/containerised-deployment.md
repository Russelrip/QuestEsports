# Containerised production deployment

The VALORANT services run as four services in the fixed Compose project
`valorant-prod`: `valorant-platform`, `valorant-updater`,
`valorant-discord-bot`, and the one-shot `valorant-name-audit`.  All four join
the pre-existing external Docker network `quest-shared`; the database host in
`VALORANT_DATABASE_URL` must be `quest-postgres`.  The Compose file publishes
no host ports.  Quest reaches the API over that shared network.

Normal CD starts only the three long-running services with an explicit service
selection. It never starts `valorant-name-audit`; that service is started only
by the systemd timer below.

## Release image and runtime mounts

CI builds `Dockerfile` and deploys the immutable registry digest.  Set
`VALORANT_PLATFORM_IMAGE` to the resulting `registry/image@sha256:...` before
`docker compose ... config`/`up`; Compose rejects an unset image rather than
falling back to a mutable tag or zero digest.  The image contains no source
bind mount, certificate, private key, database credential, or API token.
Each Compose service also runs `scripts.validate_release_image` as its
entrypoint before handing off to uvicorn or a worker, so a mutable value cannot
reach application startup even if a caller bypasses the CD workflow.

At runtime provide these host values (normally in the deployment environment):

```text
VALORANT_PLATFORM_IMAGE=ghcr.io/OWNER/valorant-platform-backend@sha256:<release-digest>
VALORANT_DATABASE_URL=postgresql+asyncpg://valorant_runtime:<secret>@quest-postgres:5432/valorant_platform
VALORANT_TLS_CERT_FILE=/etc/quest-esports/tls/valorant-platform.crt
VALORANT_TLS_KEY_FILE=/etc/quest-esports/tls/valorant-platform.key
QUEST_PRIVATE_CA_FILE=/etc/quest-esports/tls/quest-private-ca.crt
QUEST_RELEASE_LOCK_FILE=/var/lock/quest-esports-release.lock
VALORANT_CHECKOUT_PATH=/opt/quest-esports/valorant-platform-backend
```

Only the one-shot name-audit container receives the lock file; the API and
updater receive no `/var/lock` mount.  The host operator must create the shared
lock file before starting services and grant the audit container's numeric
group (10001) permission to open it, for example:

```bash
sudo install -o root -g 10001 -m 0660 /dev/null /var/lock/quest-esports-release.lock
```

The private-CA-issued certificate must have `DNS:valorant-platform` in its
SAN.  The API command binds uvicorn to `0.0.0.0:8000` and enables TLS from the
three read-only runtime mounts.  The image runs as non-root UID 10001 and
includes that UID in TLS group 10002; the host must keep the private key
non-world-readable while granting that group read access:

```bash
sudo chgrp 10002 /etc/quest-esports/tls/valorant-platform.key
sudo chmod 0640 /etc/quest-esports/tls/valorant-platform.key
```

The certificate may be `0644`, but the private key must not be world-readable.
The certificate and key are never copied into the image.

## Freeze and writer admission

`WRITE_FREEZE_MODE` accepts only `off` (the default) and `validation`; an
invalid value fails settings construction.  In validation mode mutating API
methods and the Discord OAuth callback return HTTP 503 with
`WRITE_FREEZE_ACTIVE`, `retryable: true`, `Retry-After`, and an
`X-Write-Freeze` header.  `GET /api/v1/freeze` exposes the current mode and
active state.  Health remains read-only and is not frozen.

The updater, Discord bot, and name-audit processes check the same setting
before constructing a database session or beginning writes.  They log a
visible admission denial and exit without writing.  The VAL runtime database
role remains DML-capable; validation is an admission control, not a privilege
change.  Migration commands use the separate migrator role and are not run by
the application image.

## HTTPS smoke assertion

From the Quest backend container (which must have the private CA installed at
the path below), run this read-only assertion.  It deliberately does **not**
run `scripts/verify_runtime_access.py`, because that script performs
INSERT/DELETE probes and is not production validation.

```bash
curl --fail --silent --show-error --cacert /run/quest-tls/quest-private-ca.crt \
  https://valorant-platform:8000/api/v1/health \
  | jq -e '(.status == "ok") and (.db == "up")'
```

The same assertion is the container health contract.  A failed `SELECT 1`
returns a non-200 response and can never be reported as the healthy
`{"status":"ok","db":"up"}` shape.

## Weekly name-audit boundary

The only supported weekly boundary is the sibling-owned Compose one-shot,
invoked by `ops/systemd/valorant-name-audit.timer` at Sunday 02:00 Asia/Colombo.
The timer service loads `/etc/quest-esports/valorant-platform.env`, a
root-owned EnvironmentFile containing the last successful immutable
`VALORANT_PLATFORM_IMAGE` digest. It never depends on a transient CD shell or a
placeholder image.
`workers/name_audit.py` acquires `/var/lock/quest-esports-release.lock` without
requiring a global freeze or archive.  A deployment/cutover holding the lock
causes visible bounded retries; if it remains held, the run visibly skips and
exits successfully for the next timer invocation.
The CD workflow and timer both use `/opt/quest-esports/valorant-platform-backend`
as the canonical checkout. CD rejects a different `PLATFORM_APP_DIR`, while
the timer rejects a different `VALORANT_CHECKOUT_PATH` from its safe default.

Before enabling the timer on a host, inventory and disable every legacy
name-audit cron/timer.  This sibling worktree has not accessed the production
VPS, so no production inventory or disable action is claimed here.  The host
operator must record the result of commands such as:

```bash
systemctl list-timers --all | grep -i name-audit || true
systemctl list-unit-files | grep -Ei 'name.?audit|valorant.*audit' || true
crontab -l 2>/dev/null | grep -i name-audit || true
sudo grep -Rni name-audit /etc/cron* /var/spool/cron 2>/dev/null || true
```

The same cutover inventory is mandatory for the old long-running VALORANT
writers. They must be stopped, disabled, and masked before Compose writers are
started, so they cannot bypass the freeze or duplicate a Compose process:

```bash
set -euo pipefail
legacy_units=(valorant-platform.service valorant-updater.service valorant-discord-bot.service)
for unit in "${legacy_units[@]}"; do
  echo "legacy unit inventory: $unit"
  load_state="$(sudo systemctl show "$unit" --property=LoadState --value)"
  echo "  load-state=$load_state"
  if [[ "$load_state" == not-found ]]; then
    continue
  fi
  [[ "$load_state" == loaded || "$load_state" == masked ]] || {
    echo "cannot safely inspect legacy unit $unit" >&2
    exit 1
  }
  active_state="$(sudo systemctl show "$unit" --property=ActiveState --value)"
  unit_file_state="$(sudo systemctl show "$unit" --property=UnitFileState --value)"
  echo "  active-state=$active_state unit-file-state=$unit_file_state"
  if [[ "$active_state" != inactive ]]; then
    sudo systemctl stop "$unit"
  fi
  if [[ "$load_state" != masked ]]; then
    sudo systemctl disable "$unit"
    sudo systemctl mask "$unit"
  fi
  active_state="$(sudo systemctl show "$unit" --property=ActiveState --value)"
  [[ "$active_state" == inactive ]] || {
    echo "legacy unit remains active: $unit ($active_state)" >&2
    exit 1
  }
done
```

The CD cutover runs the same stop/disable/mask sequence while holding the
release lock. A failed deployment rolls back to the previous Compose digest
only; it does not restart masked systemd writers. If there is no previous
EnvironmentFile (first deployment), rollback safely stops the partial Compose
project and leaves the legacy units masked. To deliberately roll back to a
legacy unit, first stop Compose, verify the unit and its freeze posture, then
unmask/enable exactly one reviewed unit:

```bash
set -euo pipefail
docker compose -f docker-compose.production.yml --project-name valorant-prod down
LEGACY_UNIT=<one-reviewed-legacy-unit>
sudo systemctl unmask "$LEGACY_UNIT"
sudo systemctl enable --now "$LEGACY_UNIT"
```

Disable/remove any legacy entry, record its unit or crontab line in the change
ticket, then install and enable only the sibling timer:

```bash
sudo systemctl disable --now <legacy-name-audit-unit>
sudo install -m 0644 ops/systemd/valorant-name-audit.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now valorant-name-audit.timer
```

## Validation commands

Use disposable/local infrastructure only.  Create the shared network if it is
not already present, then validate the exact project and aliases:

```bash
docker network create quest-shared 2>/dev/null || true
export VALORANT_PLATFORM_IMAGE=example.invalid/valorant-platform@sha256:1111111111111111111111111111111111111111111111111111111111111111
docker compose -f docker-compose.production.yml --project-name valorant-prod config
docker compose -f docker-compose.production.yml --project-name valorant-prod ps
```

There must be one `valorant-prod` Compose project, exactly the four service
names above, no published host ports, and unique service aliases on
`quest-shared`.  Do not point these commands at a hosted database during
validation.
