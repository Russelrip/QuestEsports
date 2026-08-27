# VPS Migration Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Quest production from PM2/Vercel/Supabase to a verified, rollback-safe Docker Compose deployment on `api.questesports.lk`, with PostgreSQL 17 restored from the current Supabase database.

**Architecture:** Supabase remains the source of truth until the final maintenance-window commit. A one-time cutover path will freeze current Quest and VALORANT writers, create and verify the final encrypted archive, restore both schemas into a private PostgreSQL 17 Compose service, run migrations, start Quest and VALORANT candidates frozen, and admit writers only after all gates pass. A separate steady-state release path will handle later digest-only deployments.

**Tech Stack:** Docker Compose, PostgreSQL 17 Bookworm, Node 24, Python/uv for the VALORANT service, Nginx, systemd, GitHub Actions, GHCR, Cosign, age, OpenSSL, and the existing Quest Express/Next.js applications.

**Spec:** `docs/superpowers/specs/2026-08-27-containerised-vps-deployment-design.md`

## Global Constraints

- Never print or commit database URLs, passwords, private keys, tokens, certificates, or populated environment files.
- Do not change public traffic, stop writers, restore data, or enable new writers until the explicit final cutover gate.
- Use PostgreSQL 17 clients for the target restore and record the source PostgreSQL major before migration.
- Deploy only exact image digests; mutable tags are invalid release inputs.
- Keep `quest-prod`, `valorant-prod`, and `quest-shared` as fixed identities.
- Keep PostgreSQL and application ports unpublished except loopback Nginx upstreams; 5432 must never be public.
- Preserve the current PM2, PostgreSQL 16, VALORANT systemd, and Vercel paths for rollback until post-cutover observation completes.
- Every remote command must be auditable, read-only unless the current phase explicitly permits the mutation.

---

## Phase 1: Repository and Release-Path Hardening

### Task 1: Correct immutable image references and first-cutover boundaries

**Files:**
- Modify: `.github/workflows/build-container-images.yml:194-203`
- Modify: `ops/deploy/release.sh:207-299,345-423`
- Create: `ops/deploy/cutover.sh`
- Create: `ops/deploy/validate-host.sh`
- Test: `ops/tests/deploy-release.test.sh`

**Interfaces:**
- `cutover.sh` consumes a full commit SHA, signed release manifest, root-owned release environment, current Supabase environment, and host command wrappers; it produces a frozen PostgreSQL 17 target and an explicit pre-commit or post-commit result.
- `release.sh` consumes only an existing immutable release and remains unavailable for first cutover.
- `validate-host.sh` emits only safe status tokens and validates Docker, directories, certificates, locks, aliases, image signatures, and service ownership.

- [ ] Write failing tests for the preserved `sha256:` PostgreSQL manifest, first-cutover acceptance, migration-before-start ordering, and writer-admission rollback boundary.
- [ ] Run `bash ops/tests/deploy-release.test.sh` and confirm each new assertion fails against the current implementation.
- [ ] Change the workflow to emit `postgres:17-bookworm@sha256:<64 lowercase hex>` and validate the same reference at the host boundary.
- [ ] Implement `cutover.sh` so it freezes current writers before the final archive, restores PostgreSQL 17 and runs migrations before candidate startup, and records writer-admission start before any enable command.
- [ ] Keep `release.sh` strict for steady-state releases and share only small validation helpers with `cutover.sh`.
- [ ] Run the focused deployment regression suite and Bash syntax checks.
- [ ] Commit as `fix: separate first production cutover from steady releases`.

### Task 2: Harden Compose topology and host-side artifact trust

**Files:**
- Modify: `ops/docker/compose.production.yml:10-134`
- Modify: `ops/deploy/verify-release.sh:1-180`
- Modify: `ops/deploy/release.env.example:1-80`
- Create: `ops/docker/nginx/quest.conf`
- Test: `backend/tests/production-container-config.test.js`
- Test: `ops/tests/deploy-release.test.sh`

**Interfaces:**
- Compose receives digest-pinned Quest, migrator, PostgreSQL, and VALORANT images through the release manifest and root-owned environment files.
- Host verification consumes the same manifest and verifies Cosign identity plus exact approved image references before Compose is invoked.
- Nginx proxies public API/frontend traffic to loopback Compose ports and preserves SSE buffering/timeouts.

- [ ] Write failing assertions for mandatory backend `env_file`, frontend outbound access/cache behavior, immutable base-image references, host-side Cosign verification, and container-bound VALORANT health checks.
- [ ] Run the focused tests and confirm the assertions fail for the current topology.
- [ ] Add the smallest Compose/Nginx changes that make the runtime topology internally reachable and externally restricted.
- [ ] Replace host-side `valorant-platform` checks with checks executed from the Quest network boundary.
- [ ] Add exact image identity and signature verification to the host path; reject manifests writable by `deploy`.
- [ ] Run all production-container and deployment fixture tests.
- [ ] Commit as `fix: enforce immutable container runtime topology`.

## Phase 2: VALORANT Container Artifact

### Task 3: Package the existing VALORANT service for the shared network

**Files:**
- Source: `/var/www/valorant-platform-backend` on `api.questesports.lk` (read-only inspection first)
- Create in the VALORANT repository: `Dockerfile`
- Create in the VALORANT repository: `.dockerignore`
- Create in the VALORANT repository: `compose.production.yml`
- Modify in Quest: `ops/docker/compose.production.yml:82-125`
- Test: VALORANT repository container smoke tests and Quest deployment fixtures

**Interfaces:**
- The VALORANT image exposes HTTPS on port 8000, uses the existing runtime environment only through host secret mounts, and joins `valorant-prod` and `quest-shared` with aliases `valorant-platform`, `valorant-updater`, `valorant-discord-bot`, and `valorant-name-audit`.
- The Quest backend reaches `https://valorant-platform:8000` using the private CA and receives the exact health contract `status=ok` and `db=up`.

- [ ] Record the exact current VALORANT repository commit, Python version, dependency lock, health route, database URL contract, and worker commands without exposing secrets.
- [ ] Write a failing image-build/smoke test for non-root runtime, TLS SAN `valorant-platform`, health response, and required shared-network aliases.
- [ ] Add the minimal Dockerfile and Compose service definitions using a pinned Python base and no source checkout mounted into production.
- [ ] Build the image locally, run the service against disposable dependencies, and verify health/TLS/worker startup.
- [ ] Publish the image to the approved GHCR location and record its exact digest and signature evidence.
- [ ] Run Quest-side network smoke tests against the image digest.
- [ ] Commit the sibling repository changes separately and update the Quest release-manifest input.

## Phase 3: Non-Disruptive VPS Bootstrap

### Task 4: Provision Docker and root-owned runtime paths

**Files:**
- Create: `ops/bootstrap/bootstrap-vps.sh`
- Create: `ops/bootstrap/quest-sudoers`
- Create: `ops/bootstrap/systemd/quest-esports-release-lock.tmpfiles`
- Create: `ops/bootstrap/systemd/quest-esports-backup.service`
- Create: `ops/bootstrap/systemd/quest-esports-backup.timer`
- Create: `ops/bootstrap/systemd/quest-esports-backup-freshness.service`
- Create: `ops/bootstrap/systemd/quest-esports-backup-freshness.timer`
- Test: `ops/tests/bootstrap-vps.test.sh`

**Interfaces:**
- The bootstrap script runs once as root and creates `/opt/quest-esports`, `/etc/quest-esports`, `/srv/quest-esports`, the canonical lock, root-owned secrets/certificate paths, and the external `quest-shared` network.
- It installs Docker/Compose, pinned PostgreSQL 17 client tooling, root-owned wrappers, Nginx configuration, and narrow release permissions without stopping current application services.

- [ ] Write failing fixture tests for root ownership, modes, idempotence, Docker version floor, lock creation, and no public database port.
- [ ] Run the fixture tests against the absent bootstrap implementation and confirm the expected failures.
- [ ] Implement bootstrap with explicit package versions and idempotent directory/service checks.
- [ ] Run the script first in a disposable VM/container fixture, then run the read-only VPS preflight again.
- [ ] On the VPS, install Docker and Compose, create paths, install wrappers/certificates/secrets from approved inputs, and create `quest-shared` without stopping PM2 or VALORANT.
- [ ] Verify `docker version`, storage/inodes, RAM/swap decision, Nginx syntax, certificate SANs, and root ownership remotely.
- [ ] Commit repository bootstrap artifacts as `feat: add immutable VPS host bootstrap`.

## Phase 4: Disposable Full Rehearsal

### Task 5: Rehearse two-schema restore and candidate services

**Files:**
- Modify: `ops/rehearsal/postgres17-restore-rehearsal.sh`
- Modify: `ops/rehearsal/verify-rehearsal-evidence.sh`
- Modify: `ops/tests/postgres17-rehearsal.test.sh`
- Create: `ops/rehearsal/valorant-container-rehearsal.sh`

**Interfaces:**
- The rehearsal consumes a current encrypted archive containing `public`, `valorant`, and both upload roots plus exact source-version evidence.
- It produces signed observations covering restore, migrations, ownership, grants, default ACLs, RLS, TLS, service health, frozen writes, failure injection, and measured RTO.

- [ ] Obtain or create a current disposable two-schema archive from the approved Supabase source without touching production uploads or writers.
- [ ] Run the PostgreSQL 17 restore and VALORANT/Quest container rehearsal with all writers frozen.
- [ ] Run checksum, decryption, wrong-CA, network, health, callback, and mutation failure injections.
- [ ] Verify evidence signatures and archive/observation bindings independently.
- [ ] Stop and remove all disposable containers, volumes, keys, and plaintext trees while retaining only approved synthetic evidence.
- [ ] Commit updated rehearsal support as `test: rehearse complete container cutover`.

## Phase 5: Production Maintenance-Window Migration

### Task 6: Create the final Supabase archive after writer freeze

**Files:**
- Use: `/var/www/QuestEsports/backend/.env` on the VPS through the project dotenv parser
- Use: `ops/backup-production-multi-remote.sh`
- Use: `ops/restore-production-backup.sh`
- Use: `ops/deploy/cutover.sh`

**Interfaces:**
- The cutover consumes the existing Supabase database URL, approved age/rclone credentials, current upload roots, and owner-approved maintenance window.
- It produces an encrypted final archive, checksum, source-version record, and an immutable “writers stopped” observation.

- [ ] Acquire the canonical release/backup lock.
- [ ] Enable the existing application freeze and verify HTTP health remains available while writes reject.
- [ ] Stop PM2 and the VALORANT runtime, updater, bot, name-audit, callbacks, and writer timers; verify no writer process remains.
- [ ] Create the final encrypted archive and upload/verify every required remote copy.
- [ ] Record source PostgreSQL major, archive scope, checksum, and freeze timestamps without printing credentials.
- [ ] Abort and restore the prior services if any pre-commit gate fails.

### Task 7: Restore and validate PostgreSQL 17 before candidate startup

**Files:**
- Use: `ops/deploy/cutover.sh`
- Use: `ops/docker/postgres/init/001-bootstrap-roles.sql`
- Use: `ops/rehearsal/verify-rehearsal-evidence.sh`

**Interfaces:**
- PostgreSQL 17 runs on the private Compose database network with no host-published port.
- Quest and VALORANT migrators run to completion before runtime containers start.

- [ ] Initialize the PostgreSQL 17 target with root-owned credentials, CA, server certificate, and durable data path.
- [ ] Restore the final archive with pinned PostgreSQL 17 `pg_restore` and apply canonical ownership/security normalization.
- [ ] Run Quest and VALORANT migrations, then verify both migration ledgers have no pending entries.
- [ ] Verify schema/table/object counts, owners, role membership, grants, default ACLs, RLS, extensions, and upload checksums against rehearsal evidence.
- [ ] Start candidate Compose projects in frozen/read-only mode and run all liveness/readiness/TLS/health checks from the correct network boundaries.
- [ ] Keep old services stopped but unmasked until the commit decision; on any failure, isolate the target and restore the old services against Supabase.

## Phase 6: Commit and Public Cutover

### Task 8: Admit writers and switch public ingress

**Files:**
- Use: `ops/deploy/cutover.sh`
- Use: `ops/docker/nginx/quest.conf`
- Use: `ops/deploy/verify-release.sh`

**Interfaces:**
- Writer admission is a durable post-commit boundary. After admission begins, rollback never redirects to Supabase.
- Public verification covers API health, frontend health, sitemap, robots, SSE heartbeat, controlled writes, uploads, and absence of Supabase connections.

- [ ] Record `writer_admission_starting` before enabling either writer group.
- [ ] Enable Quest and VALORANT writers and require independent success observations for both.
- [ ] Mask the old VALORANT units and disable PM2 boot only after successful admission; preserve rollback artifacts.
- [ ] Reload Nginx only after Compose readiness and route checks pass; keep 3000/5001 loopback-only.
- [ ] Verify public routes, SSE, representative reads/writes, uploads, backups, and database authority.
- [ ] Observe the new stack without pruning old releases or Vercel until the documented rollback window closes.

### Task 9: Final verification and operational handoff

**Files:**
- Modify: `docs/production-runbook.md`
- Modify: `docs/backup-and-disaster-recovery.md`
- Modify: `ops/README.md`
- Create: `docs/production-cutover-record-2026-08-27.md`

- [ ] Record exact commit/image digests, migration timestamps, source/target versions, archive checksums, health results, RTO/RPO, and operator approvals without secret values.
- [ ] Run post-cutover backup/freshness verification and confirm both remote copies are current.
- [ ] Confirm rollback commands are executable and old Vercel/PM2/VALORANT paths remain available.
- [ ] Run the final repository test, lint, Compose, deployment, rehearsal, and shell syntax suites.
- [ ] Commit the operational record as `docs: record container cutover evidence`.
