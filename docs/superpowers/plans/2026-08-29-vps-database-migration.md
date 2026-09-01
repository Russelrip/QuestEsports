# VPS PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL 17 on the Quest VPS the authoritative database for Quest and VALORANT through a rehearsed, short-maintenance-window migration from Supabase.

**Architecture:** Extend the existing immutable `quest-prod` Compose database service with a staged loopback-only endpoint, durable host storage, TLS, separated roles, and explicit runtime RLS policies. Reuse the encrypted two-schema backup/restore system, validate the target in a disposable rehearsal, then cut over Quest and VALORANT together while retaining Supabase as a temporary recovery copy.

**Tech Stack:** Docker Compose, PostgreSQL 17 Bookworm, Prisma 6, Bash, Node.js test runner, GitHub Actions, age encryption, rclone, Nginx, systemd, and PM2 during the transition.

**Spec:** `docs/superpowers/specs/2026-08-29-vps-database-migration-design.md`

## Execution reconciliation (2026-08-31)

The database cutover completed on 2026-08-31 ahead of the remaining Compose
adoption work. Quest and VALORANT currently use PostgreSQL 17.11 in VPS
container `quest-postgres` at `127.0.0.1:5433`; Supabase is intact but stale and
is not a rollback target. No rehearsal was performed, and the rehearsal gate
cannot be satisfied retroactively.

The current PostgreSQL container is ad hoc rather than Compose-managed. Missing
TLS material blocks both Compose adoption and the real backup pipeline; the
scheduled backup has failed since 2026-08-30 04:20 and the interim
`quest-pg17-interim-backup.{service,timer}` unit covers the gap. Host bootstrap,
TLS/backup provisioning, and remediation of unrestricted deploy-root access and
two GitHub Actions keys remain operator gates. External PostgreSQL/VALORANT
Cosign signer settings are not required. This reconciliation records state and
constraints only; it does not invent live verification, rehearsal evidence, or
owner approval.

## Global Constraints

- PostgreSQL 17 image: `postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`.
- Existing PostgreSQL 16.15 remains on `127.0.0.1:5432` until the observation gate passes.
- Staged PostgreSQL 17 host endpoint is loopback-only `127.0.0.1:55432`; no external PostgreSQL firewall exposure.
- Durable database path is `/srv/quest-esports/postgres/17/data`.
- Database clients use TLS with `sslmode=verify-full`, a private CA, and a certificate SAN matching the endpoint.
- Runtime roles remain `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT` and receive only their schema/object grants plus explicit runtime policies.
- `public` and `valorant` are migrated and cut over together when the VALORANT schema exists.
- No password, private key, database URL, or production archive is committed.
- CI’s PostgreSQL 16 fixture is preserved; it is not the production database contract.
- No production VPS mutation occurs until every preceding rehearsal and owner gate passes.

## File and responsibility map

- `ops/docker/compose.production.yml` — final immutable `quest-prod` topology and private PostgreSQL service.
- `ops/docker/compose.postgres-staging.yml` — temporary PostgreSQL-only overlay exposing only loopback `55432` during PM2/host-tool staging.
- `ops/docker/postgres/init/001-bootstrap-roles.sql` — role, schema, ownership, grants, default privileges, and RLS bootstrap.
- `ops/docker/postgres/healthcheck.sh` — live TLS/SAN/`pg_isready` health contract.
- `ops/docker/quest.production.env.example` — secret-managed runtime URL and durable-root contract.
- `ops/deploy/validate-host.sh` — root-owned host/artifact trust boundary and database target checks.
- `ops/deploy/release.env.example` — root wrapper commands, approved image references, target identity, and owner approvals.
- `ops/deploy/cutover.sh` — first Supabase-to-VPS authority transition.
- `ops/deploy/release.sh` — steady-state immutable release path after cutover.
- `ops/deploy/rollback.sh` — pre-writer and post-writer recovery boundaries.
- `ops/backup-production-multi-remote.sh` — encrypted database/upload backup and remote verification implementation.
- `ops/restore-production-backup.sh` — confirmation-gated destructive restore.
- `ops/rehearsal/postgres17-restore-rehearsal.sh` — disposable PostgreSQL 17 restore and connection-binding proof.
- `ops/rehearsal/rehearsal-contract.sh` and `ops/rehearsal/verify-rehearsal-evidence.sh` — disposable-target and evidence contracts.
- `backend/prisma/migrations/20260829120000_add_quest_runtime_rls_policies/migration.sql` — explicit runtime policies for Quest `public` tables.
- `backend/scripts/verify-database-security.js` — RLS, policy, role, and Data API-grant verification.
- `backend/tests/production-container-config.test.js` — immutable Compose, TLS, role, RLS, and secret-boundary contracts.
- `ops/tests/deploy-release.test.sh`, `ops/tests/postgres17-rehearsal.test.sh`, and `ops/tests/restore-production-backup.test.sh` — shell contract tests.
- `docs/production-runbook.md`, `docs/setup-and-deployment.md`, `docs/backup-and-disaster-recovery.md`, and `docs/ci-cd.md` — operational and release procedures.

---

### Task 1: Add the staged PostgreSQL Compose contract

**Files:**
- Create: `ops/docker/compose.postgres-staging.yml`
- Modify: `ops/docker/compose.production.yml:89-132`
- Modify: `ops/docker/quest.production.env.example:20-26,58-75`
- Modify: `ops/docker/postgres/README.md:1-120`
- Test: `backend/tests/production-container-config.test.js`

**Interfaces:**
- Consumes: `POSTGRES_IMAGE`, `/srv/quest-esports/postgres/17/data`, the existing private CA mounts, and the `quest-postgres` network alias.
- Produces: a final Compose file with no PostgreSQL host publication and a staging overlay that maps exactly `127.0.0.1:${POSTGRES_STAGING_HOST_PORT:-55432}:5432`.

- [ ] **Step 1: Add failing Compose contract assertions.**

Add tests that render the base file after replacing required image variables with full digest fixtures and assert:

```js
assert.match(productionCompose, /name:\s+quest-prod/);
assert.match(productionCompose, /postgres:\s*\n(?:.|\n)*image:\s*\$\{POSTGRES_IMAGE/);
assert.doesNotMatch(productionCompose, /postgres:[\s\S]*?ports:/);
assert.match(stagingCompose, /127\.0\.0\.1:\$\{POSTGRES_STAGING_HOST_PORT:-55432\}:5432/);
assert.match(stagingCompose, /services:\s*\n\s+postgres:/);
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run from `backend/`:

```bash
node --test tests/production-container-config.test.js
```

Expected: FAIL because the staging overlay does not exist and the base/staging port assertions are not implemented.

- [ ] **Step 3: Implement the overlay and final-topology comments.**

Create the staging overlay:

```yaml
services:
  postgres:
    ports:
      - "127.0.0.1:${POSTGRES_STAGING_HOST_PORT:-55432}:5432"
```

Keep the base PostgreSQL service private, retain the durable bind mount and healthcheck, and document that the overlay is used only while PM2 or host-run backup tools need access.

- [ ] **Step 4: Run focused tests and Compose config validation.**

Create a disposable Compose variable file containing only fake immutable digest
values:

```bash
COMPOSE_ENV=/tmp/quest-postgres-compose.env
cat > "$COMPOSE_ENV" <<'EOF'
QUEST_FRONTEND_IMAGE=ghcr.io/questesports/quest-frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
QUEST_BACKEND_IMAGE=ghcr.io/questesports/quest-backend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
QUEST_MIGRATOR_IMAGE=ghcr.io/questesports/quest-migrator@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
POSTGRES_IMAGE=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
VALORANT_IMAGE=ghcr.io/valorant/valorant-platform@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
EOF
```

Run:

```bash
node --test tests/production-container-config.test.js
docker compose --env-file "$COMPOSE_ENV" -f ops/docker/compose.production.yml config
docker compose --env-file "$COMPOSE_ENV" -f ops/docker/compose.production.yml -f ops/docker/compose.postgres-staging.yml config
```

Expected: the Node contract passes; the base config contains no PostgreSQL host port; the staged config contains only the loopback `55432` mapping.

- [ ] **Step 5: Commit the independently reviewable topology change.**

```bash
git add ops/docker/compose.production.yml ops/docker/compose.postgres-staging.yml ops/docker/quest.production.env.example ops/docker/postgres/README.md backend/tests/production-container-config.test.js
git commit -m "feat: add staged VPS postgres compose contract"
```

### Task 2: Make runtime RLS and role security portable

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-vps-database-migration-design.md`
- Create: `backend/prisma/migrations/20260829120000_add_quest_runtime_rls_policies/migration.sql`
- Modify: `ops/docker/postgres/init/001-bootstrap-roles.sql:37-183`
- Modify: `backend/scripts/verify-database-security.js:3-70`
- Modify: `backend/tests/production-container-config.test.js`
- Test: `backend/tests/production-container-config.test.js`

**Interfaces:**
- Consumes: `quest_migrator`, `quest_runtime`, the Quest `public` schema, and Prisma migration execution.
- Produces: `NOBYPASSRLS` runtime roles with explicit per-table `FOR ALL ... USING (true) WITH CHECK (true)` policies, no public/Data API grants, and a verifier that fails on missing policies or cross-schema grants.

- [ ] **Step 1: Add failing policy and role assertions.**

Assert that the bootstrap contains all four role attributes and that the security verifier queries runtime policy coverage. Add a database fixture test that expects `_prisma_migrations` to remain migrator-only and an application table to expose the `quest_runtime` policy.

- [ ] **Step 2: Run the focused security tests and verify failure.**

Run:

```bash
node --test tests/production-container-config.test.js
```

Expected: FAIL until the Quest policy migration and verifier checks exist.

- [ ] **Step 3: Add the Quest policy migration.**

The migration must grant runtime DML/sequence access and create or replace a policy for every `public` table except `_prisma_migrations`. Use an idempotent PL/pgSQL loop and `format('%I', ...)`; do not embed table names or passwords as unquoted SQL. Keep the existing RLS enablement and Data API revocations.

- [ ] **Step 4: Preserve non-bypass role attributes in bootstrap.**

Keep these exact attributes for `quest_runtime`, `val_runtime`, `quest_migrator`, and `val_migrator`:

```sql
LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
```

Do not add passwords to SQL. Keep schema ownership with `quest_migrator`/`val_migrator`, keep runtime cross-schema revokes, and keep default privileges for future tables/sequences.

- [ ] **Step 5: Extend security verification.**

Have `verify-database-security.js` fail if any public application table lacks the expected `quest_runtime` policy, if `_prisma_migrations` has a runtime policy, if runtime roles have `BYPASSRLS`, or if `PUBLIC`, `anon`, `authenticated`, or `service_role` retains table privileges. Verify that `quest_runtime` cannot access `valorant` and `val_runtime` cannot access `public`.

- [ ] **Step 6: Run the policy, migration, and full backend checks.**

Run against a disposable PostgreSQL 17 target:

```bash
npm run prisma:migrate:deploy
npm run prisma:security:verify
npm test
```

Expected: migrations apply, security verification passes, runtime positive/negative probes pass, and no existing backend tests regress.

- [ ] **Step 7: Commit the role/RLS portability change.**

```bash
git add backend/prisma/migrations/20260829120000_add_quest_runtime_rls_policies backend/scripts/verify-database-security.js ops/docker/postgres/init/001-bootstrap-roles.sql backend/tests/production-container-config.test.js
git commit -m "feat: enforce VPS postgres runtime RLS policy"
```

### Task 3: Harden host target and release configuration

**Files:**
- Modify: `ops/deploy/release.env.example:1-125`
- Modify: `ops/deploy/validate-host.sh:47-164`
- Modify: `ops/deploy/release.sh`
- Modify: `ops/deploy/cutover.sh:41-124`
- Modify: `ops/tests/deploy-release.test.sh`
- Operate: `/usr/local/sbin/quest-release-postgres-target` (root-owned target sentinel installed by host bootstrap)
- Test: `ops/tests/deploy-release.test.sh`

**Interfaces:**
- Consumes: root-owned `/etc/quest-esports/release.env`, approved manifest, PostgreSQL certificate/key, and host bootstrap paths.
- Produces: fail-closed target checks for database host, loopback port, database name, PostgreSQL major version, image digest, and durable data path.

- [ ] **Step 1: Add failing fixture cases for unsafe database targets.**

Extend the fixture suite with cases for an external PostgreSQL bind, port `5432` collision, missing `/srv/quest-esports/postgres/17/data`, mismatched PostgreSQL digest, missing TLS key, and a target URL whose database name is not `quest`.

- [ ] **Step 2: Run the deployment contract suite and verify the cases fail.**

Run:

```bash
bash ops/tests/deploy-release.test.sh
```

Expected: the new cases fail because the release environment does not yet define or validate the target identity.

- [ ] **Step 3: Add explicit release settings.**

Document these settings in `release.env.example` without credential values:

```text
POSTGRES_TARGET_HOST=127.0.0.1
POSTGRES_TARGET_PORT=55432
POSTGRES_TARGET_DATABASE=quest
POSTGRES_TARGET_MAJOR=17
POSTGRES_TARGET_DATA_ROOT=/srv/quest-esports/postgres/17/data
POSTGRES_TARGET_SENTINEL_COMMAND=/usr/local/sbin/quest-release-postgres-target
```

The host bootstrap installs the target sentinel as a root-owned wrapper. It
returns one non-secret structured line containing target kind, database, host,
port, major version, and data-root identity; it never prints a URL, password,
certificate, or command output. The repository contract tests use a fixture
sentinel with the same output grammar.

- [ ] **Step 4: Enforce the target in host validation and cutover.**

Reject non-loopback target hosts, port `5432`, non-17 PostgreSQL targets, symlinked data roots, missing TLS files, and any manifest whose PostgreSQL image is not the exact approved digest. Validate the sentinel before restore and before URL switching. Never print URLs or passwords.

- [ ] **Step 5: Run all shell contract tests.**

Run:

```bash
bash ops/tests/deploy-release.test.sh
bash -n ops/deploy/validate-host.sh ops/deploy/release.sh ops/deploy/cutover.sh
```

Expected: all fixture scenarios pass and every script parses successfully.

- [ ] **Step 6: Commit the host trust-boundary change.**

```bash
git add ops/deploy/release.env.example ops/deploy/validate-host.sh ops/deploy/release.sh ops/deploy/cutover.sh ops/tests/deploy-release.test.sh
git commit -m "feat: bind release checks to VPS postgres target"
```

### Task 4: Make backup and restore explicitly PostgreSQL 17 target-aware

**Files:**
- Modify: `ops/backup-production-multi-remote.sh`
- Modify: `ops/restore-production-backup.sh`
- Modify: `ops/quest-esports-recovery.env.example`
- Modify: `ops/tests/media-backup-contract.test.sh`
- Modify: `ops/tests/restore-production-backup.test.sh`
- Test: `ops/tests/media-backup-contract.test.sh` and `ops/tests/restore-production-backup.test.sh`

**Interfaces:**
- Consumes: `quest_backup` credentials, PostgreSQL 17 client paths, the `public`/`valorant` archive scope, and target sentinel.
- Produces: backups and restores that cannot silently target Supabase, PostgreSQL 16, a production URL during rehearsal, or an unverified host/port.

- [ ] **Step 1: Add failing target-binding fixtures.**

Cover wrong host, wrong port, wrong major version, wrong database name, missing `valorant` schema, mutable PostgreSQL client discovery, and a restore target that is not marked disposable or production-authorized.

- [ ] **Step 2: Run backup/restore contract tests and verify failure.**

Run:

```bash
bash ops/tests/media-backup-contract.test.sh
bash ops/tests/restore-production-backup.test.sh
```

Expected: the new target-binding cases fail before implementation.

- [ ] **Step 3: Pin client binaries and preserve two-schema scope.**

Require `psql`, `pg_dump`, and `pg_restore` major 17 by absolute executable path. Keep one custom-format archive containing `public` and `valorant` when the latter exists, with `--no-owner --no-acl`, and keep upload snapshot/checksum/rclone verification unchanged.

- [ ] **Step 4: Add restore target identity checks.**

Before any destructive restore, query the expected target for database name, server major version, TLS state, target sentinel, and loopback/Compose identity. Refuse if any value is inconsistent. Keep confirmation tokens and failure cleanup behavior intact.

- [ ] **Step 5: Run shell syntax and contract tests.**

```bash
bash -n ops/backup-production-multi-remote.sh ops/restore-production-backup.sh
bash ops/tests/media-backup-contract.test.sh
bash ops/tests/restore-production-backup.test.sh
```

Expected: all backup/restore fixtures pass and no secret-bearing output is emitted.

- [ ] **Step 6: Commit the backup/restore change.**

```bash
git add ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/quest-esports-recovery.env.example ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh
git commit -m "feat: bind postgres backups to verified targets"
```

### Task 5: Extend the disposable PostgreSQL 17 rehearsal

**Files:**
- Modify: `ops/rehearsal/postgres17-restore-rehearsal.sh`
- Modify: `ops/rehearsal/rehearsal-contract.sh`
- Modify: `ops/rehearsal/verify-rehearsal-evidence.sh`
- Modify: `ops/tests/postgres17-rehearsal.test.sh`
- Test: `ops/tests/postgres17-rehearsal.test.sh`

**Interfaces:**
- Consumes: one encrypted production archive, pinned PostgreSQL 17 tools, disposable target sentinel, isolated upload roots, and private evidence directory.
- Produces: machine-readable evidence proving restore, target connection binding, schemas, extensions, roles, policies, migrations, health, uploads, and cleanup.

- [ ] **Step 1: Add failing rehearsal assertions.**

Require evidence for runtime policy coverage, `NOBYPASSRLS`, both schema owners, exact PostgreSQL 17 client/server versions, target database identity, and a successful runtime read/write probe that cannot reach the other schema.

- [ ] **Step 2: Run the rehearsal contract suite and verify failure.**

```bash
bash ops/tests/postgres17-rehearsal.test.sh
```

Expected: the new evidence assertions fail until the rehearsal emits them.

- [ ] **Step 3: Add target and security probes.**

Use the existing nonce-bound connection session and Docker `pg_stat_activity` comparison. Add queries that record only non-secret values:

```sql
SELECT current_database(), current_setting('server_version_num'), current_setting('ssl');
SELECT rolname, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles
WHERE rolname IN ('quest_runtime','quest_migrator','val_runtime','val_migrator');
```

Record row counts for `public` and `valorant`, policy counts excluding `_prisma_migrations`/`_migration_ledger`, and cross-schema denial results.

- [ ] **Step 4: Run the full disposable rehearsal.**

After the backup verifier identifies the exact archive, set `ARCHIVE` to that
absolute archive path and set `EVIDENCE_DIR` to a new private directory under
the disposable rehearsal root. Set
`REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL` and run:

```bash
bash ops/rehearsal/postgres17-restore-rehearsal.sh "$ARCHIVE"
bash ops/rehearsal/verify-rehearsal-evidence.sh "$EVIDENCE_DIR"
```

Expected: the rehearsal returns success, proves PostgreSQL 17, leaves no temporary upload roots, and emits private evidence with no credentials or URLs.

- [ ] **Step 5: Commit the rehearsal gates.**

```bash
git add ops/rehearsal ops/tests/postgres17-rehearsal.test.sh
git commit -m "test: prove VPS postgres restore and security contract"
```

### Task 6: Implement coordinated first cutover and recovery boundaries

**Files:**
- Modify: `ops/deploy/cutover.sh`
- Modify: `ops/deploy/rollback.sh`
- Modify: `ops/deploy/release.sh`
- Modify: `ops/deploy/release.env.example`
- Modify: `ops/tests/deploy-release.test.sh`
- Test: `ops/tests/deploy-release.test.sh`

**Interfaces:**
- Consumes: verified backup evidence, target sentinel, both Quest/VALORANT writer controls, Supabase env backup, staged Compose projects, and owner approval bound to the release SHA.
- Produces: a fail-closed first-cutover state machine and a post-cutover release path that admits both writers only after readiness and smoke checks.

- [ ] **Step 1: Add failing state-machine fixtures.**

Cover refusal when Supabase is not authoritative, either writer cannot freeze, backup evidence is incomplete, target identity mismatches, only one service acknowledges readiness, and a post-writer rollback attempts to restore Supabase by URL toggle.

- [ ] **Step 2: Run the cutover/rollback fixture suite and verify failure.**

```bash
bash ops/tests/deploy-release.test.sh
```

Expected: the new scenarios fail until the state transitions and refusal messages are implemented.

- [ ] **Step 3: Implement the pre-writer sequence.**

The first-cutover path must execute in this order:

```text
validate host/artifacts
verify Supabase authority
freeze Quest and VALORANT writers
verify final backup evidence
restore staged PostgreSQL 17
verify target identity/schema/roles/migrations
start both candidates frozen and read-only
verify Quest and VALORANT readiness/smoke reads
switch both database URL sets
restart both services
verify both readiness acknowledgements
admit both writers
record the durable commit point
```

Any failure before writer admission invokes only the approved pre-commit recovery path.

- [ ] **Step 4: Implement post-writer recovery protection.**

After either writer is admitted, require the existing post-commit recovery arm and reject a blind Supabase URL rollback. Record the stale-Supabase boundary and require an explicit reconciliation/data-loss decision before any return to Supabase.

- [ ] **Step 5: Run all deployment tests and shell checks.**

```bash
bash -n ops/deploy/cutover.sh ops/deploy/rollback.sh ops/deploy/release.sh
bash ops/tests/deploy-release.test.sh
```

Expected: all state-machine fixtures pass, both writer groups are required, and recovery evidence is created at mode boundaries.

- [ ] **Step 6: Commit coordinated cutover behavior.**

```bash
git add ops/deploy/cutover.sh ops/deploy/rollback.sh ops/deploy/release.sh ops/deploy/release.env.example ops/tests/deploy-release.test.sh
git commit -m "feat: coordinate VPS database authority cutover"
```

### Task 7: Update operational documentation and CI contracts

**Files:**
- Modify: `docs/production-runbook.md`
- Modify: `docs/setup-and-deployment.md`
- Modify: `docs/backup-and-disaster-recovery.md`
- Modify: `docs/ci-cd.md`
- Modify: `ops/docker/postgres/README.md`
- Modify: `.github/workflows/ci.yml` for PostgreSQL 17 contract/rehearsal checks while retaining its PostgreSQL 16 disposable fixture
- Test: repository Markdown/link checks and CI workflow validation

**Interfaces:**
- Consumes: the completed Compose, security, backup, rehearsal, and cutover contracts.
- Produces: an operator-readable procedure with explicit owner gates, no Supabase/VPS ambiguity, and no claim that checked-in files prove live host state.

- [ ] **Step 1: Add documentation contract checks.**

Assert that the runbook states VPS PostgreSQL 17 is the target, Supabase is temporary rollback material, PG16 remains during staging, port `55432` is loopback-only, and no public database port is allowed. Assert that the recovery document states the post-first-write rollback boundary.

- [ ] **Step 2: Update the runbook and recovery procedures.**

Document host preparation, TLS/SAN requirements, role/password delivery, staged Compose commands, final cutover order, exact evidence tokens, observation metrics, PG16 retirement, and the command-specific stop/mask rule. Keep owner-supplied RPO/RTO and live host evidence marked as operator inputs rather than inferred facts.

- [ ] **Step 3: Update CI without changing its disposable fixture major.**

Add static contract execution for the PostgreSQL 17 Compose, bootstrap, backup target, and rehearsal scripts. Do not change the existing `postgres:16` CI service to `postgres:17`; the production image/version contract is tested separately.

- [ ] **Step 4: Run documentation, workflow, and full application verification.**

```bash
git diff --check
npm test --prefix backend
npm test --prefix frontend
bash ops/tests/deploy-release.test.sh
bash ops/tests/media-backup-contract.test.sh
bash ops/tests/restore-production-backup.test.sh
bash ops/tests/postgres17-rehearsal.test.sh
```

Expected: no whitespace errors, frontend and backend suites pass, all shell contracts pass, and CI workflow parsing succeeds.

- [ ] **Step 5: Commit operational documentation.**

```bash
git add docs/production-runbook.md docs/setup-and-deployment.md docs/backup-and-disaster-recovery.md docs/ci-cd.md ops/docker/postgres/README.md .github/workflows/ci.yml
git commit -m "docs: document VPS postgres operations"
```

### Task 8: Execute owner-gated VPS staging, rehearsal, and cutover

**Files:**
- Operate: `/etc/quest-esports/release.env`
- Operate: `/etc/quest-esports/quest.production.env`
- Operate: `/etc/quest-esports-backup.env`
- Operate: `/etc/quest-esports/tls/quest-private-ca.crt`
- Operate: `/etc/quest-esports/tls/quest-postgres.crt`
- Operate: `/etc/quest-esports/tls/quest-postgres.key`
- Operate: `/srv/quest-esports/postgres/17/data`
- Operate: `/srv/quest-esports/postgres/init/001-bootstrap-roles.sql`
- Verify: `ops/deploy/validate-host.sh`, `ops/rehearsal/postgres17-restore-rehearsal.sh`, `ops/deploy/cutover.sh`, `ops/deploy/release.sh`, `ops/deploy/rollback.sh`

**Interfaces:**
- Consumes: merged release artifact, signed image manifest, approved backup destination, root bootstrap actor, maintenance-window approval, and the completed disposable rehearsal evidence.
- Produces: a live VPS PostgreSQL 17 authority switch, retained Supabase recovery copy, cutover evidence, and an approved PG16 retirement decision.

- [ ] **Step 1: Record owner gates before touching the VPS.**

Record the root bootstrap actor, release actor/sudo rule, RPO/RTO, maintenance window, backup destination, final archive identifiers, host capacity, and approval SHA. Abort if any required record is absent.

- [ ] **Step 2: Bootstrap without stopping existing writers.**

Create `/srv/quest-esports/postgres/17/data` as `postgres:postgres` mode `0700`, install the init SQL and healthcheck, install private TLS files, create the external `quest-shared` network, and verify that PostgreSQL 16 remains on `127.0.0.1:5432`.

- [ ] **Step 3: Start and validate staged PostgreSQL 17.**

Render `quest-prod` with the PostgreSQL staging overlay, start only the PostgreSQL service, verify its exact digest, loopback port `55432`, TLS SAN/CA, target sentinel, disk headroom, and healthcheck. Do not admit application writers.

- [ ] **Step 4: Run the production-archive restore rehearsal on the disposable target.**

Use the exact encrypted archive and pinned PostgreSQL 17 clients. Require successful schema, role, policy, migration, upload, readiness, backup, and cleanup evidence before scheduling the cutover.

- [ ] **Step 5: Run the approved maintenance-window cutover.**

Invoke the root-owned wrapper with the full release SHA and manifest after independently confirming both services’ freeze/read-only controls. The wrapper must return only the documented success tokens and write the durable commit-point evidence.

- [ ] **Step 6: Observe before retiring PostgreSQL 16 or deleting Supabase.**

Monitor both services, database connections/locks/latency/disk, backup freshness and remote verification, upload permissions, and health endpoints. Keep Supabase untouched. Retire PG16 and delete/rotate Supabase only after explicit owner approval and a final verified backup.

- [ ] **Step 7: Archive final evidence.**

Store private records for target identity, archive/checksum/remote verification, restore duration, migration status, role/RLS checks, readiness/smoke results, writer acknowledgements, observation period, and the PG16 retirement decision. Do not include secrets or credential-bearing URLs.

## Final verification checklist

- [ ] `git diff --check` passes on the implementation branch.
- [ ] `npm test --prefix backend` passes with the approved non-production test environment.
- [ ] `npm test --prefix frontend` passes.
- [ ] All shell contract tests pass.
- [ ] Compose base config has no PostgreSQL host publication; staging config maps only loopback `55432`.
- [ ] PostgreSQL 17 image and all release images are exact approved digests.
- [ ] Runtime roles are non-owner, non-superuser, non-bypass, and schema-isolated.
- [ ] Disposable restore proves both database schemas, uploads, policies, migrations, TLS, and runtime access.
- [ ] Backup/restore target binding proves the intended host, port, database, and PostgreSQL major version.
- [ ] Quest and VALORANT freeze, switch, readiness, smoke, and writer admission are coordinated.
- [ ] Post-first-write recovery is not an automatic Supabase URL rollback.
- [ ] No production VPS mutation occurred before all owner gates passed.
