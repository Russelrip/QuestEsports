# Production Operations Runbook

This is the operational source of truth for the Quest PostgreSQL 17 VPS runtime,
immutable Compose deployment, and recovery. The database cutover occurred on
2026-08-31 and Compose adoption is complete. This document records repository contracts and operator
status; it does not replace live verification. Use [Backup and Disaster
Recovery](./backup-and-disaster-recovery.md) for the authoritative backup,
restore, key-custody, and disaster procedure. For contributor setup and
variables, use the [Developer Guide](developer-guide.md) and [Environment
Reference](environment-reference.md).

Historical note: before cutover, Supabase was the temporary Supabase rollback material. It is now intact but stale recovery material and is not a rollback target.

## Current production status

The database cutover completed on **2026-08-31**. Quest and VALORANT use
PostgreSQL **17.11** in VPS container `quest-postgres`. The frontend, Quest API,
VALORANT API, updater, and bot run in the production Compose topology. Runtime
database URLs use their intended schemas and verify-full private-CA TLS;
VALORANT also has its dedicated TLS settings and admin API key. Supabase remains
stale recovery material and is not a rollback target.

Production environment files are root-controlled outside Git. Access-restricted
local and VPS backups were refreshed on **2026-09-04**. Revalidate backup timer
health and off-site evidence independently before a migration.

## Current Topology

The values below are the repository-recorded production target/current-state
claims, not live monitoring evidence. The owner must verify the production
host, deployment region, database region, storage paths, backup destination,
and service state before each operational change; checked-in files alone cannot
prove those facts.

- Frontend: production Compose service at `https://questesports.lk`
- Backend: production Compose service on the VPS at `https://api.questesports.lk`
- Release controller: root-owned scripts under `/usr/local/sbin`, invoked by a restricted deployment account and narrow sudo rule
- Application images: Quest frontend/backend/migrator and VALORANT backend, signed and digest-pinned from GHCR
- Database: PostgreSQL 17.11 in Compose container `quest-postgres`
- Supabase: intact but stale; it is not a rollback target
- Durable database data: `/srv/quest-esports/postgres/17/data`
- Network policy: PostgreSQL is private to Compose; no public database port is allowed
- Email: Amazon SES in Tokyo (`ap-northeast-1`) when `MAIL_PROVIDER=smtp`; SMTP credentials are region-specific
- Public uploads: `/srv/quest-esports/uploads`
- Private payment evidence: `/srv/quest-esports/private`
- CI/CD: GitHub Actions; the normal flow is `main` push -> CI -> signed image build -> protected immutable Compose release

The database cutover already occurred on 2026-08-31. Supabase is intact but
stale recovery material, not a rollback target, and must not be selected by an
automatic URL toggle. No rehearsal was performed: the hard rehearsal gate was
skipped and cannot be satisfied retroactively. Deletion and credential rotation
remain separate owner decisions after a verified backup and observation record.

PostgreSQL is trusted by its exact approved upstream digest. All four
repository-built application images are verified with the Quest GitHub Actions
Cosign identity; the deploy workflow additionally verifies BuildKit provenance
and SBOM attestations.

### Production deployment authority

`deploy-compose.yml` is the only production deployment authority. It requires
`PRODUCTION_DEPLOYMENT_MODE=compose`, `COMPOSE_DEPLOY_ENABLED=true`, an exact
successful `main` CI/build lineage, the repository owner as actor, and approval
through the protected `production-compose` environment. The retired PM2 and
Vercel workflows must not be restored as parallel production triggers. The
deployment workflow uses the `production-release` concurrency group.

### Operating the Compose stack

The canonical values, read from `ops/deploy/release.sh` and
`ops/docker/compose.production.yml` rather than remembered:

| | |
| --- | --- |
| Compose project | `quest-prod` (VALORANT: `valorant-prod`) |
| Active release | `/opt/quest-esports/current` — a symlink into `releases/` |
| Compose file | `/opt/quest-esports/current/compose.production.yml` |
| Compose env | `/opt/quest-esports/current/.env` (image manifest) |
| Backend runtime env | `/etc/quest-esports/quest.production.env` |
| VALORANT runtime env | `/etc/quest-esports/valorant.production.env` |

Every read-only inspection below uses one invocation:

```bash
quest_compose() {
  docker compose     --env-file /opt/quest-esports/current/.env     -f /opt/quest-esports/current/compose.production.yml     --project-name quest-prod "$@"
}

quest_compose ps                 # what is running, and its health
quest_compose logs -f backend    # follow one service
quest_compose exec backend env   # the environment a container actually has
```

A release is immutable and root-owned: `deploy-compose.yml` stages a new
release directory and moves the symlink. Recreating a container by hand is for
a runtime-environment change that must take effect before the next release —
it does not change the release, and the next deployment replaces it either way.

## Required Ownership And Permissions

```bash
chown -R deploy:deploy /srv/quest-esports
chmod 750 /srv/quest-esports/uploads
chmod 700 /srv/quest-esports/private
chmod 600 /etc/quest-esports/quest.production.env
```

The release directories under `/opt/quest-esports` are root-owned and written
only by the deployment; `deploy` needs to read them, never to change them.
Containers run as uid `1001`, which is why the upload volumes are group-owned
rather than world-readable. The backend creates the required child
directories. Never expose `PRIVATE_UPLOAD_ROOT` through Nginx or `/api/uploads`.

## Historical pre-cutover owner gates (already passed or skipped)

This worktree records the procedure, not live host evidence. Before any root
bootstrap or migration, the owner must record the categorized Supabase egress
totals, corrected 72-hour observation, post-fix daily rate and quota, with no
unexplained category; record production no-402 log/health evidence and a 402
test performed only against a disposable mock. A rate above quota or any
unexplained egress category stops the migration.

The same pre-mutation record must name the root-capable bootstrap actor, the
exact non-root release actor and narrow sudo rule, the approved backup
destination and credential separation, and the business-approved RPO/RTO.
These values remain `PENDING_OWNER_RECORD` until an operator supplies signed
or otherwise retained evidence. They must not be inferred from this document.

The root-capable operator creates only the documented runtime paths and
identities: `/srv/quest-esports/postgres/17/data` (`postgres:postgres`, `700`),
`/srv/quest-esports/uploads` (`deploy:deploy`, `750`),
`/srv/quest-esports/private` and `/srv/quest-esports/backups`
(`deploy:deploy`, `700`), `/opt/quest-esports/releases` (`root:deploy`, `750`),
`/etc/quest-esports` (`root:root`, `750`), `/etc/quest-esports-backup`
(`root:deploy`, `750`), and the root-owned canonical
`/var/lock/quest-esports-release.lock` (`root:deploy`, `660`). The operator
installs Docker/Compose, Nginx, systemd/tmpfiles, and the narrow release sudo
rule without stopping PM2 or legacy VALORANT services. No bootstrap, service
stop, production restore, migration, or database-authority change is performed
by the repository rehearsal flow.

## Historical pre-cutover PostgreSQL 17 migration procedure

The following procedure is the live-operator handoff for Task 8. It is not a
claim that any command has been run. Record each result in a private change
record before continuing. Never put credentials, private keys, populated env
files, credential-bearing URLs, or production archive names in that record.

### Owner inputs and stop conditions

Before root bootstrap or migration, the operator supplies and retains:

| Input | Required treatment |
| --- | --- |
| Root bootstrap actor and date | Owner-supplied evidence; do not infer from file ownership in this worktree |
| Release actor and narrow sudo rule | Exact non-root actor and fixed release command |
| Maintenance window | Business-approved start/end time and freeze owner |
| RPO/RTO | Business-approved values; `PENDING_OWNER_RECORD` until recorded |
| Live host evidence | Host capacity/swap, PG16 listener, TLS/SAN, target sentinel, service ownership, and current health observations |
| Backup evidence | Final archive/checksum, both-schema scope, remote verification, and freshness |

Stop before mutation if egress has an unexplained category, the corrected rate
exceeds the applicable quota, no-402 evidence is absent, the archive pair is
not independently remote-verified, TLS or target identity is unverified, or an
RPO/RTO/approval input is blank. A successful checked-in contract test is not
live evidence.

### Non-disruptive host preparation

The root-capable operator creates and records the required ownership and modes:

```text
/srv/quest-esports/postgres/17/data       postgres:postgres 0700
/srv/quest-esports/uploads                deploy:deploy     0750
/srv/quest-esports/private                deploy:deploy     0700
/srv/quest-esports/backups                deploy:deploy     0700
/opt/quest-esports/releases               root:deploy       0750
/etc/quest-esports                        root:root         0750
/var/lock/quest-esports-release.lock      root:deploy       0660
```

Install Docker/Compose, PostgreSQL client 17, Nginx, systemd/tmpfiles, the
root-owned release wrappers, the checked-in bootstrap SQL, and the healthcheck.
Create the external `quest-shared` network. Bootstrap must not stop PM2, the
legacy VALORANT units, PostgreSQL 16, or Vercel, and must not restore data or
change database authority.

### TLS, roles, and password delivery

Provision the private CA and server certificate outside this repository. The
PostgreSQL certificate must contain both `DNS:quest-postgres` and
`IP:127.0.0.1`; a common name without both SANs is insufficient. Verify the
actual host files before startup:

```bash
openssl x509 -in /etc/quest-esports/tls/quest-postgres.crt -noout -checkhost quest-postgres
openssl x509 -in /etc/quest-esports/tls/quest-postgres.crt -noout -checkip 127.0.0.1
openssl verify -purpose sslserver \
  -CAfile /etc/quest-esports-backup/backup-client-ca.crt \
  /etc/quest-esports/tls/quest-postgres.crt
```

Use `sslmode=verify-full` with the mounted private CA. Keep the server
certificate, server key, and administrator password root-owned by group `999`
with mode `0640` so the UID/GID `999:999` PostgreSQL process can read them;
keep the server CA root-owned and non-writable by group/other. Mount all server
TLS material read-only. The scheduled backup service uses a separate
`root:deploy` `0750` directory containing `backup-client-ca.crt`,
`backup-client.crt`, and `backup-client.key`, each `root:deploy` `0640`.
`backup-client-ca.crt` is a copy/bundle containing the issuer of
`quest-postgres.crt`; it may be copied from the server CA when that CA issued
the certificate, but it is not the client certificate/key identity. If server
and client PKIs are separate, include the PostgreSQL server issuer; alternatively,
document both chains and validate them. Host validation performs that
check, and the backup connection remains `sslmode=verify-full`. The
administrator password is mounted only as
`/run/secrets/postgres-admin-password`; it is not part of the application env
file.

The bootstrap creates `quest_migrator`/`quest_runtime` for `public` and
`val_migrator`/`val_runtime` for `valorant`. Runtime roles are non-owner,
non-superuser, `NOBYPASSRLS`, schema-isolated DML roles. Set all role passwords
through the approved secret-management or interactive `psql` procedure before
writer admission. Never place a password in SQL, Compose, an image layer, an
image tag, or this repository. Inject migrator credentials only for the
one-shot migration/security commands. The separate `quest_backup` role is
dump-only and is used by routine backups; the database owner/admin is reserved
for bootstrap and recovery and never belongs in an application environment.

### Stage PostgreSQL 17 beside PostgreSQL 16

Verify the owner-supplied PG16 observation without using broad service controls:

```bash
pg_lsclusters
systemctl is-active postgresql@16-main
ss -ltn | grep -E '127\.0\.0\.1:5432([[:space:]]|$)'
```

The cluster unit name may be confirmed from `pg_lsclusters`; do not stop,
restart, disable, or mask the broad `postgresql.service` while both majors
coexist. Render and start only the PostgreSQL 17 service with the temporary
overlay:

```bash
COMPOSE_ENV=/etc/quest-esports/quest.production.env
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml config
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml up -d postgres
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml ps postgres
```

The rendered PostgreSQL image must be the owner-approved exact
`postgres:17-bookworm@sha256:<64 lowercase hex>` reference. Verify the target
sentinel, durable bind mount, healthcheck, TLS chain/SANs, and the single
loopback publication `127.0.0.1:55432:5432`. This port is host-run staging
access only; it must never bind to `0.0.0.0`, an external interface, or a
public firewall rule. Do not start application writers during this stage.

After host-run staging clients no longer need access, remove the overlay from
application, migration, and release invocations. The base file has no
PostgreSQL host publication; applications use the private `quest-postgres`
network alias. The supported host-run backup and restore path is to keep or
reapply the staging overlay while the PostgreSQL service and the host backup
tools are in use. No private-network backup utility is implemented or
supported. This keeps the checked-in backup and restore primitives connected to
exactly `127.0.0.1:55432`; the publication is loopback-only and is never a
public database port.

If host backup or restore access is intentionally suspended, stop the timers
and oneshot services before stopping PostgreSQL or changing the Compose
invocation:

```bash
sudo systemctl disable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
sudo systemctl stop quest-esports-backup.service quest-esports-backup-freshness.service
```

Before a subsequent host backup or freshness check, reapply the overlay, start
PostgreSQL, and re-enable the timers with these exact controls. These timer
controls are for backup/freshness operations only:

```bash
COMPOSE_ENV=/etc/quest-esports/quest.production.env
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml up -d postgres
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml ps postgres
sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
```

For a destructive restore, keep both timers and both oneshot services disabled
from before the restore through target/security validation and service
recovery. Do not re-enable them as part of this generic staging sequence;
re-enable them only after the dedicated restore procedure has passed validation
and recorded the selected recovery point.

Never replace this lifecycle with a Supabase URL or an unimplemented utility.

### Historical rehearsal gate (not performed)

Use a current encrypted two-schema archive and its exact `.sha256` sibling on
an isolated recovery host. Use pinned PostgreSQL 17 `psql`, `pg_restore`, and
`pg_dump`, a disposable target sentinel, private disposable upload roots, and
the signed evidence procedure in [Backup and Disaster Recovery](./backup-and-disaster-recovery.md#phase-8-rehearsal-boundary).
The rehearsal must record schema/object counts, both migration ledgers, role
and default-ACL inventories, RLS, TLS, upload checksums, health/freeze results,
failure injections, resource use, elapsed recovery time, and owner-approved
RPO/RTO. Its live gate token is
`owner_deployment_host_evidence_required`; repository fixtures cannot provide
that evidence.

### Historical final coordinated cutover order (superseded; not performed)

Run the root-owned `cutover.sh` wrapper with the full approved release SHA and
manifest. It must perform these actions in order:

1. Acquire the canonical release lock and verify the previous authority is
   Supabase, both services' source URLs, target `127.0.0.1:55432`/database
   `quest`/major `17`, image digest, TLS, and owner approval.
2. Enable and acknowledge Quest and VALORANT validation freeze, then stop the
   old VALORANT units and old Quest/PM2 process. Confirm both legacy unit sets
   are inactive and reboot-persistent. Keep them **unmasked** at this point.
3. Create the final age-encrypted archive after the freeze and verify the exact
   evidence line:
   `verified-complete release_sha=<full-sha> schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified`.
4. Restore the archive with `--no-owner --no-acl --single-transaction
   --exit-on-error`, apply canonical security verification, and run both
   migrators before candidate startup. Required acknowledgements include
   `restored`, `security-verified`, and `none target=quest-postgres
   schema=<public|valorant> repository=<quest|valorant>` after status checks.
   `--no-acl` is intentional for the production archive: the canonical
   bootstrap applies the approved role/default-privilege contract separately.
   Do not replace it with archive ACL replay without reopening the PostgreSQL
   17 TOC compatibility decision.
5. Start both candidates frozen. Each start must return
   `started-frozen-read-only group=quest|valorant`; each freeze acknowledgement
   must return `frozen-read-only`. Verify Quest liveness/readiness,
   PostgreSQL readiness `ready target=quest-postgres schemas=public,valorant`,
   and VALORANT HTTPS health with JSON `status=ok` and `db=up`.
6. Switch Quest and VALORANT database URLs independently, verify each
   effective URL reports `url-state group=<quest|valorant> host=quest-postgres
   database=quest authority=quest-postgres`, restart both services, and require
   both `ready` acknowledgements.
7. Write `writer_admission_starting=true` before either writer enable command.
   Admit Quest and then VALORANT only after both readiness gates. Each writer
   command must return `admitted`; retain `commit-point.txt` with the commit
   timestamp, both writer acknowledgements, `writer_admitted=true`,
   `previous_release=supabase`, `database_schemas=public,valorant`, and
   `cutover_type=first-supabase-cutover`.
8. Only after the commit-point record exists, invoke the old Quest and old
   VALORANT mask commands and update the current release pointer. The final
   success token is `First production cutover admitted: <full-sha>`.

Before writer admission, any failed gate preserves Supabase authority, removes
the candidate projects, restores the source URLs if switching began, and
restarts only the previously active, still-unmasked legacy writers. After
writer admission starts, use the post-first-write recovery boundary below;
never restart an old writer against the PostgreSQL 17 state.

### Exact legacy and current writer controls

These are the four legacy Quest/VALORANT stop/mask controls. The values below
are the required release-environment variables and the owner-installed wrapper
paths; do not replace them with generic service names or broad service-manager
commands:

| Control | Exact variable and wrapper | Allowed boundary |
| --- | --- | --- |
| Stop old Quest/PM2 | `OLD_QUEST_STOP_COMMAND=/usr/local/sbin/quest-release-old-quest-stop` | After both validation freezes are acknowledged and before the final archive; before either writer-admission command |
| Stop old VALORANT | `OLD_VALORANT_STOP_COMMAND=/usr/local/sbin/quest-release-old-valorant-stop` | After both validation freezes are acknowledged and before the final archive; before either writer-admission command |
| Mask old Quest/PM2 | `OLD_QUEST_MASK_COMMAND=/usr/local/sbin/quest-release-old-quest-mask` | Only after durable `commit-point.txt` exists with both writer acknowledgements; never during pre-commit rollback |
| Mask old VALORANT | `OLD_VALORANT_MASK_COMMAND=/usr/local/sbin/quest-release-old-valorant-mask` | Only after durable `commit-point.txt` exists with both writer acknowledgements; never during pre-commit rollback |

After the durable commit point, a recovery stops the new writer groups through
`QUEST_WRITER_STOP_COMMAND=/usr/local/sbin/quest-release-quest-writer-stop` and
`VALORANT_WRITER_STOP_COMMAND=/usr/local/sbin/quest-release-valorant-writer-stop`.
Those current-writer controls are not substitutes for the old stop controls,
and the old restart controls must never be used against PostgreSQL 17 state.
Before the durable commit point, only the old stop controls may run and a
failed gate may restart a previously active, still-unmasked old writer through
`OLD_QUEST_RESTART_COMMAND=/usr/local/sbin/quest-release-old-quest-restart` or
`OLD_VALORANT_RESTART_COMMAND=/usr/local/sbin/quest-release-old-valorant-restart`.

### Observation and PostgreSQL 16 retirement

The observation window and thresholds are owner inputs, not facts inferred from
this file. Monitor and retain timestamps for Quest/VALORANT readiness and error
rates, PostgreSQL connections/locks/query latency, disk and inode growth,
backup completion/checksum/remote freshness, upload visibility and private
directory permissions, absence of Supabase connections, and representative
public/auth/admin/payment paths. Repeat the health and backup checks after each
observation milestone.

Retire the native PostgreSQL 16 cluster only after the owner-approved
observation period, a final verified two-schema backup, and explicit retirement
approval. Use the exact cluster unit identified by `pg_lsclusters`; do not use
the broad `postgresql.service`, and do not delete its data directory until the
retention decision is separately recorded. Delete or rotate Supabase only after
the same approval gate confirms the rollback window has closed.

## Production Environment Invariants

Production startup intentionally fails when any of these invariants is broken:

- `AUTH_ENCRYPTION_KEY` is exactly 64 hexadecimal characters.
- `APP_URL=https://questesports.lk`.
- `API_PUBLIC_URL=https://api.questesports.lk`.
- `MOBILE_ADMIN_OAUTH_REDIRECT_URL=https://api.questesports.lk/mobile-admin-oauth` and `MOBILE_ADMIN_ANDROID_CERT_SHA256` matches the APK release certificate.
- every `CORS_ORIGIN` entry uses HTTPS.
- `TRUST_PROXY` is enabled for the Nginx hop.
- `REQUIRE_API_ORIGIN=true`.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` are configured.
- `MAIL_DELIVERY_REQUIRED=true` and the selected provider credentials plus `MAIL_FROM` are complete.
- PayHere values are either all blank or all configured; a configured notify URL must use HTTPS.
- `DATABASE_URL` and `DIRECT_URL` explicitly use an approved `sslmode` and the mobile App Link fingerprint is configured.

The PKCE migration intentionally leaves `mobile_oauth_grants.code_challenge` nullable for one release so migrations can run before the old API process is replaced. New code writes and requires the challenge and rejects any unbound grant. Enforce the database `NOT NULL` constraint only in a later release after all old API processes are retired.

Use [backend/.env.example](../backend/.env.example) for the full variable list and the [Setup and Deployment Guide](./setup-and-deployment.md) for production examples.

## Clustered Realtime Operations

For a multi-worker API, set `CACHE_DRIVER=upstash`, set
`API_PROCESS_COUNT` to the exact PM2 API worker count, and configure
`UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN` on every worker. All
workers in one environment must use the same explicit `REALTIME_CHANNEL`, and
staging and production must use different channel names when they share an
Upstash database. Startup rejects a missing channel in clustered/shared
Upstash mode; only one local memory process receives the safe
`quest-realtime-local` default. When
`REALTIME_WORKER_ID` is configured, use the same base on every worker; otherwise
config supplies a process-derived fallback. The implementation creates each
effective identity as `${REALTIME_WORKER_ID}:${process.pid}:${randomUUID()}`, so
a shared PM2 base still produces distinct runtime identities. The shared transport uses the exact
Upstash REST requests below. The publish request uses Upstash's single-command
protocol; the command array is the JSON body, not an object wrapper:

```text
POST {UPSTASH_REDIS_REST_URL}/subscribe/{channel}   # text/event-stream
POST {UPSTASH_REDIS_REST_URL}                       # application/json
Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}
["PUBLISH", "{channel}", "{serialized realtime envelope}"]
```

`REALTIME_PUBSUB_RECONNECT_BASE_MS` and
`REALTIME_PUBSUB_RECONNECT_MAX_MS` bound the subscriber's exponential
reconnect delay; they default to `250` ms and `10000` ms. Keep these values
consistent across workers when changing the deployment defaults. Readiness is
green only after the subscribe SSE stream provides the valid
`data: subscribe,{channel},{count}` acknowledgement.

### Verify worker count and transport configuration

> **Production does not currently run more than one API worker.**
> `ops/docker/backend.production.Dockerfile` ends in `CMD ["node",
> "src/server.js"]` — one process per container — and the `backend` service in
> `ops/docker/compose.production.yml` declares no `replicas`. The clustering
> this section describes was a PM2 capability that the Compose cutover did not
> carry over.
>
> The configuration contract is still enforced by `backend/src/config/env.js`,
> so setting `API_PROCESS_COUNT` above 1 today does not scale anything: it
> obliges `CACHE_DRIVER=upstash` and a shared realtime transport for workers
> that do not exist. Leave it at 1 until the Compose service actually runs
> several, at which point the checks below become live again with
> `quest_compose ps` in place of `pm2 list`.

Whenever several workers do run, their count, `API_PROCESS_COUNT`, and shared
channel must agree; never infer this from the number of healthy HTTP responses
alone. Configuration reports only the configured base ID, not the effective ID
— verify the actual effective IDs exposed by each worker's live health endpoint:

```bash
WORKER_A_HEALTH_URL=https://api-a.example.com/api/health/live
WORKER_B_HEALTH_URL=https://api-b.example.com/api/health/live
A_ID="$(curl --fail --silent --show-error "$WORKER_A_HEALTH_URL" | node -e '
  const body = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const id = body?.realtime?.workerId;
  if (typeof id !== "string" || !id) process.exit(1);
  process.stdout.write(id);
')"
B_ID="$(curl --fail --silent --show-error "$WORKER_B_HEALTH_URL" | node -e '
  const body = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const id = body?.realtime?.workerId;
  if (typeof id !== "string" || !id) process.exit(1);
  process.stdout.write(id);
')"
test "$A_ID" != "$B_ID"
printf 'worker A effective realtime.workerId=%s (prefix=%s)\n' "$A_ID" "${A_ID%:*}"
printf 'worker B effective realtime.workerId=%s (prefix=%s)\n' "$B_ID" "${B_ID%:*}"
```

The health payload is the runtime source of truth for the complete effective
`REALTIME_WORKER_ID:process.pid:randomUUID()` value.

### Verify SSE heartbeat and proxy timeouts

The API emits an SSE comment heartbeat every 25 seconds. Nginx (or the
equivalent load balancer) must disable response buffering and use read/send
timeouts longer than that heartbeat:

```nginx
proxy_buffering off;
proxy_read_timeout 60s;
proxy_send_timeout 60s;
```

Verify the effective proxy configuration and a live stream without waiting for
an application mutation:

```bash
sudo nginx -T | grep -E 'proxy_buffering|proxy_read_timeout|proxy_send_timeout'
curl --fail --silent --show-error -N --max-time 35 \
  -H 'Accept: text/event-stream' \
  -H 'Origin: https://questesports.lk' \
  'https://api.questesports.lk/api/v1/events?topics=matches'
```

The stream should return `event: ready` promptly and remain open long enough to
observe a `: heartbeat` comment. If it closes near 25 seconds, fix the proxy
before enabling more than one worker. The optional staging exercise is
`node scripts/realtime-cluster-smoke.js` from `backend/`; it requires all seven
`REALTIME_CLUSTER_*` variables documented in [backend/README.md](../backend/README.md).
The smoke requests intentionally omit synthetic `Origin` and `Referer` headers;
use an approved staging security posture or mutation endpoint that accepts the
cookie-bearing server-to-server check without browser-origin headers. It checks
both `user:__realtime_other_user__` and broad `user` denial on both workers.

### Realtime rollback

If the shared transport or proxy is unhealthy, first disable SSE and restart
the API workers. Clients receive the intentional `204` response and use their
bounded polling fallback:

```bash
sudoedit /etc/quest-esports/quest.production.env   # REALTIME_SSE_ENABLED=false
quest_compose up -d --force-recreate backend
```

If the cluster itself must be removed, scale to one worker and use the memory
cache. Set `API_PROCESS_COUNT=1`, `CACHE_DRIVER=memory`, and optionally leave
`REALTIME_SSE_ENABLED=true` for local-process SSE; then restart and verify one
online instance. Re-enable the shared transport only after the two-worker
count, Upstash routes, heartbeat, and smoke checks pass again.

### Preserving existing encrypted data when normalizing the auth key

Older deployments accepted an arbitrary `AUTH_ENCRYPTION_KEY` and derived the AES key with SHA-256. Do not replace that value with a random key if encrypted recruitment NIC or queued-token data already exists. Convert the existing value to its SHA-256 hexadecimal representation; the derived encryption bytes remain identical:

```bash
quest_compose exec backend node -e '
  const crypto = require("crypto");
  const current = process.env.AUTH_ENCRYPTION_KEY;
  if (!current) process.exit(2);
  process.stdout.write(
    /^[a-f0-9]{64}$/i.test(current)
      ? current
      : crypto.createHash("sha256").update(current).digest("hex")
  );
'
```

Store the output securely in `AUTH_ENCRYPTION_KEY`; never paste it into tickets, chat, logs, or GitHub Actions output.

## GitHub Actions Configuration

Repository variable:

```text
PRODUCTION_DEPLOYMENT_MODE=compose
COMPOSE_DEPLOY_ENABLED=true
```

Protected `production-compose` environment secrets:

```text
BACKEND_SSH_HOST=api.questesports.lk
BACKEND_SSH_PORT=22
BACKEND_SSH_USER=deploy
BACKEND_SSH_PRIVATE_KEY=<private key whose public key is authorized for deploy>
BACKEND_SSH_HOST_KEY=<pinned known_hosts line>
```

Image building uses these repository/environment variables:

```text
PRODUCTION_API_URL=https://api.questesports.lk
PRODUCTION_SITE_URL=https://questesports.lk
POSTGRES_17_BOOKWORM_DIGEST=<approved sha256 digest>
POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:<approved digest>
```

The Compose workflow promotes the exact successful upstream SHA from its
immutable manifest. The frontend is one of the images in that same release. A
failed CI, build, verification, approval, or Compose release prevents every
application component from being promoted.

Generate the pinned host line only from a trusted VPS session:

```bash
KEY="$(awk '{print $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
printf 'api.questesports.lk %s\n' "$KEY"
```

For port 22, the known-hosts name must exactly match `BACKEND_SSH_HOST` and must not include brackets or `:22`. For a nonstandard port, use `[hostname]:port`.

Only one SSH direction remains in deployment: `BACKEND_SSH_PRIVATE_KEY` connects
the GitHub Actions runner to the restricted VPS release user. The VPS does not
check out application source during a release.

## Historical retired PM2 reference

The process must belong to the `deploy` user's PM2 daemon:

```bash
sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 start src/server.js --name quest-backend --time
  pm2 save
'
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy
```

### Migrating an existing root-owned PM2 process

Confirm the `deploy` user owns the checkout/storage, can read the mode-`600` `.env`, can fetch the repository, and can run `pm2 list` before starting. Then perform a controlled handover:

```bash
rollback_to_root() {
  sudo -u deploy -H pm2 delete quest-backend >/dev/null 2>&1 || true
  pm2 restart quest-backend --update-env
  exit 1
}

pm2 stop quest-backend || exit 1

sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 start src/server.js --name quest-backend --time
  pm2 save
' || rollback_to_root

HEALTHY=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:5001/api/health/live >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 2
done

[ "$HEALTHY" = true ] || rollback_to_root

READY=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:5001/api/health/ready >/dev/null; then
    READY=true
    break
  fi
  sleep 2
done

[ "$READY" = true ] || rollback_to_root
pm2 delete quest-backend
pm2 save --force
```

Only after both liveness and a `200` readiness response (database and storage
available, plus clustered realtime when enabled) pass should the old root entry
be removed. During maintenance,
readiness intentionally returns `503`; this procedure therefore rolls back to
the root-owned process instead of claiming a safe handover. Then install the
`deploy` systemd unit, stop the manually started deploy daemon once, and let
systemd resurrect the saved list:

```bash
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy
systemctl stop pm2-deploy || true
sudo -u deploy -H pm2 kill || true
systemctl reset-failed pm2-deploy
systemctl start pm2-deploy
```

If PM2 was started manually before the systemd unit, `systemctl start pm2-deploy` can fail with `Result: protocol`. Stop the existing daemon once, then let systemd resurrect the saved list:

```bash
systemctl stop pm2-deploy || true
sudo -u deploy -H pm2 kill || true
systemctl reset-failed pm2-deploy
systemctl start pm2-deploy
```

Verify ownership and supervision:

```bash
systemctl is-enabled pm2-deploy
systemctl is-active pm2-deploy
sudo -u deploy -H pm2 list
ps -eo user,pid,args | grep '[n]ode.*server.js'
```

Expected: `enabled`, `active`, `quest-backend` online, and the Node process owned by `deploy`.

## Normal Deployment

### Immutable Compose release contract

The repository also contains a target-state release path under `ops/deploy/`.
It is a root-owned host contract and is not evidence that Docker, systemd, the
registry, the backup remotes, or the sibling VALORANT deployment is currently
installed or healthy. Host bootstrap must first create the root-owned
`/var/lock/quest-esports-release.lock`, install the protected release
environment from `ops/deploy/release.env.example`, create the pre-created
`quest-shared` network, and install the fixed root-owned command wrappers named
by that environment. The release actor must be granted only the narrow sudo
permission for the fixed release script; adding `deploy` to the Docker group
is not an implicit substitute.

The release manifest is an operator-approved, non-secret file with exactly one
`commit_sha`, `frontend_image`, `backend_image`, `migrator_image`,
`postgres_image`, and `valorant_image` entry. The commit is the full SHA and all
application images are exact `ghcr.io/...@sha256:<64 hex>` references;
PostgreSQL is the exact `postgres:17-bookworm@sha256:<64 hex>` reference. The
script rejects duplicate or unknown manifest keys, mutable tags, mismatched
SHAs, wrong project names, duplicate shared-network aliases, and more than one
active fixed-name service group. It stages at
`/opt/quest-esports/releases/<full-sha>/` and atomically replaces
`/opt/quest-esports/current` only after writer admission.

Run the release only from an approved host session, without printing the
protected environment or manifest credentials:

```bash
sudo /usr/local/sbin/quest-esports-release \
  <full-40-character-commit-sha> /secure/releases/<full-sha>.manifest
sudo /usr/local/sbin/quest-esports-verify-release   # root-owned, alongside the release controller
```

The script takes the canonical lock before disk, database, registry, backup,
Compose, migration, or health work and retains it through the pointer switch.
Backup and freshness wrappers inherit descriptor 9 through
`BACKUP_RELEASE_LOCK_PATH=/proc/self/fd/9`; they re-lock that same canonical
file before their nested lock, preserving canonical-before-nested ordering.
It performs no VPS-side build and does not stop PM2/Vercel as part of this
transition. It stages/pulls both fixed Compose projects without writers,
checks PostgreSQL and multi-remote freshness, and preserves the old VALORANT
units unmasked until the commit point. If migrations are pending, both the
relevant owner approval for the exact SHA and `BACKUP_APPROVAL=
BACKUP_QUEST_PRODUCTION` are required before the existing backup primitive is
invoked. The backup must then produce a remotely verified complete archive and
checksum pair, with release-bound machine-readable evidence containing
`schemas=verified:public,valorant`, `uploads=verified:public,private`,
`archive=verified`, `checksum=verified`, and `remote=verified`, plus the exact
requested full SHA. Migrations are one-shot operations and are never
automatically reversed. The manifest's `migrator_image` is passed as
`MIGRATOR_IMAGE` and `EXPECTED_MIGRATOR_IMAGE` to a migrator wrapper only when
that migration is invoked; the release does not invent a Compose migrator.

After the coordinated freeze is acknowledged, the release stops the old
VALORANT units and starts both candidate projects only through the configured
`CANDIDATE_FROZEN_START_COMMAND`. That wrapper must enforce the
`frozen-read-only`, `--write-freeze=validation`, and `--read-only` contract and
return `started-frozen-read-only`; it must not rely on mutable Compose defaults.
Freeze is enabled and acknowledged before either stopping old VALORANT units or
starting candidate services. Both Quest and VALORANT readiness acknowledgements
are required before writer admission.
The release then requires Quest health/readiness, PostgreSQL readiness,
unique `quest-shared` aliases, and VALORANT HTTPS health with certificate
validation plus JSON `status: "ok"` and `db: "up"`. Only after both repository
readiness acknowledgements does the configured coordinated writer-enable
operation run. The resulting commit point, SHA, projects, aliases, and pointer
state are retained in release metadata. Old VALORANT units are masked only
after that record exists.

Before writer admission, a failed gate restores the previous application
release and may restart only the previously stopped, still-unmasked old
VALORANT units without changing database authority. If the authority check
reports `supabase`, rollback restarts the legacy PM2 application and does not
start a Compose bundle; if it reports `quest-postgres`, rollback starts the
validated previous Compose bundle. This prevents a stale-Supabase split brain.
Use the explicit boundary rather than changing one database URL:

```bash
sudo env OLD_VALORANT_WAS_STOPPED=1 \
  /usr/local/sbin/quest-esports-rollback pre-commit \
  /opt/quest-esports/releases/<failed-sha>
```

After writer admission, an application rollback is not a database rollback.
Stop both writer groups, re-enable the coordinated freeze, capture and
checksum current PostgreSQL 17 and both upload roots, record expected loss/RPO,
and obtain incident-owner approval before selecting fix-forward or a controlled
restore:

```bash
sudo env EXPECTED_LOSS_RPO='<owner-approved statement>' \
  INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL \
  /usr/local/sbin/quest-esports-rollback post-commit
```

The post-commit path never restarts old writers and never redirects only one
service to stale Supabase. These scripts and their fixture test are disposable
contracts; they do not claim a live VPS, hosted database, real rclone remote,
systemd, registry, or sibling-repository verification.

1. Push to `main`.
2. CI runs backend audit, migrations against PostgreSQL 16, migration/schema verification, coverage, lint, frontend audit/lint/unit tests/build, and Playwright.
3. After CI succeeds, the image workflow publishes the immutable manifest and the Compose workflow deploys the exact approved release when `PRODUCTION_DEPLOYMENT_MODE=compose`.
4. Compose pauses for approval before its first deployment step. Open `Actions -> the Deploy immutable Compose release run -> Review deployments`, tick **production-compose**, and approve. The protected environment approval and mode gate apply to every Compose deployment.

   A Compose release with a destructive or backward-incompatible migration requires the protected owner approval and the exact release-bound migration approval contract before applying it. One click approves a deployment; dropping a column deserves a second, deliberate act that names the commit. That SHA must match the commit being deployed, so any push to `main` between setting it and deploying invalidates it.

   When migrations are pending, the release-bound Compose backup contract must succeed before applying them.
5. Compose invokes the root-owned immutable release contract, validates the exact image manifest and protected approvals, and performs the coordinated production release without source checkout, npm, or PM2 on the VPS.
6. The Compose workflow's final `release-success` job requires both the resolver and actual `deploy` job to succeed and uploads the exact `compose-release-success` proof artifact. Its stable workflow identifier is the whitespace-free `compose_workflow=Deploy_immutable_Compose_release`; a skipped/no-op Compose release cannot produce that proof or a successful workflow completion.
7. The frontend is part of the same immutable Compose release; there is no second frontend promotion workflow.

Emergency/manual redeploy: GitHub `Actions -> Deploy immutable Compose release -> Run workflow`. Dispatch from `main`; leave `rollback_sha` empty for the newest approved release or provide the full SHA of an older successful `main` image build for an intentional rollback.

The deployment refuses root SSH users, dirty tracked worktrees, insecure `.env` permissions, and unpinned SSH hosts.

## Rollback Semantics

If health validation fails, the release brings the staged project down and
starts the previous release directory again from its own recorded image
manifest — `release.sh` keeps `/opt/quest-esports/releases/` for exactly this.
There is no checkout, dependency install or Prisma regeneration on the host: a
rollback is a different set of already-built images, which is what makes it
fast and repeatable.

Database migrations are not reversed. Every production migration must therefore
remain backward-compatible with the previous application release (expand first;
contract later).

Never rely on a Free-plan Supabase dashboard backup. Confirm that the encrypted database-and-upload archive exists off-site before approving a migration. Clear `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` from the `Production` environment after the deployment; while it still equals a commit SHA, the destructive gate is disarmed for that commit. The ordinary migration approval needs no cleanup — the required reviewer applies to every run.

Confirm the backup in the deployment log before the migration applies. A successful run prints `Encrypted production backup uploaded successfully: quest-production-<timestamp>.tar.gz.enc` immediately before the first `Applying migration` line. The backup and the approval check share one condition, so a deployment with nothing pending performs neither — `No pending database migrations` means the run changed no schema, not that it backed up and found nothing to do.

## Site Maintenance Mode

Use maintenance mode when visitors should temporarily see a branded maintenance page and normal API traffic should be refused. The frontend responds with `503`, `Retry-After`, `Cache-Control: no-store`, and crawler `noindex` headers. The backend returns a structured `SITE_MAINTENANCE` `503` response. `/api/health/live` remains available, readiness returns the intentional `503`, and the exact `POST /api/payments/payhere/notify` callback remains available so a payment already started before the window can settle.

Three values control it:

```env
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
```

The message is limited to 240 characters. The retry window is an integer from 1 to 86400 seconds. Invalid values are rejected at startup instead of silently choosing an unsafe state. `COMMERCE_MAINTENANCE_ENABLED` is unrelated: it controls scheduled commerce cleanup jobs, not visitor maintenance mode.

> **The frontend half is not wired into the Compose stack.**
> `readSiteMaintenanceConfig` reads `SITE_MAINTENANCE_MODE` from `process.env`
> in `frontend/app/layout.tsx`, but the `frontend` service in
> `ops/docker/compose.production.yml` declares no such variable, so there is
> nowhere for an operator to set it. Enabling the branded page requires adding
> the three variables to that service first. Until then only the API half of
> this procedure takes effect, and the site keeps serving normally while the API
> refuses — which is a worse experience than either state on its own.
>
> This was missed because the pre-cutover procedure set the frontend values in
> Vercel, which no longer builds anything. Worth closing before the next
> maintenance window rather than during one.

### Enable maintenance safely

1. Announce the window. Confirm the latest scheduled backup succeeded; create a manual full backup first if the work can change data.
2. Set `SITE_MAINTENANCE_MODE=true` and the two companion values in the backend runtime environment, without printing it:

   ```bash
   sudoedit /etc/quest-esports/quest.production.env
   ```

3. Recreate the backend so it reads them. This does not change the release; the
   next deployment applies the same file either way:

   ```bash
   quest_compose up -d --force-recreate backend
   quest_compose ps
   ```

4. Verify the expected behavior:

   ```bash
   curl --silent --show-error --output /dev/null --write-out '%{http_code}
' https://questesports.lk/
   curl --fail --silent --show-error https://api.questesports.lk/api/health/live
   curl --silent --show-error --dump-header - https://api.questesports.lk/api/health/ready
   curl --silent --show-error --dump-header - https://api.questesports.lk/api/tournaments
   ```

   Expected: liveness `200` with `maintenance.enabled=true`; readiness and ordinary API requests `503` with `X-Maintenance-Mode: active` and `Retry-After`. The frontend still answers `200` until the gap above is closed.

CD uses liveness to confirm the container came back and recognizes the explicit maintenance header on readiness, so an intentional maintenance window does not trigger a false rollback.

### Disable maintenance safely

1. Finish and verify the backend work while the window is still in force.
2. Set `SITE_MAINTENANCE_MODE=false` in `/etc/quest-esports/quest.production.env`, recreate the backend the same way, and confirm readiness is `200`.
3. Run the normal production smoke checks and watch `quest_compose logs -f backend`.

### An immediate shutdown

For an outage that cannot wait for a configuration change, stop the service:

```bash
quest_compose stop backend
```

The API becomes unreachable rather than returning the branded maintenance
response, so prefer the configured window whenever there is a choice. Compose
records no desired state of its own — the next release starts the service again
regardless, which is a recovery path rather than something to rely on.

### Coordinated write-freeze validation mode

`SITE_MAINTENANCE_MODE` is not a database write freeze. For a migration or
other operation that requires zero application writers, set the backend
`WRITE_FREEZE_MODE=validation` and restart the API. In this mode the API still
initializes its database connection and HTTP server, but rejects all mutation
methods and inbound callbacks with `503`, `Retry-After`, and
`X-Write-Freeze: validation`. All Quest workers and schedulers are disabled.
Validation API traffic is deny-by-default: only the explicitly verified health,
status, capability, OpenAPI, and public catalog/media read probes are admitted.
Unknown API GET/HEAD requests are frozen too, including order, ticket-order,
payment, match-room, veto, and rate-limited endpoints whose handlers or
middleware can perform writes.

Verify the acknowledgement before running read-only migration validation:

```bash
curl --fail --silent --show-error https://api.questesports.lk/api/health/write-freeze
curl --silent --show-error --dump-header - \
  -X POST https://api.questesports.lk/api/v1/example-mutation
```

The status response must be exactly equivalent to
`{"mode":"validation","writersEnabled":false}` (JSON key order may vary),
and mutation attempts must return `503` with the freeze header. Keep this mode
active until validation is complete and the migration operator is ready to
resume writers. Set `WRITE_FREEZE_MODE=off`, restart the API, and verify the
status response reports `writersEnabled: true` before resuming normal traffic.

### Full stop and write-freeze warning

The coordinated validation mode blocks Quest HTTP and callback writers and
stops Quest workers, but it does not replace the full-stop procedure when the
database itself must be isolated. For a database restore, suspected
compromise, or any operation requiring the backend to be unavailable, follow
the disaster-recovery procedure and stop the backend:

```bash
quest_compose stop backend
```

The API becomes unreachable rather than returning the branded maintenance
response, so prefer a configured window whenever there is a choice. Nothing has
to be undone afterwards: Compose records no desired state of its own, and the
next release starts the service again regardless.

## Verification

Health endpoint semantics are fixed: `/api/health/live` is liveness only;
`/api/health` and `/api/health/ready` are readiness aliases that check the
database and storage, plus clustered realtime when enabled, and may return
`503` during maintenance or dependency failure. `/api/openapi.json` is the API
schema endpoint. During maintenance,
liveness remains available while both readiness aliases intentionally return
the maintenance `503`.

Run Linux commands from the VPS, not Windows PowerShell:

```bash
readlink -f /opt/quest-esports/current
quest_compose ps
curl --fail --silent --show-error http://127.0.0.1:5001/api/health/live
curl --fail --silent --show-error http://127.0.0.1:5001/api/health
curl --fail --silent --show-error https://api.questesports.lk/api/health
curl --fail --silent --show-error https://questesports.lk/sitemap.xml > /dev/null
curl --fail --silent --show-error https://questesports.lk/robots.txt
```

From Windows PowerShell, use:

```powershell
Invoke-RestMethod https://api.questesports.lk/api/health
$sitemap = Invoke-WebRequest https://questesports.lk/sitemap.xml -UseBasicParsing
[xml]$sitemap.Content | Out-Null
Invoke-WebRequest https://questesports.lk/robots.txt -UseBasicParsing
```

PowerShell aliases `curl` to `Invoke-WebRequest`, and Windows `sudo.exe` is not Linux `sudo`.

## Troubleshooting

### Configure SSH exits on `test -n`

A required Actions secret resolved to an empty value. Confirm the exact secret names in `.github/workflows/deploy-compose.yml`. Deployment SSH secrets belong in the protected `production-compose` environment.

### `No ED25519 host key is known`

`BACKEND_SSH_HOST_KEY` does not match the exact hostname/IP or port format in `BACKEND_SSH_HOST`. Regenerate the line from the trusted VPS session and update the pair together.

### Deployment refuses root

Set `BACKEND_SSH_USER=deploy`. The release directories under
`/opt/quest-esports`, the runtime environment files under
`/etc/quest-esports`, the upload volumes under `/srv/quest-esports`, and the
Docker socket must be reachable by that user.

### New code repeatedly restarts

```bash
quest_compose logs --tail 100 backend
```

Configuration validation errors appear before the server listens on port 5001,
so a container that restarts in a loop with nothing after the validation banner
is almost always a bad value rather than a bad build. Fix
`/etc/quest-esports/quest.production.env` without printing secret values and
recreate the service; do not hide the validation in code.

### `dubious ownership` from Git

Run repository commands as the owner:

```bash
sudo -u deploy -H git -C /var/www/QuestEsports status --short
```

Do not add a global safe-directory exception for root merely to bypass correct ownership.

## Updates And Reboots

Take a VPS snapshot before broad package upgrades. Apply standard upgrades during a maintenance window:

```bash
apt update
apt list --upgradable
apt upgrade
```

If `/var/run/reboot-required` exists:

```bash
quest_compose ps      # note what is running before the reboot
reboot
```

Nothing needs saving first. The Compose services carry a restart policy and come
back with the host; confirm with `quest_compose ps` afterwards rather than
assuming.

After reconnecting, repeat the verification commands. PM2/systemd should restore the backend automatically.

## Backup Set

Back up and restore these together:

- The owner-verified migration source during transition, or the PostgreSQL 17 VPS target after cutover.
- `/srv/quest-esports/uploads`.
- `/srv/quest-esports/private`.
- production `.env` through a secure secret-management process.

Do not treat admin Excel exports as backups. Payment-proof backups contain sensitive records and require restricted access, retention enforcement, and secure deletion.

### Automated encrypted off-site backups

The complete backup and recovery procedure, including restore warnings, disaster scenarios, key loss, credential recovery, retention limitations, and the drill record template, is maintained in [Backup and Disaster Recovery](./backup-and-disaster-recovery.md). This section is the production quick reference.

The repository provides:

- `ops/backup-production.sh`
- `ops/restore-production-backup.sh`
- `ops/prune-production-backups.sh`
- `ops/notify-backup-failure.sh`
- `ops/check-backup-freshness.sh`
- `ops/create-secret-recovery-package.sh`
- `ops/systemd/quest-esports-backup.service`
- `ops/systemd/quest-esports-backup.timer`
- `ops/systemd/quest-esports-backup-failure@.service`
- `ops/systemd/quest-esports-backup-freshness.service`
- `ops/systemd/quest-esports-backup-freshness.timer`

The backup includes a portable custom-format dump of the application-owned PostgreSQL `public` and `valorant` schemas, public uploads, private payment evidence, and a manifest (which records `valorant_schema_included`). Non-application schemas and extensions are intentionally excluded from the portable dump so it can be restored on ordinary PostgreSQL; this is not a dependency on Supabase. The archive is encrypted with an offline `age` recipient before upload through `rclone`. Keep the `age` private identity off the production VPS.

Install the prerequisites and configuration:

```bash
sudo apt install -y postgresql-common rclone age rsync
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-client-17
sudo install -d -o deploy -g deploy -m 700 /srv/quest-esports/backups
sudo install -d -o deploy -g deploy -m 700 /srv/quest-esports/rclone
sudo install -o root -g deploy -m 640 ops/quest-esports-backup.env.example /etc/quest-esports-backup.env
sudo install -d -o root -g deploy -m 750 /etc/quest-esports-backup
sudo install -o root -g deploy -m 640 /secure/tls/postgres-server-issuer-bundle.crt /etc/quest-esports-backup/backup-client-ca.crt
sudo install -o root -g deploy -m 640 /secure/tls/backup-client.crt /etc/quest-esports-backup/backup-client.crt
sudo install -o root -g deploy -m 640 /secure/tls/backup-client.key /etc/quest-esports-backup/backup-client.key
sudo install -o deploy -g deploy -m 600 /path/to/verified-rclone.conf /srv/quest-esports/rclone/quest-esports.conf
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.timer /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-failure@.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-freshness.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-freshness.timer /etc/systemd/system/
```

The PostgreSQL repository helper is provided by the PostgreSQL project and prompts before adding `apt.postgresql.org`. Confirm `/usr/lib/postgresql/17/bin/pg_dump --version` reports major version 17. Keep the mutable OAuth configuration under `/srv/quest-esports/rclone`: the systemd unit deliberately hides home directories and permits writes only under `/srv/quest-esports`, allowing rclone to persist token refreshes without broadening the service sandbox.

Use a dedicated Google Cloud project and OAuth desktop client for the Drive remote. Enable the Google Drive API, configure an External consent screen, add only the `drive.file` scope, create a Desktop client, and move the app to **In production** so refresh tokens do not inherit the seven-day Testing limit. Enter the client ID, client secret, and authorization token only through interactive `rclone config`; never print, commit, or copy the rclone configuration into documentation. Create and validate a second remote before changing `BACKUP_RCLONE_REMOTE`, so the existing remote remains an immediate rollback path.

Edit `/etc/quest-esports-backup.env` without printing its values. The
checked-in backup service contract is for the PostgreSQL 17 VPS target, not the
retired Supabase session pooler: set `DIRECT_URL` to the exact
`quest_backup@127.0.0.1:55432/quest` target represented by
`ops/quest-esports-backup.env.example`, plus both upload roots, the offline
`age` public recipient, `RCLONE_CONFIG=/srv/quest-esports/rclone/quest-esports.conf`,
the active off-site `rclone` remote, `BACKUP_MAX_AGE_MINUTES=2160`, approved
remote retention values, and the approved backup-failure webhook. This host
backup path is supported during staging and after authority cutover only while
the PostgreSQL service is started with the staging overlay's loopback-only
`127.0.0.1:55432:5432` publication. It must never target Supabase. No
private-network backup utility is implemented or supported. If host backup or
restore access is suspended, disable the timers and stop both oneshot services
before changing the Compose invocation. For the next host backup or freshness
check, reapply the overlay, start PostgreSQL, verify the endpoint, and enable
the timers with these exact controls:

```bash
sudo systemctl disable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
sudo systemctl stop quest-esports-backup.service quest-esports-backup-freshness.service
COMPOSE_ENV=/etc/quest-esports/quest.production.env
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml up -d postgres
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml \
  -f ops/docker/compose.postgres-staging.yml ps postgres
sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
```

For a destructive restore, use the same disable/stop controls before the
restore, but keep both timers and both oneshot services disabled through the
restore, target/security validation, and service recovery. Do not execute the
enable command above for restore preparation. The dedicated restore procedure
re-enables the timers only after successful validation and after the selected
recovery point is recorded.

Never substitute a Supabase URL. Run the manual backup from an
accessible working directory; launching `sudo -u deploy` while still in `/root`
makes GNU `find` fail when it tries to restore that inaccessible working
directory. Then verify the systemd service, test one failure notification, and
enable both timers for the backup/freshness schedule:

```bash
cd /var/www/QuestEsports
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/backup-production.sh
sudo systemctl daemon-reload
sudo systemctl start quest-esports-backup.service
systemctl show quest-esports-backup.service --property=Result,ExecMainStatus,ActiveState --no-pager
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/notify-backup-failure.sh operator-test
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/check-backup-freshness.sh
sudo systemctl start quest-esports-backup-freshness.service
sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
systemctl list-timers quest-esports-backup.timer quest-esports-backup-freshness.timer --no-pager
journalctl -u quest-esports-backup.service --since today --no-pager
```

The backup is not considered successful until rclone content verification succeeds for both the encrypted archive and checksum on the off-site remote. Review retention first in dry-run mode with `ops/prune-production-backups.sh`; actual deletion additionally requires `RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION` and refuses to cross the configured minimum recovery-point floor. Follow [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) for the separate environment/rclone/infrastructure package that the normal archive intentionally excludes.

The repository contains a historical record dated 2026-07-29 describing a
manual encrypted full backup, a restricted systemd service run, and the daily
timer as enabled. That record is not current runtime proof; the owner must
verify the archive, destination, and timer state before relying on them. The
record names `quest-production-20260729T133147Z.tar.gz.enc` on the historical
`quest-backups:quest-esports/production` destination.

The active destination was then documented as moved to the dedicated-client remote `quest-backups-custom:quest-esports-v2/production`. Manual archive `quest-production-20260729T154756Z.tar.gz.enc` and its checksum were documented as confirmed off-site, and a subsequent `quest-esports-backup.service` run was documented as returning `Result=success`, `ExecMainStatus=0`, and `ActiveState=inactive`. The daily timer was documented as enabled. These are historical records, not proof of current remote contents or timer state; the owner must verify them before relying on the destination.

## Coordinated Quest + VALORANT cutover and restore boundary

This is the approved boundary for promoting the containerised PostgreSQL 17
topology. It is a coordinated change, not two independent application
deployments:

1. Stage the approved Quest release and the separately approved sibling
   VALORANT release, with both projects in frozen read-only mode and no
   writers.
2. Enable and acknowledge the validation freeze. Stop, but do not mask, the
   old VALORANT units; keeping them unmasked preserves the pre-commit restart
   path.
3. Create the final encrypted archive containing `public` and `valorant` plus
   both upload roots. Independently verify its checksum, age decryption, exact
   manifest scope, and the isolated Phase 8 rehearsal evidence.
4. Restore into the PostgreSQL 17 target, update both services' database URLs,
   then start both candidate services still frozen. Validate Quest liveness,
   readiness, database/security state, uploads, and the VALORANT HTTPS health
   response through the approved CA (`status=ok`, `db=up`).
5. Admit Quest and VALORANT writers together only after both readiness
   acknowledgements. Record the commit point, release SHA, database authority,
   archive identity, and writer-admission result. Mask the old VALORANT units
   only after that record exists.

Before the commit point, a failed candidate gate means: keep writers disabled,
restore the previous Quest release, and restart only the previously stopped,
still-unmasked VALORANT units. Do not change database authority or restart an
old writer against a new schema. After the commit point, an application
rollback is not a database rollback: stop both writer groups, re-enable the
freeze, capture the current PostgreSQL 17 and upload state, record expected
loss/RPO, and obtain incident-owner approval for fix-forward or a controlled
restore. Never restart the old VALORANT writers or redirect only one service to
stale Supabase data after commit.

The sibling VALORANT Compose release manifest, its image digests, its live
source-major record, and its own deployment evidence remain required operator
artifacts. Quest's archive manifest and this worktree do not prove those
values. A source-major mismatch is an explicit logical-major-migration gate,
not an implicit compatibility claim. No live VPS, Supabase, rclone remote,
hosted health endpoint, or sibling repository is contacted by the fixture
rehearsal.

### Historical/local Paris database snapshot on Windows

For an immediate database-only snapshot from the secured development PC, run:

```powershell
cd D:\Work\Projects\QuestEsports
.\ops\backup-paris-database-windows.ps1
.\ops\test-paris-database-backup-windows.ps1
```

The first command reads the historical/local Paris `DIRECT_URL` without printing it, dumps only the application `public` schema, encrypts the result with the offline recovery recipient, writes a checksum, and removes plaintext staging data. The second command verifies the checksum and restores the latest archive into a disposable PostgreSQL 17 container. Files are stored under `D:\Work\QuestEsports-backups\paris-database` with restricted ACLs. This is not the live VPS backup or recovery path.

This Windows snapshot does not contain production VPS uploads and is not a substitute for the scheduled full VPS backup or its off-site copy.

### Restore drill

Download one encrypted archive and its checksum to an isolated recovery host that has the offline `age` identity. Restore into a disposable PostgreSQL instance and empty temporary upload directories first. The restore script requires the explicit `RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION` value because its database cleanup and file synchronization are destructive.

Run the restore script through Bash so it does not depend on a checkout retaining executable file modes:

```bash
RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  bash ops/restore-production-backup.sh /absolute/path/to/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

Do not point a restore drill at live VPS production. The rehearsal must use pinned
PostgreSQL 17 clients and the existing restore primitive's
`pg_restore --no-owner --no-acl --single-transaction --exit-on-error` path,
then verify the roles/default privileges/grants separately. Record the
pre-restore and post-restore Quest `public._prisma_migrations` and VALORANT
`valorant._migration_ledger` states, both schema/object counts, both upload-root
checksums, health/freeze/failure-injection results, measured resource usage,
approved RPO/RTO, and elapsed recovery time. Run a drill after setup and at
least quarterly.

The repository contains a historical record describing a full drill dated
2026-07-29 using `quest-production-20260729T133809Z.tar.gz.enc`. It records a
matching checksum, PostgreSQL 17 restoring 35 public tables and 33 completed
migration records, and SHA-256 matches for 41 public and 10 private restored
files. The record also describes a corrected `pg_restore --dbname` option.
This is not current recovery proof; the owner must verify the record and repeat
an isolated drill before treating recovery as proven.

The repository contains a historical record dated 2026-07-29 describing the
retiring shared-client risk as closed and the active remote as using the
QuestEsports-owned Google OAuth desktop client, `drive.file`, and an app
publishing status of **In production**. It also records a manual
archive/checksum upload and restricted systemd service run after the switch.
These records are not current proof of remote, token, or service state; the
owner must verify them before relying on the destination.

### Historical/test Supabase Data API

The application uses Prisma, not the Supabase Data API. If an isolated test or
historical Supabase project is retained, disable its Data API and verify its
settings separately; it is not the production database or rollback target. The
database migration also enables RLS and revokes table privileges from `anon`,
`authenticated`, and `service_role`; `npm run prisma:security:verify` enforces
that state during CI and deployment.

## External-Service Readiness

- Resend requires a verified sending domain for normal application recipients. If switching back, Amazon SES sandbox delivery remains restricted to verified recipients. Production startup always requires complete configuration for the selected provider while password authentication is enabled.
- PayHere may remain completely unconfigured. Free registrations and bank-transfer tournaments continue to work; PayHere tournament checkout and merchandise checkout remain unavailable until all PayHere values are configured.
- The frontend is deployed as part of the protected immutable Compose release; there is no separate Vercel promotion workflow.
- The sitemap and crawler configuration are managed by the frontend deploy. After public-route or metadata changes, follow [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) and confirm the existing Search Console submission remains healthy.


### VALORANT production integration gate

`APP_ENV=production` fails closed on missing service credentials, Henrik settings,
Discord OAuth/worker settings, admin key, malformed redirects or invalid database
TLS settings. `/api/v1/health` performs non-mutating checks and a database read.
Production admission requires `status=ok`, `db=up`, `integration=ready`, and every
check (`service_token`, `henrik`, `discord_oauth`, `oauth_redirect`,
`discord_workers`, `tls`) equal to `ready`. Missing/malformed/DB-only responses
are rejected by release and cutover controllers.

The Quest JavaScript service-token signer signs the health request and FastAPI
verifies its key ID, HMAC, issuer, audience and clock contract. The other checks
validate configuration; they do not prove external Henrik/Discord availability.
No health probe registers a player, writes data, or mutates Discord roles.

API admission inspects Docker health status; each required worker must have
three consecutive running observations separated by two seconds. Interruption
resets the counter and updater/bot failure prevents writer admission. This is
sustained process liveness, not proof of completed external work. Keep coordinated
freeze and release rollback gates enabled.

Nginx preserves ACME HTTP challenge handling and redirects other HTTP requests
to HTTPS. Cloudflare must use Full (strict) with valid origin TLS before cutover.
