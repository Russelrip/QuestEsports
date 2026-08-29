# VPS PostgreSQL Migration Design

**Date:** 2026-08-29
**Status:** Draft for review
**Scope:** Move Quest and its VALORANT database integration from Supabase
PostgreSQL to PostgreSQL 17 hosted on the Quest VPS.

## Goal

Make PostgreSQL 17 on the VPS the authoritative production database while
preserving the existing Supabase database as a temporary rollback source. The
migration uses a short, explicitly announced maintenance window and does not
begin a production cutover until restore, security, health, and data-integrity
gates pass.

The migration includes the Quest `public` schema and the sibling VALORANT
`valorant` schema when present. Quest and VALORANT must change database
authority together; neither service may continue writing to Supabase after the
cutover.

## Confirmed decisions

- PostgreSQL on the VPS becomes the production authority.
- The cutover uses a short maintenance window rather than replication or
  dual-write complexity.
- Existing PostgreSQL 16.15 on `127.0.0.1:5432` remains running during
  staging and initial validation.
- PostgreSQL 17 runs alongside it first, using a separate private endpoint,
  initially `127.0.0.1:55432` for host-run tools.
- The existing encrypted backup, rclone verification, upload snapshot, and
  guarded restore system remains the recovery mechanism.
- Supabase remains unchanged as rollback material until the observation period
  completes.
- No public PostgreSQL port is opened.

## Current state and boundaries

The repository-recorded production topology is an Ubuntu VPS backend with
Supabase PostgreSQL in Paris. The current Compose contract already defines a
PostgreSQL service, durable data mount, private networks, TLS mounts, and a
health check, but host bootstrap, production role/TLS provisioning, restore,
authority change, and live cutover are separate gates and have not been
performed by this design.

Relevant boundaries are:

- `backend/prisma/schema.prisma` owns the PostgreSQL datasource and migration
  history.
- `ops/docker/compose.production.yml` owns the immutable production container
  topology and the `quest-postgres` network alias.
- `ops/backup-production.sh` and its delegated scripts own encrypted database
  and upload backups.
- `ops/restore-production-backup.sh` owns confirmation-gated destructive
  restore.
- `docs/production-runbook.md` and
  `docs/backup-and-disaster-recovery.md` remain the operational sources of
  truth.

This work does not expose PostgreSQL to the browser, move uploads into the
database, or make Supabase and the VPS co-authoritative.

## Chosen deployment approach

Use a phased PostgreSQL-only Docker Compose deployment, later consumed by the
full `quest-prod` Compose topology.

### Staging topology

1. Keep native PostgreSQL 16 on `127.0.0.1:5432` untouched.
2. Start the pinned PostgreSQL 17 Compose service with data at:
   `/srv/quest-esports/postgres/17/data`.
3. Attach it to the private `database` and `quest-shared` networks with the
   stable alias `quest-postgres`.
4. During the PM2 transition, publish only
   `127.0.0.1:55432:5432` so host-run Prisma, backup, and validation tools can
   reach it. Do not publish it on an external interface.
5. Once all application and backup clients use the private Compose network,
   remove the host publication.

The image must resolve to the approved PostgreSQL 17 Bookworm digest. The
database directory is a bind mount, never a container-layer or opaque named
volume. PostgreSQL receives explicit conservative memory and connection
settings appropriate for the VPS capacity; it must not starve the application
or the legacy cluster.

### Final topology

- `frontend` reaches only the backend app network.
- `backend` reaches PostgreSQL through `quest-postgres` on the private
  database network.
- VALORANT reaches the same PostgreSQL instance through its private network and
  its own schema/role boundary.
- Nginx exposes HTTP application endpoints only.
- No PostgreSQL address is firewall-exposed.

## PostgreSQL initialization and security

The root-capable bootstrap creates and protects the host paths, TLS material,
database roles, extensions, and initialization scripts. It does not reuse the
legacy PostgreSQL 16 cluster directory.

### TLS and authentication

- Enable server-side TLS with a private CA and SCRAM authentication.
- Require `hostssl` access and explicitly reject non-TLS host connections.
- Use `sslmode=verify-full` and a mounted CA bundle for clients.
- The PostgreSQL certificate covers the stable `quest-postgres` name and the
  temporary loopback validation name/IP used during staging.
- The private key is mounted with ownership and mode accepted by PostgreSQL;
  this must be tested against the official image before cutover.

### Roles

Create separate credentials for:

- `quest_runtime`: long-lived Quest API reads/writes only; no DDL, role
  management, or database ownership.
- `val_runtime`: sibling-service reads/writes only for the `valorant`
  schema and required shared objects.
- `quest_migrator`: one-shot Prisma migration and schema verification role.
- `val_migrator`: one-shot VALORANT migration and schema verification role.
- `quest_backup`: dump-only role with no application write privileges.
- Database owner/admin: bootstrap and recovery only; never placed in the API
  environment.

The service environment must not carry migrator or owner credentials. A release
runner injects the migrator URL only for `prisma migrate deploy` and security
verification, then starts the application with runtime credentials.

The owner-approved runtime authorization model remains behavior-compatible with
the existing Prisma application: application authorization remains in the API,
while each runtime role remains `NOBYPASSRLS` and receives only the required
DML grants and no DDL or role privileges. Explicit per-table RLS policies
provide behavior-compatible access for application tables, while
`_prisma_migrations` remains migrator-only. Runtime roles stay non-owner,
non-superuser, and schema-isolated. The security verifier must assert this
exact model, including revoked public/Data API grants; no runtime role receives
RLS bypass.

## Data migration flow

### Rehearsal

1. Capture a verified encrypted Supabase database archive and upload snapshot.
2. Restore both schemas into disposable PostgreSQL 17 using pinned
   `pg_restore` tooling and `--no-owner --no-acl` where applicable.
3. Bootstrap the target roles, extensions, default privileges, TLS, and
   schema grants.
4. Apply committed Prisma migrations with `prisma migrate deploy`.
5. Run database security/RLS verification, schema checks, row-count checks,
   representative reads and writes, health checks, and upload permission
   checks.
6. Record the time required for archive staging, restore, migration,
   validation, and service restart. The maintenance window is not considered
   proven until this evidence exists.

### Production cutover

1. Confirm owner gates: approved maintenance window, backup destination,
   credential separation, host capacity, disk headroom, TLS material, and
   rollback authority.
2. Place both Quest and VALORANT writers into the documented freeze/read-only
   state.
3. Take a final encrypted database archive and consistent upload snapshot;
   verify checksums, remote capture, and freshness.
4. Restore the final archive into the staged PostgreSQL 17 target.
5. Validate target identity, PostgreSQL major version, schemas, extensions,
   grants, row counts, migration status, and backup target binding.
6. Change both services to the VPS database endpoint and restart them through
   the controlled release path.
7. Require readiness checks and smoke reads from both services before reopening
   writes.
8. Record the cutover timestamp, target identity, archive identifiers, health
   results, and operator approvals.

The cutover stops immediately on any restore, role, TLS, schema, health, or
data-integrity failure. It never silently falls back to a mutable image tag,
wrong database, or wrong PostgreSQL major version.

## Backup and restore

The current age-encrypted, rclone-verified, two-pass backup process remains the
authoritative backup path. It must be adjusted to use pinned PostgreSQL 17
clients and the staged loopback endpoint or a private backup utility on the
Compose network.

- Backups use `quest_backup`, not the database owner or API role.
- Routine backups dump logical database contents and capture uploads; they do
  not copy a live PostgreSQL data directory.
- Restore commands require an explicit disposable/production target identity,
  expected host/port, database name, and PostgreSQL major version.
- Destructive restore remains confirmation-gated and single-transaction where
  supported.
- Daily freshness alarms, off-site verification, retention, and restore-drill
  evidence remain required.
- Raw data-directory snapshots are only a stopped-server recovery fallback,
  never the normal backup.

## Rollback and observation

Before the first VPS write, rollback is straightforward: keep writers frozen,
restore Supabase URLs, restart the previous writer groups, and record the
decision.

After the first VPS write, Supabase is stale. It remains a recovery copy, not
an automatic URL toggle. Returning to Supabase requires stopping writes,
choosing an approved data-loss/reconciliation point, and reconciling or
restoring the VPS changes. The release procedure must make this boundary
visible to the operator.

The observation period monitors:

- application readiness and error rates;
- database connections, locks, latency, and disk growth;
- backup completion, remote verification, and freshness;
- upload visibility and private-file permissions; and
- both Quest and VALORANT service health.

PostgreSQL 16 is retired only after the observation period, a final verified
backup, and explicit owner approval. Cluster-specific systemd commands are
used; broad `postgresql.service` operations are prohibited while both majors
coexist.

## Validation gates

Implementation is complete only when all gates have evidence:

1. Compose configuration validates with the exact PostgreSQL 17 image digest,
   durable bind mount, private networks, health check, and no public database
   publication.
2. Host bootstrap validates directory ownership/modes, TLS key permissions,
   role separation, disk capacity, and PG16 coexistence.
3. Disposable restore succeeds for the database and uploads.
4. Prisma migrations, security/RLS checks, extensions, grants, and representative
   runtime operations pass against PostgreSQL 17.
5. Backup and restore scripts target the intended PostgreSQL 17 endpoint and
   use pinned clients.
6. Quest and VALORANT can be frozen and released together.
7. Final cutover passes readiness, smoke, data-integrity, and backup-evidence
   checks within the rehearsed maintenance window.
8. Rollback and post-first-write recovery decisions are recorded and owned.

No gate authorizes a production change by itself. Root bootstrap, service
restart, destructive restore, database URL change, and writer admission each
remain explicit owner-approved operations.

## Non-goals

- No production VPS mutation as part of writing or reviewing this design.
- No Supabase deletion before the observation and recovery gates pass.
- No logical replication, dual-write, or automatic cross-database failover.
- No public PostgreSQL access.
- No schema redesign unrelated to portability, roles, migrations, or recovery.
