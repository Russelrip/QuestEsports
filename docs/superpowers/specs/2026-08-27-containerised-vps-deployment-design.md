# Containerised VPS Deployment Design

**Date:** 2026-08-27
**Status:** Review blockers addressed; implementation blocked pending final spec approval

## Goal

Move the QuestEsports frontend, backend, and PostgreSQL database from the
current Vercel/PM2/Supabase arrangement to a maintainable single-VPS
deployment, while preserving the existing migration, backup, restore, health,
and rollback safety controls.

The first implementation must also leave a reliable local Compose workflow.
The existing local Docker artifacts remain development-only and must not be
silently promoted to production.

## Hard precondition

Before implementation or cutover work begins, the owner must pass an objective
Supabase **Egress** gate. The account is repository-recorded at 141% of the
free allowance (7.07 GB against 5 GB), with the grace period ending 24
September 2026; this live figure and the Usage page must be verified by the
owner before work starts. Record a dated, categorized breakdown (application,
local development, jobs/polling, storage, and any other category shown), a
post-fix baseline and observation window after the two known causes—production
targeting from local development and the previous 5-second job polling
interval—were corrected, and the source health result. Run the approved source
health check and test 402/quota handling only in a mock or disposable
environment; never provoke a quota response in production. The owner must
observe the corrected production workload for at least 72 hours after the
fixes (or longer when required to cover the relevant billing period),
recording categorized totals and the post-fix daily rate. There must be no
unexplained category, and the measured rate must remain within the configured
plan quota. If the applicable plan is the free 5 GB per month plan, its
sustained equivalent is approximately 170 MB/day. Production logs and health
results must show no 402 responses. The owner must record the conclusion
explaining the observed egress. Any unexplained egress, failed source-health
check, production 402, or rate above the configured quota is a hard block, not
an item to investigate during cutover.

## Decisions

### Deployment model

- GitHub Actions builds immutable frontend, backend, and migration images.
- Images are published to GHCR and deployed by exact image digest, not by a
  mutable `latest` tag.
- Docker Compose is the single-VPS release orchestrator, not the build system
  or backup scheduler.
- PostgreSQL 17 is a separately versioned production service in Compose with a
  durable host bind mount.
- Host Nginx and Certbot remain the initial public ingress and TLS boundary.
  Only ports 80/443 and restricted SSH are externally reachable.
- Host systemd retains deployment locks, backup timers, freshness checks,
  failure notifications, and guarded restore operations.
- The two independently released Compose projects use fixed identities
  `quest-prod` and `valorant-prod`, set with `COMPOSE_PROJECT_NAME` or an
  equivalent explicit `--project-name`; identities never derive from commit
  directory names.
- Application and database secrets are runtime configuration. No secret is
  placed in an image, build argument, release bundle, or repository.

### Privileged access

The deployment account `deploy` currently holds exactly one sudo grant:

```text
(root) NOPASSWD: /usr/bin/systemctl restart valorant-platform valorant-updater valorant-discord-bot
```

Nothing in Phases 1–3 is possible under that grant. Installing Docker,
creating `/srv/quest-esports/postgres/17/data`, `/opt/quest-esports/`, and
`/etc/quest-esports/`, adding systemd units, and changing firewall and Nginx
configuration all require root. The design must therefore name two distinct
actors before implementation begins:

1. **Host bootstrap actor.** A root-capable operator performs one-time host
   preparation (Docker installation, directory and ownership creation, systemd
   units, firewall, Nginx). This is owner-performed maintenance, not part of
   the automated release path, and is recorded as an explicit runbook step.
2. **Release actor.** CI connects as `deploy`, so `deploy` must be able to run
   the release operation unattended after bootstrap.

The privilege granted to the release actor is a security decision that must be
made deliberately here rather than discovered during implementation. Membership
of the `docker` group is equivalent to root on this host and therefore
re-grants, to the CI-reachable account, the privilege the current sudoers
policy deliberately withholds. The preferred form is a narrow `NOPASSWD`
sudoers entry for a single fixed, root-owned, non-writable release script,
with no wildcard arguments. If the `docker` group is chosen instead, the
design must state that CI compromise equals host compromise and accept it
explicitly.

### Future deployment path

Each release is a directory named by the source commit, containing the Compose
manifest, exact image digests, non-secret configuration templates, and release
metadata. A protected deployment operation pulls those images, runs the
explicit migration step when required, checks readiness and smoke endpoints,
then switches the active release. Previous release manifests and image
references remain available for rollback.

The VPS does not run `npm ci`, build source, or depend on a mutable source
checkout for deployment. The source checkout may remain for operational
scripts, but runtime artifacts come from the signed registry images.

If GitHub Actions is unavailable, the supported policy is to **wait**: keep
the currently deployed digest running and do not build untrusted or
unreproducible images on the VPS. A future break-glass procedure may be added
only if it reproduces the same pinned build, tests, signing, SBOM/provenance,
and registry publication guarantees; it is not part of this initial design.

### Accepted tradeoff: loss of edge delivery

Moving the frontend off Vercel replaces global edge delivery with a single
origin in France, while the audience is primarily in Sri Lanka. Every static
asset, document, and navigation currently served from a nearby edge location
will instead cross that distance from one host, and the VPS absorbs traffic
Vercel previously absorbed.

This is a real cost of consolidation, not an oversight, and the design accepts
it in exchange for a single operational surface, removal of a third provider,
and the elimination of the Vercel/VPS split-brain in the release path. It is
recorded here so it is a decision rather than a discovery after cutover.

If measured latency proves unacceptable, the supported remedies are a CDN in
front of the host origin or retaining Vercel for the frontend only. Both are
compatible with this design; neither is in initial scope.

### Canonical cross-repository host lock

Host bootstrap creates exactly one cross-repository lock at
`/var/lock/quest-esports-release.lock`, owned by `root:deploy` with mode `0660`.
Quest CI/release, sibling CI/release, the host backup wrapper, and the sibling
weekly name-audit timer must all acquire this exact lock with `flock`. No
alternate cross-repository lock may replace it or be acquired in parallel. The
existing backup lock is the only nested lock and follows the ordering below.

The Quest and sibling deploy/release paths acquire the lock before doing any
deployment work and hold it for the entire deploy, migration, read-only
validation, writer admission, and active-release switch. If a deploy invokes
the backup wrapper, the wrapper runs under that already-held canonical lock
before acquiring the existing `/srv/quest-esports/backups/.quest-backup.lock`;
the backup lock is never acquired first. An independently invoked backup
wrapper acquires the canonical lock before archive creation and holds it from
archive start through all remote uploads and remote verification. The
name-audit timer acquires the canonical lock only for its one-shot invocation.
These intervals and ordering rules avoid deadlock and prevent an alternate lock
from allowing concurrent writers.

## Target topology

```text
Internet
  questesports.lk / www       -> host Nginx + Certbot -> 127.0.0.1:3000 frontend
  api.questesports.lk         -> host Nginx + Certbot -> 127.0.0.1:5001 backend

Docker networks
  app                         -> frontend, backend
  database (internal)         -> backend, postgres
  quest-shared (external)     -> quest-backend, quest-postgres,
                                valorant-platform, valorant-updater,
                                valorant-discord-bot,
                                valorant-name-audit (weekly one-shot)

Persistent host paths
  /srv/quest-esports/postgres/17/data
  /srv/quest-esports/uploads
  /srv/quest-esports/private
  /srv/quest-esports/backups

Release/config paths
  /opt/quest-esports/releases/commit-sha/
  /opt/quest-esports/current
  /etc/quest-esports/*.env
```

The frontend and backend processes listen on `0.0.0.0` inside their containers;
only the host publication is loopback-bound, for example
`127.0.0.1:3000:3000` and `127.0.0.1:5001:5001`. Nginx reaches those host
ports, while no application port is externally published. PostgreSQL and the
VALORANT services publish no host ports. Upload roots are bind-mounted and
never depend on container layers. Private uploads remain unreachable from
Nginx and the public API.

`quest-shared` is a pre-created external Docker network, deliberately shared
by the independently released Quest Compose project and the independently
released `valorant-platform-backend` Compose project. The Quest project gives
its services the stable aliases `quest-backend` and `quest-postgres`; the
sibling project gives its containers the stable aliases
`valorant-platform`, `valorant-updater`, `valorant-discord-bot`, and
`valorant-name-audit`. The
VALORANT containers use `quest-postgres` (never a container-loopback address)
for the shared `valorant` schema. Network creation and alias verification are
host-bootstrap/runbook responsibilities, not an implicit side effect of
starting either project.

The sibling repository remains independently built, signed, released, and
deployed. Its three current systemd services are a transition boundary only:
they must be stopped before PostgreSQL 17 is made internal-only and must be
migrated to sibling-repository Compose containers attached to `quest-shared`
for the final target. Stop them, but do not mask them, before the final
backup/restore and while pre-commit validation is in progress. If validation
fails before successful writer admission, the stopped, still-unmasked units may
be restarted while the old database remains authoritative. After the sibling
Compose writers are successfully admitted on PostgreSQL 17, mask the old units
as final-target cleanup; rollback after that commit never restarts them. They
must not remain as host processes pointed at a Docker-only database endpoint.
Until that migration is ready, the current systemd services remain on their
existing database and are not partially redirected to PostgreSQL 17. If a
temporary host-process rehearsal requires PostgreSQL 17, use an explicitly
approved loopback-only temporary publication and remove it before the final
target; host services may not depend on the internal Docker alias.

The production Quest-to-VALORANT API path is HTTPS over the stable internal
endpoint `https://valorant-platform:8000`, not the current plain-Uvicorn host
service path. The FastAPI container must bind `0.0.0.0:8000` and terminate TLS
with a private-CA certificate whose SAN includes `valorant-platform`. The
certificate, private key, and CA chain are mounted as runtime secrets. Quest's
Node client must trust that CA through `NODE_EXTRA_CA_CERTS` or an equivalent
explicit client trust configuration, and every VALORANT client that calls the
API must receive the same CA trust configuration. The deployment must run an
HTTPS integration smoke test from the Quest container to
`https://valorant-platform:8000/api/v1/health`, verifying both certificate
validation and the decoded JSON response: `status == "ok"` and `db == "up"`.
An HTTP 200 alone is insufficient. No plain-HTTP or host-process Uvicorn
endpoint is the final production path.

The backend's production database URL must use an approved TLS mode. A Docker
service name is not loopback, so the design must configure PostgreSQL with
server-side TLS, a private CA, and a certificate valid for the stable endpoint
aliases used by both repositories (including `quest-postgres`), then use full
certificate verification. The private CA must be mounted/distributed as
runtime configuration to Quest and each VALORANT container, with rotation and
ownership recorded. A temporary host-process endpoint must use the same CA
and a certificate valid for its explicitly selected endpoint. It must not
silently add `sslmode=require` without configuring server-side TLS.

This decision must be resolved separately for each of the two consumers,
because they do not share a driver or a URL syntax:

- **Quest** connects through Prisma and expresses TLS as `sslmode=`, with the
  CA supplied by `sslrootcert=`.
- **VALORANT** connects through SQLAlchemy/asyncpg as
  `postgresql+asyncpg://...?ssl=require`. asyncpg does not accept `sslmode` at
  all, and verify-full behaviour is configured through an SSL context rather
  than a URL parameter.

A single agreed "TLS mode" phrased only in `libpq` terms is therefore not
implementable on the VALORANT side. Both spellings, and the CA distribution
mechanism for each, must be recorded and tested during the rehearsal.

The sibling API's TLS certificate/key/CA secrets are owned and rotated by the
sibling deployment, while Quest's client CA trust is owned by the Quest
deployment. The two release paths must coordinate rotation and retain the
HTTPS smoke test as a release gate.

## Images

The implementation will add production-specific build targets without
changing the local development Dockerfile or its `dev:container` command.

1. **Frontend image**
   - Multi-stage Next.js build with standalone output.
   - Production `NEXT_PUBLIC_*` values supplied at build time and validated by
     `next.config.ts`.
   - Non-root runtime, read-only root filesystem where practical, and only
     explicitly writable temporary/cache paths.
   - A dependency-free health route for container liveness.

2. **Backend image**
   - Multi-stage Node 24 build.
   - Prisma generated during the image build for the image platform.
   - Production dependencies only and a fixed non-root runtime UID compatible
     with upload ownership.
   - Runtime command is the production server, never the local development
     command.

3. **Migrator image/target**
   - Built from the same source commit as the backend.
   - Includes Prisma CLI, migrations, schema-scope/security verification, and
     required operational scripts.
   - Runs once as an explicit release action and never as a long-lived
     `depends_on` startup service.

Base images are pinned by digest. GHCR references in the release bundle use
digests. CI also publishes an SBOM/provenance and signs images using a
configured keyless OIDC signing flow.

## Release and rollback flow

1. Acquire `/var/lock/quest-esports-release.lock` with `flock` before any
   deployment work, and retain GitHub concurrency protection. Hold the
   canonical lock for the entire deploy, migration, read-only validation,
   writer admission, and active-release switch. Quest and every sibling
   release/migration path must acquire this same lock; the backup wrapper and
   weekly name-audit timer use the ordering and hold intervals in the
   *Canonical cross-repository host lock* section. Sibling CI/CD and host-timer
   changes are required before cutover.
2. Check disk space, database health, backup freshness, registry access, and
   the active release.
3. Pull candidate images by digest and stage the sibling Compose images/config
   without starting any writer.
4. Detect both changed migrations and migrations actually pending in the
   target database.
5. When either repository has a migration pending, require explicit approval
   from the migration owner(s), serialize the operation under the shared host
   lock, and first create and remotely verify one full encrypted archive of
   `public`, `valorant`, and both upload roots. Migrations and backups are
   serialized; no migration may run without that verified archive.
6. Run the one-shot migrator(s) and the existing Prisma/schema security checks.
   Migrations are never automatically rolled back; use fix-forward or the
   guarded restore procedure.
7. Replace the backend, then verify container liveness and
   `/api/health/ready`, followed by representative tournament and commerce
   reads.
8. Verify the Quest-container HTTPS call to
   `https://valorant-platform:8000/api/v1/health`, including private-CA
   certificate validation and decoded JSON assertions `status == "ok"` and
   `db == "up"` (not merely HTTP 200), then replace the frontend and verify its
   health route, sitemap, robots response, and API compatibility.
9. Atomically update the active release pointer and retain the previous
   release metadata.

Compose health checks provide liveness. Release admission uses readiness so a
   deliberate maintenance state is not mistaken for a crashed process. The
   backend receives at least a 40-second stop grace period to cover its
   existing SIGTERM drain.

Rollback is explicit because Compose is not transactional:

- Backend failure redeploys the previous backend digest.
- Frontend failure rolls back the frontend independently when API compatibility
  permits it.
- Database migrations are never automatically reversed. A failed migration is
  fixed forward or recovered through the guarded restore procedure.
- A release is not considered successful until both public services pass their
  checks.
- Deployment and rollback must verify exactly one Compose project with
  identity `quest-prod` and exactly one with identity `valorant-prod` is active,
  and that their aliases on `quest-shared` are unique. The verification is
  independent of the release/commit directory.

## PostgreSQL and shared VALORANT schema

This is a two-repository, two-service database cutover. Both schemas move
together:

- Quest owns the `public` schema.
- `valorant-platform-backend` owns the `valorant` schema.
- Quest's Prisma schema-scope verification remains enabled and continues to
  prevent Quest from reaching into `valorant`.
- The existing full archive already dumps both schemas when `valorant` exists.

The sibling repository remains independently built and released. Its current
VPS checkout is `/var/www/valorant-platform-backend`, owned by `deploy`, with
the `valorant-platform`, `valorant-updater`, and `valorant-discord-bot`
systemd units. Those units are the temporary/current transition boundary, not
the final runtime: the sibling repository must add and operate its own Compose
containers with the stable aliases on `quest-shared`, then stop the three host
services as part of the final cutover. Leave them unmasked until the sibling
Compose writers are successfully admitted on PostgreSQL 17; mask them then as
final-target cleanup. During the transition, its
`DATABASE_URL` and all relevant process environments must change to the new
PostgreSQL 17 instance in the same operation as Quest's
`DATABASE_URL`/`DIRECT_URL` change, but only through an endpoint reachable by
the selected process boundary. A host systemd process cannot reach an
internal-only Docker service name; it must either remain on the old database
until stopped or use a temporary loopback publication with the private TLS CA
and a certificate-valid endpoint. The final Compose containers use
`quest-postgres`, the private CA, and full TLS verification. The three units
must be stopped before the final backup/restore and remain unmasked through
pre-commit validation, so they can be restarted if that validation fails while
the old database remains authoritative. Once writer admission succeeds at the
commit point, mask them for the final target; no rollback after commit may
restart them. They must not be left running against an unreachable internal
database.

The sibling repository and its VPS service units are outside this repository's
implementation ownership. Completing the database cutover therefore requires
a coordinated change in that repository/deployment, not a Quest-only Compose
change.

After the final cutover, the sibling host units are stopped and masked. The
sibling repository must change its CI/CD and host automation to acquire the
canonical `/var/lock/quest-esports-release.lock` with `flock`, serialize
migrations and backups, require the shared verified full archive and explicit
migration approval, and use the fixed `valorant-prod` project identity. Its
weekly name audit is a routine writer, not a migration: it is a sibling-owned
Compose one-shot service/container attached to `quest-shared`, run with the
fixed `valorant-prod` Compose project and pre-created `quest-shared` network,
and invoked by a host systemd timer (or equivalent). Before enabling it,
inventory and disable any previous name-audit cron job or timer. Each timer
invocation acquires the canonical lock only for that one-shot. If deployment or
cutover holds the lock, the timer must produce an operator-visible skipped/retry
result rather than wait behind or bypass the lock. A weekly run does not require
the global freeze or a full archive; those gates are reserved for migrations and
destructive maintenance. It remains a sibling Compose writer, not a host
writer outside the lock boundary.

The PostgreSQL bootstrap procedure recreates the database, runtime roles,
migrator roles, ownership, and grants for both services. The restore archive
uses `--no-owner --no-acl`, so role/bootstrap verification is mandatory.

### Coordinated write-freeze validation mode

The current Quest deployment has no global read-only mode, and the current
VALORANT runtime, updater/name-audit, and bot can all be writers. Before a
production migration, both repositories must implement and exercise one
coordinated freeze/validation mode. While it is active:

- mutating HTTP requests and inbound callbacks are blocked with an observable,
  retryable maintenance response (including `Retry-After` where applicable);
- all Quest workers and schedulers are disabled, and all VALORANT runtime
  writer paths plus updater, name-audit, and bot writers are disabled;
- a durable/observable status endpoint or equivalent operator probe reports
  the freeze state and acknowledgement from both repositories; and
- only read-only health checks and SELECT-only validation probes are allowed.

The freeze is not inferred from a maintenance page or from stopping public
traffic. The runbook must prove that every writer is disabled and that queued
or retried mutations cannot be released during validation. The **migration
commit point** is the first intentional start/admission of any writer with
writes enabled on PostgreSQL 17. Before that point, services may run only in
their explicitly read-only validation mode; only one-shot migration checks
and read-only probes may run, and both repositories can still be returned to
the old configuration without a split-brain write. After any writer starts on
PostgreSQL 17, no URL rollback to stale Supabase is permitted; recovery is a
controlled restore/reconciliation operation.

### Coordinated cutover and partial-failure rollback

Before cutover, restore a complete archive containing both `public` and
`valorant` into an isolated PostgreSQL 17 instance and validate both services.
During the production window:

1. Stage/pull both Compose projects using `quest-prod` and `valorant-prod`
   without starting writers. Activate the coordinated freeze and obtain
   observable acknowledgements from Quest and VALORANT. Disable Quest
   workers/schedulers and every VALORANT runtime, updater, name-audit, and bot
   writer; then stop the current host units before the final backup/restore,
   leaving them unmasked. They remain restartable only if validation fails
   before the commit point, while the old database remains authoritative.
2. Create and verify the final archive containing both schemas and both upload
   roots.
3. Restore the archive to PostgreSQL 17 and verify roles, migrations, schema
   scope, TLS/CA, and read-only service health.
4. Change both repositories' database configuration together and run only
   one-shot/read-only validation before the commit point.
5. Start only the sibling Compose service group and Quest services in their
   explicitly read-only/frozen mode and validate both groups, including the
   Quest-to-VALORANT HTTPS health smoke test, which must validate the
   certificate and assert decoded JSON `status == "ok"` and `db == "up"`, not
   merely HTTP 200. Verify one project of each fixed identity and unique
   aliases on `quest-shared`. Only after both repositories acknowledge
   readiness does the orchestrator issue the coordinated writer-enable
   operation. The **migration commit point** remains the instant the first
   writer is admitted on PostgreSQL 17; record that event and the
   acknowledgements at the time it occurs. Once the coordinated writer-enable
   succeeds, mask the stopped old host units for the final target. Keep the
   freeze active until this validation succeeds.

If either service fails before the commit point, keep both Compose service
groups stopped, restore both configurations to the previous database, and
discard or isolate the new PostgreSQL instance. If the rollback needs the old
runtime, restart only the previously stopped/unmasked sibling host units while
the old database remains authoritative; do not start them against PostgreSQL
17. Never leave one service using the new database while the other crosses the
network to the old database. The cutover
rehearsal and acceptance test must inject at least: a failed/invalid archive or
checksum, a wrong CA/blocked shared-network path, a failed Quest service, a
failed VALORANT service, and an attempted mutation/callback during the freeze.
Each injection must show an observable failure, retry/block behaviour, and no
partial writer admission.

After writes resume on PostgreSQL 17, the old Supabase database is stale and
is not an automatic rollback target. Any later rollback requires a controlled
restore/reconciliation decision; it cannot safely be achieved by changing one
URL back.

If any service fails after the commit point, stop both writer groups and
re-enable the coordinated freeze. Before restoring anything, capture a full
current PostgreSQL 17 logical database archive and upload snapshot, and
checksum the database archive and both upload roots. If the logical PostgreSQL
17 dump cannot complete, a raw snapshot of the stopped PostgreSQL 17 data
volume may be used as the database fallback; stop PostgreSQL before taking that
snapshot and checksum the snapshot and both upload roots. Declare the expected
data loss and RPO for the selected recovery point, and obtain
incident-owner approval for the fix-forward or controlled
restore/reconciliation action. Do not redirect only the failed service to
Supabase, and do not claim that an application release rollback reverted a
database cutover. A post-commit recovery never restarts an old writer group
without that approval and evidence.

## Backup and recovery

The existing `ops/backup-production.sh`, restore, freshness, checksum, and
retention tooling remains the operational foundation. Its age encryption,
SHA-256 sidecars, two-pass upload snapshot, `flock`, destructive restore
confirmations, and freshness checks are preserved.
The multi-remote host backup wrapper must acquire
`/var/lock/quest-esports-release.lock` before the existing
`/srv/quest-esports/backups/.quest-backup.lock`, and hold the canonical lock
from archive start through all remote verification.

The current off-site destination is **already non-Supabase**. Repository
records state that the configured rclone remote is Google Drive (`type =
drive`), writing to `quest-esports-v2/production`, and that the daily unit is
uploading successfully. These are live Google Drive/timer claims, not proof:
the owner must verify the remote, timer, last successful upload, and freshness
against the live host before relying on them. Supabase Storage was never the
destination, so "move off Supabase Storage" is not a reason to change anything
and must not be used to justify this phase.

The actual reasons to move to an rclone-supported B2, S3, or R2 remote are:

- **No immutability.** Google Drive offers no object lock or write-once
  retention, so anything able to write the backups can also delete them. An
  object-locked destination is optional, not a prerequisite, but it is a
  useful ransomware-resistance enhancement if the selected provider supports
  it.
- **Credential fragility.** The remote authenticates with a refreshable OAuth
  token that can be revoked or expire out of band, with failure surfacing only
  through the freshness check. Separate credentials and operational ownership
  per remote are required for independent recovery.
- `rclone check` already verifies content (including matching checksums where
  the backend exposes them, and otherwise size/content according to rclone's
  semantics). The stronger remaining gaps are immutability, provider
  lifecycle/retention enforcement, and credential separation—not the absence
  of a content check.

Supabase Storage remains excluded on its own merits: the 1 GB free limit, the
existing egress overage, and the undesirable coupling of disaster recovery to
the provider being migrated away from.

The current tooling supports one `BACKUP_RCLONE_REMOTE`, so dual write cannot
be requested merely by listing two values. Before Phase 4, add a small,
root-owned multi-remote wrapper/configuration around the existing backup flow.
One encrypted archive and its SHA-256 sidecar are created per run; the wrapper
then independently uploads that same archive to each configured named remote,
runs `rclone check` for each, records per-remote freshness, and applies
per-remote retention/pruning guards. A required remote failure makes the run
fail and alerts, while preserving the result and last-success timestamp for
each remote. Use separate rclone credentials/configuration and access
ownership per remote. `BACKUP_RCLONE_REMOTE` remains supported for the current
single-remote transition, but the final multi-remote configuration must not
silently collapse to one destination.

The existing Google Drive destination remains configured until all of the
following are true for the new configured remote, with the same checks also
recorded independently for Google Drive:

1. The new remote receives encrypted archives and matching checksums.
2. Its per-remote content verification, retention, and freshness checks pass.
3. A complete archive is downloaded and restored in an isolated PostgreSQL 17
   environment, including both schemas and upload roots.
4. The restore is inspected and documented.

Daily backups remain scheduled by host systemd, and the timer plus each
per-remote result is monitored. Existing retention and pruning guards remain
confirmation-gated. The private `age` identity stays in at least two
controlled offline copies and is never permanently mounted on the VPS. The
backup credentials, encryption recipient, and remote configurations are
runtime secrets. Object lock is optional; if selected, its provider policy,
retention, and deletion authority must be tested and documented. A second
independent destination is strongly preferred, but no specific object-lock
feature is mandatory.

## Mandatory PostgreSQL 17 rehearsal

Before production cutover, the source PostgreSQL major version must be
recorded explicitly. A full production-shaped archive must be restored with
`ops/restore-production-backup.sh` against a PostgreSQL 17 instance, not merely
checked with `pg_restore --list`.

If the recorded source major differs from 17, this is an approved logical
major-version migration with its own rehearsal, owner approval, and cutover
gate. It must not be described or treated as an ordinary application release.
If the source is already major 17, the same rehearsal still gates the move and
must prove compatibility and operational recovery.

### Client version pinning

Recording the *server* version is not sufficient, because the VPS cannot
currently be trusted to select a matching *client*. The host has PostgreSQL
client packages 16, 17, and 18 installed simultaneously, and `pg_wrapper`
currently resolves them inconsistently:

```text
psql     -> 18.6
pg_dump  -> 16.15
```

A `pg_dump` older than the server it is dumping refuses to run, and a
`pg_restore` chosen by accident is how a rehearsal appears to fail for
reasons unrelated to the design. The rehearsal and the cutover must therefore
run `pg_dump`/`pg_restore` from a version-pinned `postgres:17` container image
rather than from whatever the host `PATH` resolves to, or invoke the absolute
versioned binary path explicitly. The chosen mechanism is recorded in the
runbook.

### Stray cluster handling

The host also runs an empty PostgreSQL 16 cluster on `127.0.0.1:5432`, and has
a `postgresql-18` server package installed with no cluster. Neither is used by
Quest or VALORANT; both currently point at Supabase. The containerised
PostgreSQL 17 publishes no host port, so there is no port conflict, but an
idle local server listening on the conventional port is an invitation to
restore into the wrong database during a maintenance window. First run
`pg_lsclusters` to record the PostgreSQL 16 cluster version/name, then use
`systemctl` to map that cluster to its exact unit (expected to be
`postgresql@16-main.service` if that is what the host reports). Stop and mask
only that exact cluster unit, then confirm that no stray local cluster is
listening. Do not require removal of PostgreSQL
packages: preserve installed packages unless a separate inventory/cleanup
approval authorizes removal.
Every application, backup, migration, and rehearsal command must use an
explicit endpoint and the pinned PostgreSQL 17 client, never an ambient
localhost default or `pg_wrapper` resolution.

The rehearsal evidence must include measurable, retained results for:

- source and target server versions, including confirmation of the pinned
  PostgreSQL 17 `psql`, `pg_dump`, and `pg_restore` client versions;
- successful restoration and object/file counts for both `public` and
  `valorant`, plus both public and private upload trees;
- migration ledgers for Quest and VALORANT before and after restore;
- database role ownership, default privileges, explicit grants, and
  least-privilege checks for runtime and migrator roles;
- extension inventory and relevant PostgreSQL settings inventory before and
  after restore;
- Quest readiness and representative read results, with no write side effect;
- Quest-container HTTPS health smoke evidence showing certificate validation
  and decoded JSON `status == "ok"` plus `db == "up"`, not merely HTTP 200;
- VALORANT API, updater, and bot connectivity plus controlled writer checks
  proving that writers can be blocked and later admitted deliberately;
- encrypted archive checksum and decryption verification; and
- measured restore duration (including archive download, restore, bootstrap,
  and validation), resource usage/observed gaps, and the resulting RTO decision.

Because the archive is restored with `--no-owner --no-acl`, successful object
loading alone is insufficient. The rehearsal must explicitly bootstrap the
roles, ownership, default privileges, and grants before service validation.

The rehearsal must complete before the final cutover window is scheduled.

## Operational boundaries

- SSE settings must be **set explicitly, not preserved**. The current
  `quest-api` server block contains no `proxy_buffering` or `proxy_read_timeout`
  directive at all. Buffering-off works today only because the application
  sends `X-Accel-Buffering: no` from
  `backend/src/modules/realtime/realtime.controller.js`, and the stream
  survives only because Nginx's default 60-second read timeout happens to
  exceed the 25-second heartbeat in the same file. Nothing pins either
  property. The new configuration must state `proxy_buffering off` and a
  `proxy_read_timeout`/`proxy_send_timeout` comfortably above the heartbeat
  interval, so the invariant does not depend on an application header and a
  compiled-in default coinciding.
- The frontend and backend processes must bind `0.0.0.0` inside their
  containers so Compose networking and the host-published ports work. Their
  host publications must bind only to loopback (for example,
  `127.0.0.1:3000:3000` and `127.0.0.1:5001:5001`); Nginx is the only public
  ingress. Do not confuse the container bind address with the host exposure.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` appear in both the application
  environment and `/etc/quest-esports-backup.env`. Both must resolve to the
  same host bind mounts after containerisation. If the application writes to a
  container path while the backup unit reads the host path, backups continue to
  succeed while archiving an empty directory, and the loss is discovered only
  at restore.
- `TRUST_PROXY`, HTTPS origins, upload limits, OAuth callbacks, payment
  callbacks, and private-upload isolation retain their existing production
  invariants.
- A source-major-different-from-17 move is an approved logical PostgreSQL
  major migration with its own rehearsal and gate, separate from ordinary app
  releases.
- VALORANT has an independent image, release cadence, and migration ownership,
  but its database URL change is coordinated with Quest's shared-database
  cutover.
- The existing local Compose stack keeps its local database override,
  platform-specific Prisma generated volume, and `dev:container` entrypoint.

## Phased implementation and migration

### Phase 0 — Preconditions and rehearsal

- Pass the objective Supabase Egress gate: observe at least 72 hours after the
  fixes (or longer when the billing period requires), record categorized
  totals and the post-fix daily rate, verify source health and no production
  402s in logs/health, and test 402 handling only in a mock/disposable
  environment. Require no unexplained category and a rate within the
  configured plan quota (approximately 170 MB/day for a 5 GB/month free plan,
  if applicable); otherwise stop.
- Confirm VPS CPU, RAM, disk, firewall, DNS, IPv4/IPv6, and TLS prerequisites.
- Record source PostgreSQL major version and current schema/role state. If it
  differs from 17, obtain approval for the logical major migration and its
  separate gate.
- Pre-create and verify the `quest-shared` external network and stable aliases
  for both repositories.
- Add and test the multi-remote backup wrapper: one encrypted archive per run,
  independent upload/check/freshness/retention result per remote, while
  retaining the existing Google Drive destination during transition.
- Build production images and run the complete PostgreSQL 17 restore rehearsal.

The following were verified against the running host on 2026-08-27 and are
**not** met. Each is a prerequisite, not an implementation detail:

- **Privileged actor.** `deploy` cannot perform host bootstrap. Confirm who
  does, per the *Privileged access* decision above.
- **Docker is not installed.** The host has no `docker` binary. Installation is
  root-only bootstrap work.
- **No swap is configured.** The host has 7.8 GiB RAM and zero swap, and is
  about to gain a Next.js runtime and PostgreSQL alongside the existing
  backend and three VALORANT units. Make swap a measured-capacity decision
  based on observed peak memory, PostgreSQL memory parameters, and the RTO/RPO
  decision rather than an unconditional requirement. If swap is enabled, use
  encrypted swap and configure it to protect secrets and database pages from
  exposure. Set explicit PostgreSQL memory parameters from measured host
  capacity and workload; do not assume that container or PostgreSQL defaults
  fit this shared host.
- **IPv6 is only half-configured.** The host holds a global IPv6 address, but
  the `quest-api` server block listens on `listen 443 ssl;` only, with no
  `listen [::]:443`. Either complete IPv6 ingress or remove it from the
  prerequisite list; it must not remain listed as satisfied when it is not.
- **Stray PostgreSQL servers.** Run `pg_lsclusters`, map the reported idle
  PostgreSQL 16 cluster to its exact systemd unit with `systemctl` (expected
  `postgresql@16-main.service` if that is what exists), stop and mask only that
  unit, confirm no stray listener, and preserve packages unless a separate
  inventory cleanup approves removal, per *Stray cluster handling* above.

### Phase 1 — Production image and Compose foundation

- Add production frontend/backend/migrator images and `.dockerignore` rules.
- Add production Compose configuration with bind mounts, the internal database
  network plus the pre-created external `quest-shared` network, stable aliases,
  loopback-only host publications, non-public database ports, runtime secrets,
  fixed `quest-prod`/`valorant-prod` project identities, and health checks.
- Exercise the stack against a disposable PostgreSQL 17 database.

### Phase 2 — CI release and VPS deployment automation

- Build, test, scan, sign, and publish images from the source commit.
- Publish an exact-digest release bundle.
- Implement the lock, backup gate, explicit migration, readiness checks,
  smoke checks, active-release switch, and rollback flow. Update sibling CI/CD
  and release/migration/backup timer paths to use the canonical lock, freeze,
  full-archive backup gate, and explicit migration approval; the routine weekly
  name-audit timer uses the canonical lock without the migration freeze or
  archive gate. No automatic database rollback is allowed.
- Keep the existing PM2/Vercel deployment available until observation and
  rollback evidence are complete.

### Phase 3 — Coordinated service/database cutover

- Stage and verify the sibling repository's independently released Compose
  images/configuration on `quest-shared` without starting writers, including
  its weekly name-audit one-shot container and host timer boundary. Stop the
  three temporary host systemd service units before final backup/restore,
  leaving them unmasked until successful writer admission. Start sibling
  containers only in frozen/read-only mode during pre-commit validation. Mask
  the old units only after the commit point; they may be restarted only for a
  pre-commit rollback while the old database remains authoritative.
- Activate the coordinated write-freeze/validation mode across both
  repositories in one maintenance window.
- Restore both schemas and uploads to PostgreSQL 17.
- Update both repositories' database configuration together.
- Run one-shot/read-only validation and the specified failure-injection checks
  before the commit point; validate all services, fixed project identities,
  unique network aliases, and the Quest-to-VALORANT HTTPS health smoke test
  before admitting writes.

### Phase 4 — Backup destination transition

- Run daily encrypted backups through the multi-remote wrapper to the new
  configured remote in parallel with the existing Google Drive destination.
  Object lock may be enabled where supported but is optional.
- Complete an isolated restore drill and verify per-remote content checks,
  freshness, retention, and credential separation.
- Retire the Google Drive destination only after owner approval and retained
  recovery evidence.

## Acceptance criteria

- Frontend and backend run from immutable non-development images on the VPS.
- A commit-digest release can be deployed without building on the VPS.
- A failed health check restores the previous application release without
  pretending a database migration was rolled back.
- Frontend and backend processes listen on `0.0.0.0` in containers while host
  publications are loopback-only (`127.0.0.1:3000:3000` and
  `127.0.0.1:5001:5001`); Nginx remains the only public application ingress.
- Quest PostgreSQL/backend and the sibling VALORANT platform, updater, bot, and
  sibling-owned weekly name-audit one-shot container attach to the pre-created
  external `quest-shared` network with the documented stable aliases. The
  sibling repository remains independently released, and its three former
  systemd services are stopped and masked for the final target only after
  successful writer admission/commit, rather than left unable to reach an
  internal-only database; before that point they remain unmasked for a
  pre-commit rollback. The name-audit one-shot is invoked by a sibling host
  systemd timer or equivalent, uses the canonical lock only for its one-shot,
  and reports a visible skip/retry when deployment or cutover holds the lock.
  It does not require the global freeze or a full archive for routine weekly
  runs, and any previous cron/timer is inventoried and disabled.
- Deployment and rollback use exactly one `quest-prod` Compose project and
  one `valorant-prod` Compose project, set explicitly rather than inferred from
  commit directories, with unique aliases on `quest-shared`.
- Quest and VALORANT both use the same PostgreSQL 17 instance after cutover,
  with `public` and `valorant` restored and correctly scoped.
- A partial service cutover cannot leave the two services split across old and
  new databases.
- Both repositories expose an observable coordinated write-freeze status;
  mutating HTTP/callback traffic is blocked or retryable, Quest workers and
  schedulers are disabled, and all VALORANT runtime/updater/name-audit/bot
  writers are disabled. Only health and SELECT-only probes run before the
  commit point.
- The migration commit point is recorded. Failure injection proves that an
  invalid archive/checksum, wrong CA or blocked network, failed Quest service,
  failed VALORANT service, and attempted mutation/callback cannot admit a
  partial writer. After any writer starts on PostgreSQL 17, no URL rollback to
  stale Supabase is attempted.
- The final Quest-to-VALORANT path is HTTPS at
  `https://valorant-platform:8000/api/v1/health`. FastAPI binds
  `0.0.0.0:8000`, terminates TLS with a private-CA certificate whose SAN
  includes `valorant-platform`, and mounts its certificate, key, and CA as
  runtime secrets. Quest trusts the CA through `NODE_EXTRA_CA_CERTS` or
  equivalent client configuration, VALORANT clients trust it too, and the
  smoke test runs from the Quest container. Acceptance requires certificate
  validation plus decoded JSON `status == "ok"` and `db == "up"`; HTTP 200
  alone does not pass.
- The local Compose safeguards remain green and Prisma generated artifacts are
  not hidden by host-platform mounts.
- The multi-remote backup wrapper creates one encrypted archive per run and
  records independent upload, `rclone check`, freshness, retention, and
  failure results for every configured remote, with separate credentials. An
  object lock is optional. Google Drive is retired only after owner approval
  and a verified restore from the new remote.
- The release actor's privilege is granted in the form chosen by the
  *Privileged access* decision, and host bootstrap steps are recorded as
  owner-performed runbook actions rather than assumed.
- The rehearsal records measurable source/target server versions and pinned
  PostgreSQL 17 client versions; restores both schemas; records migration
  ledgers, role ownership/default privileges/grants, least-privilege checks,
  extensions/settings inventories, upload/file counts, VALORANT connectivity
  and controlled writer checks, checksum/decryption, and measured restore
  duration. `--no-owner --no-acl` is followed by explicit role/bootstrap/
  ownership/grant setup. No idle local PostgreSQL server remains listening on
  the host, while package removal is not required.
- Nginx sets `proxy_buffering off` and read/send timeouts above the 25-second
  heartbeat explicitly, verified by an SSE stream held open past that interval
  without truncation.
- The application and the backup unit resolve `UPLOAD_ROOT` and
  `PRIVATE_UPLOAD_ROOT` to the same host paths, proven by a post-cutover
  archive containing a file written through the running application.
- A full archive has been restored successfully in isolation before cutover.
- The Supabase Egress gate is an objective pass/fail result with at least 72
  hours of post-fix observation (or the longer billing-period requirement),
  dated categorized totals, post-fix daily rate, source-health result, no
  unexplained category, and a rate within the configured plan quota (about
  170 MB/day for a 5 GB/month free plan, if applicable). Production logs and
  health show no 402 responses; 402 handling is tested only with a
  mock/disposable environment, never by provoking production quota.
- The sibling CI/CD and host-timer deployment paths acquire the exact
  `/var/lock/quest-esports-release.lock` with `flock`; deploy/release paths hold
  it for the entire deploy, migration, validation, and active-release switch,
  while the backup wrapper holds it from archive start through all remote
  verification and the weekly name audit holds it only for its one-shot. The
  backup wrapper acquires it before `/srv/quest-esports/backups/.quest-backup.lock`.
  Migration paths serialize backups and migrations, require one verified full
  archive of `public`, `valorant`, and uploads before either migration, and
  require explicit migration approval. No automatic database rollback is
  permitted.
- A post-commit service failure stops both writer groups and re-enables the
  freeze, then captures a full current PostgreSQL 17 logical database archive
  and upload snapshot, checksumming the database archive and both upload roots
  before any restore. If the logical dump cannot complete, a raw snapshot of
  the stopped PostgreSQL 17 data volume is an allowed database fallback; the
  snapshot and both upload roots must still be checksummed. Expected data
  loss/RPO and incident-owner approval are recorded before recovery. No old
  writer is restarted without that approval.
- An Actions outage leaves the current production release running and causes
  no unsupported VPS-side build.
