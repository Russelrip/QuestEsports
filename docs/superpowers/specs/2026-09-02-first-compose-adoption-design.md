# First Compose Adoption Design

**Date:** 2026-09-02  
**Status:** Design approved for planning; implementation and production execution are gated  
**Scope:** One-time adoption of the live VPS PostgreSQL authority into the protected Compose release path

## Context

The repository’s normal Compose deployment is a steady-state release workflow.
It expects canonical host configuration, an existing immutable release, a
validated PostgreSQL 17 target, and release metadata proving the prior state.
The live VPS does not satisfy those assumptions yet:

- `quest-postgres` is healthy at the approved PostgreSQL 17 digest and uses
  durable storage at `/srv/quest-esports/postgres/17/data`.
- It is published on `127.0.0.1:5433` through `quest-db-net`, while the Compose
  target contract uses `127.0.0.1:55432` and `quest-shared`.
- Quest Node/PM2 and separate Valorant services are active.
- Canonical release files, current-release metadata, and root-owned wrappers are
  absent.
- Scheduled production backup and freshness services are failed; only the
  interim PostgreSQL backup timer succeeded most recently.
- `deploy` has unrestricted `NOPASSWD: ALL` sudo.

Repository records describe VPS PostgreSQL as production-authoritative, and live
connections show `quest_runtime` and `val_runtime` connected to the VPS
PostgreSQL instance. The adoption procedure still treats authority as an
explicit, timestamped decision rather than inferring it from documentation.

## Goals and non-goals

### Goals

1. Preserve the current live stack until a separately validated Compose
   candidate exists.
2. Establish one database authority with no simultaneous writers.
3. Create truthful, durable release and rollback evidence.
4. Make the first Compose release independently reversible.
5. Keep the 5433 compatibility path until the handoff and rollback checks pass.

### Non-goals

- Do not rebuild production from stale Supabase material.
- Do not fabricate `/opt/quest-esports/current`, release metadata, or commit
  points.
- Do not run the normal steady-state release workflow as a bootstrap.
- Do not delete the retained legacy PM2 rollback path or its secrets.
- Do not expose credentials in logs, chat, workflow output, or evidence files.

## Chosen architecture

Use a staged parallel candidate. The live legacy stack remains authoritative
through candidate validation:

```text
live legacy writers + quest-postgres:5433
              |
              | verified backup/restore, no live writes
              v
isolated PostgreSQL candidate + Compose candidate services
              |
              | frozen read-only checks and owner-approved handoff
              v
Compose authority + compatibility rollback path
```

The candidate must use separate durable storage, a separate Docker project and
network, and alternate loopback ports. It must never mount the live PostgreSQL
data root concurrently with the live container. Candidate services must be
started in write-free validation mode and must not receive public traffic.

The implementation plan reserves these temporary host bindings to prevent
collisions with the live stack: PostgreSQL candidate `127.0.0.1:55433`, Quest
candidate readiness `127.0.0.1:15001`, and Valorant candidate health
`127.0.0.1:18000`. They are loopback-only and may be omitted when validation is
performed entirely from a container on the candidate network. The final target
uses `127.0.0.1:55432`; the existing `5433` binding remains untouched until the
rollback window closes.

## State machine

The adoption controller and evidence use these states:

1. `undetermined` — live authority or data parity is not proven.
2. `vps-authoritative-audited` — both writer groups and the VPS database target
   are evidenced; no split-brain writer is found.
3. `recovery-verified` — a current encrypted backup, checksum, remote copies,
   and an isolated PostgreSQL 17 restore rehearsal all pass.
4. `candidate-validated` — alternate-port Compose candidates pass frozen
   readiness, security, schema, migration, and image identity checks.
5. `handoff-armed` — maintenance window, RPO/RTO, owner approval, rollback
   checkpoints, and exact release artifacts are recorded.
6. `compose-authoritative` — legacy writers are stopped, Compose writers are
   admitted, the commit point is durable, and `current` points to the exact
   adopted release.
7. `steady-state` — a later distinct CI-built release has passed the normal
   release workflow.

Every failed transition leaves the prior state intact. The controller must
record the failed check and prohibit the next state; it must not guess or
repair state by creating a symlink or overwriting metadata.

## Authority and database transition

The audit phase must record, with secrets redacted:

- Effective Quest and Valorant database endpoint classifications from the
  running processes and protected environment files.
- Database identity, PostgreSQL major, database name, data root, schemas,
  migration ledgers, roles, RLS/security results, and active connection groups.
- Active Quest and Valorant writer processes and their ownership.
- Evidence that no old writer remains pointed at Supabase while another writer
  uses VPS PostgreSQL.

The live `quest-postgres` data root is never mounted by two containers. The
candidate is restored from a verified archive into a separate data root. The
5433 publication remains available while legacy writers are active. The final
handoff must explicitly coordinate:

1. freeze all application writers;
2. confirm the candidate and live data are at the approved commit point;
3. stop the legacy writers and confirm they cannot restart automatically;
4. admit only Compose writers on `quest-shared`;
5. provide the required 55432 maintenance/validation access;
6. verify both writer groups, both schemas, and rollback checkpoints;
7. retain 5433 until the rollback window closes.

No independent service may be redirected to Supabase during or after this
transition.

## Release lineage and bootstrap contract

The bootstrap must be an explicit, separately tested operation because
`release.sh` currently assumes a prior immutable release. It must write
metadata only after candidate validation, writer admission, and the durable
commit point succeed.

The release lineage is:

- **Adoption SHA A:** an owner-approved, exact artifact used by the one-time
  bootstrap. Its metadata records the actual predecessor and adoption state.
- **Steady-state SHA B:** a later, distinct `main` SHA built and signed by the
  normal workflow after Compose authority is established. The normal release
  workflow must not reuse SHA A after an adoption directory already exists.

The bootstrap contract must validate the exact image digests, write
`release-metadata.txt` and `commit-point.txt` atomically, record
`writer_admitted=true`, `current_pointer_updated=true`, predecessor type,
timestamps, both writer groups, both schemas, and rollback information. A
partial metadata write or an unverified `current` pointer fails closed.

## Host and security prerequisites

Before handoff, the host remediation phase must establish and verify:

- canonical `/etc/quest-esports/release.env` and protected runtime/recovery
  files with required ownership and modes;
- root-owned release wrappers, release directories, lock path, network names,
  and manifest inode;
- PostgreSQL server/client TLS, SAN/chain validation, and canonical mounts;
- working database health/readiness, security verification, migration status,
  registry checks, and both service readiness checks;
- successful multi-remote backup freshness and release-bound backup evidence;
- a narrow fixed-command sudo rule for `deploy`, with `NOPASSWD: ALL` removed;
- dedicated deployment SSH credentials and a trusted pinned host key;
- explicit maintenance window, owner approvals, RPO/RTO, capacity, and rollback
  procedure.

The protected GitHub Compose variables are enabled only immediately before the
controlled deployment phase. The `production-compose` reviewer gate remains
enabled; approval is not bypassed.

## Verification gates

### Repository gate

- workflow and shell lint;
- production-container and deployment contract suites;
- exact image signing and GHCR publication;
- bootstrap state-machine and metadata tests;
- failure tests proving no `current` or writer admission on partial failure.

### Host candidate gate

- candidate data restore and checksum/decryption verification;
- PostgreSQL 17 identity, schema, role, RLS, and migration verification;
- frozen read-only Quest and Valorant readiness;
- exact image, network, mount, TLS, and endpoint checks;
- backup and restore evidence retained outside ordinary application logs.

### Handoff gate

- maintenance window and approvals recorded;
- writers frozen and legacy restart persistence disabled;
- candidate health and rollback checkpoints rechecked immediately before
  admission;
- one Compose writer group admitted at a time;
- public health, authentication, mail/payment, and read-only smoke checks;
- rollback drill or explicit rollback decision before closing the window.

## Failure and rollback behavior

- Before the durable commit point, abort and restore the candidate/legacy state;
  do not claim Compose authority.
- After the durable commit point, use the recorded rollback procedure and
  evidence; never blindly redirect to Supabase.
- Any backup, TLS, readiness, security, migration, image, or ownership failure
  blocks promotion.
- Any unexpected writer or port listener blocks promotion and triggers a
  freeze, not an automatic restart.

## Current decision

The design is approved for implementation planning only. The current host is
not ready for bootstrap or deployment. The next deliverable is a detailed
implementation plan for the bootstrap contract, host evidence collection,
backup/restore acceptance, and controlled handoff. No GitHub gate, production
secret, host file, database, writer, or release pointer is changed by this
design.
