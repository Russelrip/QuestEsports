# VPS PostgreSQL 17 migration remediation report

Date: 2026-08-30

## Scope

This remediation addresses the final review blockers without contacting the VPS,
production services, or any remote database:

- dedicated `quest_recovery_admin` ownership and recovery contract;
- complete application-object owner normalization for `public` and `valorant`;
- UID/GID 999 readability for the container-mounted PostgreSQL password;
- target-bound PostgreSQL security verification;
- asyncpg-compatible VALORANT TLS URL semantics;
- negative deployment and disposable database-contract fixtures.

The PostgreSQL 17 image digest, loopback publication on `127.0.0.1:55432`,
private Compose network, RLS/NOBYPASSRLS requirements, pinned clients, and
`--no-acl` restore path were preserved.

## Implemented controls

- `ops/docker/postgres/init/001-bootstrap-roles.sql` defines the recovery role
  without a password, establishes migrator memberships during normal bootstrap,
  and runs restore owner normalization through the two migrator roles while
  retaining `session_user=quest_recovery_admin`.
- Ownership checks cover relations, routines, user-defined types, operators,
  collations, conversions, extended statistics, operator classes/families,
  text-search dictionaries, and text-search configurations. PostgreSQL catalog
  objects without owner columns (parsers/templates) are not queried.
- Restore verification checks both the common owner classes and extended
  object-owner classes before activation is considered complete.
- Runtime security verification rejects wrong database, host, port, major
  version, TLS/session identity, role attributes, cross-schema grants, missing
  RLS policies, and incomplete ownership normalization.
- VALORANT runtime configuration uses `postgresql+asyncpg://...?ssl=require`
  with explicit CA, hostname, and full-verification settings; libpq-only URL
  parameters are rejected for the target PostgreSQL runtime.
- Host/release/cutover validation checks password-file ownership/mode and the
  exact target binding. A disposable container fixture covers UID/GID 999
  password readability.

## Validation evidence

Passed:

- `node --test backend/tests/production-container-config.test.js` — 35/35.
- `npm test` from `backend` — 1124 passed, 0 failed, 11 skipped (the skipped
  tests require external E2E configuration).
- `npm test` from `frontend` — 294 passed, 0 failed.
- `ops/tests/restore-production-backup.test.sh` — passed.
- Git Bash `bash -n` checks for restore, rehearsal, host validation, release,
  cutover, and release verification scripts — passed.
- `git diff --check` — passed; only normal Git LF/CRLF conversion warnings were
  emitted.

Skipped or unresolved locally:

- `ops/tests/postgres-container-readability.test.sh` — skipped because the
  pinned PostgreSQL 17 image was not available locally.
- `ops/tests/postgres17-rehearsal.test.sh` — the Windows test harness terminated
  its child process (`ChildProcess.kill`); no VPS or remote target was touched.
- `ops/tests/deploy-release.test.sh` — the Windows-hosted Git Bash run did not
  complete within the local timeout; it exercised local fixtures only.

## Operational conclusion

Source-level contracts and disposable PostgreSQL security behavior pass the
available local validation. Before production use, run the full rehearsal on a
disposable PostgreSQL 17 host with the pinned image available, then capture the
signed evidence bundle and operator approvals required by the migration plan.
