# Containerised VPS Deployment Design

**Date:** 2026-08-27
**Status:** Changes requested against ccf6727; implementation blocked pending resolution

## Goal

Move the QuestEsports frontend, backend, and PostgreSQL database from the
current Vercel/PM2/Supabase arrangement to a maintainable single-VPS
deployment, while preserving the existing migration, backup, restore, health,
and rollback safety controls.

The first implementation must also leave a reliable local Compose workflow.
The existing local Docker artifacts remain development-only and must not be
silently promoted to production.

## Hard precondition

Before implementation or cutover work begins, the owner must inspect the
Supabase Usage page's **Egress** breakdown. The account is currently recorded
at 141% of the free allowance (7.07 GB against 5 GB), with the grace period
ending 24 September 2026. The two known configuration causes—production
targeting from local development and the previous 5-second job polling
interval—were already corrected. The breakdown must be checked to confirm
that those corrections explain the excess and that the source database remains
healthy.

No container failure, migration, or database cutover should be diagnosed while
the source database may return a quota-related 402.

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

## Target topology

```text
Internet
  questesports.lk / www       -> host Nginx + Certbot -> 127.0.0.1:3000 frontend
  api.questesports.lk         -> host Nginx + Certbot -> 127.0.0.1:5001 backend

Docker networks
  app                         -> frontend, backend
  database (internal)         -> backend, postgres
                                -> optional VALORANT service

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

PostgreSQL and the VALORANT service publish no host ports. Upload roots are
bind-mounted and never depend on container layers. Private uploads remain
unreachable from Nginx and the public API.

The backend's production database URL must use an approved TLS mode. A Docker
service name is not loopback, so the design must either configure PostgreSQL
with a private CA and a certificate valid for `postgres` and use
`sslmode=verify-full`, or obtain an explicit, tested application/security
exception for the trusted internal network. It must not silently add
`sslmode=require` without configuring server-side TLS.

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

1. Acquire the host deployment lock and retain GitHub concurrency protection.
2. Check disk space, database health, backup freshness, registry access, and
   the active release.
3. Pull candidate images by digest.
4. Detect both changed migrations and migrations actually pending in the
   target database.
5. When migrations are pending, require the existing destructive-migration
   approval and a successful, remotely verified encrypted backup first.
6. Run the one-shot migrator and the existing Prisma/schema security checks.
7. Replace the backend, then verify container liveness and
   `/api/health/ready`, followed by representative tournament and commerce
   reads.
8. Replace the frontend and verify its health route, sitemap, robots response,
   and API compatibility.
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
systemd units. During the database migration window, its `DATABASE_URL` and
all relevant process environments must change to the new PostgreSQL 17
instance in the same operation as Quest's `DATABASE_URL`/`DIRECT_URL` change.
The three units must be stopped before the final backup/restore and restarted
only after their connectivity and schema checks pass.

The sibling repository and its VPS service units are outside this repository's
implementation ownership. Completing the database cutover therefore requires
a coordinated change in that repository/deployment, not a Quest-only Compose
change.

The PostgreSQL bootstrap procedure recreates the database, runtime roles,
migrator roles, ownership, and grants for both services. The restore archive
uses `--no-owner --no-acl`, so role/bootstrap verification is mandatory.

### Coordinated cutover and partial-failure rollback

Before cutover, restore a complete archive containing both `public` and
`valorant` into an isolated PostgreSQL 17 instance and validate both services.
During the production window:

1. Stop Quest writes and all three VALORANT units; maintenance mode alone is
   not a write freeze.
2. Create and verify the final archive containing both schemas and both upload
   roots.
3. Restore the archive to PostgreSQL 17 and verify roles, migrations, schema
   scope, and service health.
4. Change both repositories' database configuration together.
5. Start and validate both service groups before admitting writes.

If either service fails before writes resume, keep both service groups stopped,
restore both configurations to the previous database, and discard or isolate
the new PostgreSQL instance. Never leave one service using the new database
while the other crosses the network to the old database.

After writes resume on PostgreSQL 17, the old Supabase database is stale and
is not an automatic rollback target. Any later rollback requires a controlled
restore/reconciliation decision; it cannot safely be achieved by changing one
URL back.

## Backup and recovery

The existing `ops/backup-production.sh`, restore, freshness, checksum, and
retention tooling remains the operational foundation. Its age encryption,
SHA-256 sidecars, two-pass upload snapshot, `flock`, destructive restore
confirmations, and freshness checks are preserved.

The current off-site destination is **already non-Supabase**. The configured
rclone remote is Google Drive (`type = drive`), writing to
`quest-esports-v2/production`, and the daily unit is uploading successfully.
Supabase Storage was never the destination, so "move off Supabase Storage" is
not a reason to change anything and must not be used to justify this phase.

The actual reasons to move to an rclone-supported B2, S3, or R2 remote are:

- **No immutability.** Google Drive offers no object lock or write-once
  retention, so anything able to write the backups can also delete them. This
  is the ransomware-resistance property the rest of this section relies on,
  and it is currently absent rather than merely "recommended".
- **Credential fragility.** The remote authenticates with a refreshable OAuth
  token that can be revoked or expire out of band, with failure surfacing only
  through the freshness check.
- **No native checksum/retention semantics** comparable to object storage.

Supabase Storage remains excluded on its own merits: the 1 GB free limit, the
existing egress overage, and the undesirable coupling of disaster recovery to
the provider being migrated away from.

No new backup implementation is required merely to change the remote; the
protected `BACKUP_RCLONE_REMOTE` and `RCLONE_CONFIG` values change after the
new remote is created and tested.

The existing destination remains configured until all of the following are
true:

1. The new remote receives encrypted archives and matching checksums.
2. Remote verification and freshness checks pass.
3. A complete archive is downloaded and restored in an isolated PostgreSQL 17
   environment, including both schemas and upload roots.
4. The restore is inspected and documented.

Daily backups remain scheduled by systemd. Existing retention and pruning
guards remain confirmation-gated. The private `age` identity stays in at least
two controlled offline copies and is never permanently mounted on the VPS.
The backup credential, encryption recipient, and remote configuration are
runtime secrets. A second independent or object-locked destination remains
recommended for ransomware resistance.

## Mandatory PostgreSQL 17 rehearsal

Before production cutover, the source PostgreSQL major version must be
recorded explicitly. A full production-shaped archive must be restored with
`ops/restore-production-backup.sh` against a PostgreSQL 17 instance, not merely
checked with `pg_restore --list`.

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

### Stray cluster removal

The host also runs an empty PostgreSQL 16 cluster on `127.0.0.1:5432`, and has
a `postgresql-18` server package installed with no cluster. Neither is used by
Quest or VALORANT; both currently point at Supabase. The containerised
PostgreSQL 17 publishes no host port, so there is no port conflict, but an
idle local server listening on the conventional port is an invitation to
restore into the wrong database during a maintenance window. Both must be
stopped, disabled, and removed before cutover, and their absence confirmed as
a Phase 0 checklist item.

The rehearsal must cover:

- `public` and `valorant` schema restoration;
- role/grant/bootstrap recreation;
- public and private upload trees;
- Quest readiness and representative reads;
- VALORANT API, updater, and bot connectivity;
- checksum/decryption verification;
- a documented time-to-restore and observed gaps.

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
- The backend must bind `127.0.0.1`, not `0.0.0.0`. It currently listens on
  all interfaces and is protected by the host firewall alone; the loopback
  bind in the target topology is a deliberate tightening and must not be
  reverted in the name of preserving existing behaviour.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` appear in both the application
  environment and `/etc/quest-esports-backup.env`. Both must resolve to the
  same host bind mounts after containerisation. If the application writes to a
  container path while the backup unit reads the host path, backups continue to
  succeed while archiving an empty directory, and the loss is discovered only
  at restore.
- `TRUST_PROXY`, HTTPS origins, upload limits, OAuth callbacks, payment
  callbacks, and private-upload isolation retain their existing production
  invariants.
- PostgreSQL major-version upgrades are separate maintenance work from app
  releases.
- VALORANT has an independent image, release cadence, and migration ownership,
  but its database URL change is coordinated with Quest's shared-database
  cutover.
- The existing local Compose stack keeps its local database override,
  platform-specific Prisma generated volume, and `dev:container` entrypoint.

## Phased implementation and migration

### Phase 0 — Preconditions and rehearsal

- Verify Supabase Egress breakdown and source database availability.
- Confirm VPS CPU, RAM, disk, firewall, DNS, IPv4/IPv6, and TLS prerequisites.
- Record source PostgreSQL version and current schema/role state.
- Create the new rclone remote and dual-write/test it without removing the
  existing Google Drive destination.
- Build production images and run the complete PostgreSQL 17 restore rehearsal.

The following were verified against the running host on 2026-08-27 and are
**not** met. Each is a prerequisite, not an implementation detail:

- **Privileged actor.** `deploy` cannot perform host bootstrap. Confirm who
  does, per the *Privileged access* decision above.
- **Docker is not installed.** The host has no `docker` binary. Installation is
  root-only bootstrap work.
- **No swap is configured.** The host has 7.8 GiB RAM and zero swap, and is
  about to gain a Next.js runtime and PostgreSQL alongside the existing
  backend and three VALORANT units. Configure swap and set explicit PostgreSQL
  memory parameters rather than relying on container defaults sized for a
  dedicated database host.
- **IPv6 is only half-configured.** The host holds a global IPv6 address, but
  the `quest-api` server block listens on `listen 443 ssl;` only, with no
  `listen [::]:443`. Either complete IPv6 ingress or remove it from the
  prerequisite list; it must not remain listed as satisfied when it is not.
- **Stray PostgreSQL servers.** Remove the idle local PostgreSQL 16 cluster and
  the clusterless `postgresql-18` package, per *Stray cluster removal* above.

### Phase 1 — Production image and Compose foundation

- Add production frontend/backend/migrator images and `.dockerignore` rules.
- Add production Compose configuration with bind mounts, internal networks,
  non-public database ports, runtime secrets, and health checks.
- Exercise the stack against a disposable PostgreSQL 17 database.

### Phase 2 — CI release and VPS deployment automation

- Build, test, scan, sign, and publish images from the source commit.
- Publish an exact-digest release bundle.
- Implement the lock, backup gate, explicit migration, readiness checks,
  smoke checks, active-release switch, and rollback flow.
- Keep the existing PM2/Vercel deployment available until observation and
  rollback evidence are complete.

### Phase 3 — Coordinated service/database cutover

- Cut over Quest and the three VALORANT units in one maintenance window.
- Restore both schemas and uploads to PostgreSQL 17.
- Update both repositories' database configuration together.
- Validate all services before admitting writes.

### Phase 4 — Backup destination transition

- Run daily encrypted backups to the new object-locked remote in parallel with
  the existing Google Drive destination.
- Complete an isolated restore drill and verify freshness/retention.
- Retire the Google Drive destination only after owner approval and retained
  recovery evidence.

## Acceptance criteria

- Frontend and backend run from immutable non-development images on the VPS.
- A commit-digest release can be deployed without building on the VPS.
- A failed health check restores the previous application release without
  pretending a database migration was rolled back.
- Quest and VALORANT both use the same PostgreSQL 17 instance after cutover,
  with `public` and `valorant` restored and correctly scoped.
- A partial service cutover cannot leave the two services split across old and
  new databases.
- The local Compose safeguards remain green and Prisma generated artifacts are
  not hidden by host-platform mounts.
- Daily encrypted archives reach an object-locked rclone remote with matching
  checksums and freshness evidence, and the Google Drive destination is
  retired only after a verified restore from the new remote.
- The release actor's privilege is granted in the form chosen by the
  *Privileged access* decision, and host bootstrap steps are recorded as
  owner-performed runbook actions rather than assumed.
- `pg_dump` and `pg_restore` run from a pinned PostgreSQL 17 client during the
  rehearsal and cutover, and no idle local PostgreSQL server remains listening
  on the host.
- Nginx sets `proxy_buffering off` and read/send timeouts above the 25-second
  heartbeat explicitly, verified by an SSE stream held open past that interval
  without truncation.
- The application and the backup unit resolve `UPLOAD_ROOT` and
  `PRIVATE_UPLOAD_ROOT` to the same host paths, proven by a post-cutover
  archive containing a file written through the running application.
- A full archive has been restored successfully in isolation before cutover.
- Supabase egress has been investigated before implementation/cutover, and
  quota-related 402 responses are not conflated with container failures.
- An Actions outage leaves the current production release running and causes
  no unsupported VPS-side build.
