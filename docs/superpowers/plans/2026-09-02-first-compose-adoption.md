# First Compose Adoption Implementation Plan

**Date:** 2026-09-02  
**Design:** `docs/superpowers/specs/2026-09-02-first-compose-adoption-design.md`  
**Status:** In progress; production promotion remains disabled

## Objective

Adopt the already-authoritative VPS PostgreSQL 17 database and the legacy Quest
PM2/VALORANT writers into the immutable Compose release path without mounting
the live PostgreSQL data directory twice, admitting simultaneous writers, or
inventing steady-state release lineage.

## Non-negotiable gates

- Keep `PRODUCTION_DEPLOYMENT_MODE` and `COMPOSE_DEPLOY_ENABLED` unset until
  every repository, recovery, host, and candidate gate below passes.
- Never use `release.sh` to fabricate the first `current` pointer.
- Never mount `/srv/quest-esports/postgres/17/data` into a candidate while the
  live `quest-postgres` container owns it.
- Treat PostgreSQL, public uploads, and private uploads as one recovery set.
- Stop both Quest and VALORANT writers before the final archive and final
  restore. No writer is admitted until both schemas and both services pass.
- Before the durable writer-admission record, failure restores the legacy
  services. After it, failure freezes Compose writers and uses the recorded
  fix-forward/controlled-restore decision; it never redirects to Supabase.

## Phase 1: Repository contracts

1. Add `ops/deploy/adopt-compose.sh` as the only one-time adoption controller.
2. Add adoption-only Compose overlays with isolated project/network names,
   candidate data root, and loopback ports `55433`, `15001`, and `18000`.
3. Extend deployment fixtures with the complete adoption state machine:
   `undetermined`, `vps-authoritative-audited`, `recovery-verified`,
   `candidate-validated`, `handoff-armed`, `compose-authoritative`.
4. Prove failures cannot create `current`, claim writer admission, touch the
   live data root, or leave legacy restart persistence disabled.
5. Add a manual `adopt_existing_vps` input to the Compose workflow. It must
   require a SHA-bound approval variable and call a distinct root wrapper.
   Normal workflow-run deployments remain steady-state-only.

## Phase 2: Host bootstrap without downtime

1. Install root-owned release/adoption wrappers, `/etc/quest-esports/release.env`,
   `/var/lib/quest-esports/incoming`, and the fixed release lock.
2. Install the dedicated GitHub Actions deploy key and restrict its sudo access
   to the fixed release/adoption wrappers. Remove `NOPASSWD: ALL` only after a
   second root session proves recovery access.
3. Provision the `quest_backup`, `quest_migrator`, `val_migrator`, and recovery
   roles with least privilege; runtime containers receive only runtime roles.
4. Validate PostgreSQL server/client TLS, SANs, modes, and the `quest-shared`
   aliases without restarting the live database.
5. Repair the multi-remote backup configuration and require a fresh encrypted
   archive plus isolated PostgreSQL 17 restore evidence.

## Phase 3: Isolated candidate

1. Restore a current verified archive into
   `/srv/quest-esports/postgres/17-adoption-candidate/data`.
2. Start the candidate PostgreSQL and application projects under adoption-only
   names. They use only alternate loopback ports and receive write-freeze plus
   disabled background-worker settings.
3. Verify exact image digests/signatures/attestations, schema and migration
   ledgers, RLS/roles/default ACLs, TLS hostname validation, uploads, Quest
   readiness, and VALORANT readiness from the correct network boundary.
4. Destroy and recreate the candidate from the accepted archive once to prove
   repeatable recovery. Retain only encrypted artifacts and redacted evidence.

## Phase 4: Handoff

1. Record the maintenance window, exact adoption SHA, image digests, accepted
   RPO/RTO, backup identifiers, rollback root, and owner approval.
2. Enable application write freezes and verify both groups acknowledge them.
3. Stop PM2 and all three legacy VALORANT units; prove they cannot restart.
4. Create and remotely verify the final archive, then restore it into a fresh
   candidate data root and re-run migrations/security validation.
5. Stop the legacy PostgreSQL container. Move its canonical data root to a
   timestamped rollback root, then atomically move the validated candidate root
   into the canonical path. Do not delete either root during the rollback
   window.
6. Start final Compose services frozen, verify readiness, then admit Quest and
   VALORANT writers independently.
7. Atomically write `commit-point.txt`, `release-metadata.txt`, and `current`.
   Only then mask legacy boot persistence and reload Nginx.

## Phase 5: Steady state

1. Run public/API/auth/upload/integration smoke checks and a reboot test.
2. Run and remotely verify the first post-adoption multi-remote backup.
3. Merge a distinct SHA and deploy it through normal `release.sh`; this proves
   steady-state lineage rather than reusing the adoption SHA.
4. Remove repository-scoped legacy deployment secrets and the interim backup
   timer. Retain rollback data and legacy service definitions until the agreed
   observation window closes.
5. Update the runbook and this plan with redacted evidence and final outcomes.

## Current live findings

- Docker and Compose are installed; `quest-postgres` is healthy at the approved
  PostgreSQL 17 digest on `127.0.0.1:5433`.
- Quest PM2 and all three VALORANT units are active and boot-enabled.
- The interim PostgreSQL 17 encrypted backup succeeded on 2026-09-02.
- The canonical multi-remote backup script now enforces the final TLS/role/port
  contract, while the installed host configuration still describes the legacy
  `quest_runtime`/5433 source. It therefore fails closed and must be migrated,
  not weakened.
- GitHub production promotion remains disabled. Main protection, SHA-pinning,
  a main-only production environment, and a dedicated environment-scoped SSH
  identity are installed.
