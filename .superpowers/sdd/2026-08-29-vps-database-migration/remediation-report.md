# VPS PostgreSQL 17 migration remediation report

Date: 2026-08-30

Implementation commits: `32ec14e fix: close PostgreSQL migration recovery gaps`,
`e7fdde2 fix: close remaining PostgreSQL migration gaps`, plus the focused
remediation commit containing this report update.

This report records the validation state for both implementation passes.

## Scope

This remediation addresses the final review blockers without contacting the VPS,
production services, or any remote database:

- dedicated `quest_recovery_admin` ownership and recovery contract;
- complete application-object owner normalization for `public` and `valorant`;
- UID/GID 999 readability for the container-mounted PostgreSQL password;
- target-bound PostgreSQL security verification;
- asyncpg-compatible VALORANT TLS URL semantics;
- deploy-readable backup client TLS material (`root:deploy`, mode `0640`);
- PostgreSQL window-function ownership normalization and negative verification;
- rendered VALORANT Compose validation without credential-bearing JSON argv;
- negative deployment and disposable database-contract fixtures.

The PostgreSQL 17 image digest, loopback publication on `127.0.0.1:55432`,
private Compose network, RLS/NOBYPASSRLS requirements, pinned clients, and
`--no-acl` restore path were preserved.

## Implemented controls

- `ops/docker/postgres/init/001-bootstrap-roles.sql` defines the recovery role
  without a password, establishes the four application roles without inherited
  memberships, and runs restore owner normalization directly as the protected
  `quest_recovery_admin` superuser while retaining
  `session_user=quest_recovery_admin`.
- Ownership checks cover relations, routines, user-defined types, operators,
  collations, conversions, extended statistics, operator classes/families,
  text-search dictionaries, and text-search configurations. PostgreSQL catalog
  objects without owner columns (parsers/templates) are not queried; generated
  table row types are excluded while standalone and user-defined composite types
  remain covered.
- Restore verification checks both the common owner classes and extended
  object-owner classes before activation is considered complete.
- Runtime security verification rejects wrong database, host, port, major
  version, TLS/session identity, role attributes, cross-schema grants, missing
  RLS policies, and incomplete ownership normalization. Its URL parser accepts
  only the Compose `quest-postgres:5432` or staged `127.0.0.1:55432` endpoint,
  and its observed server-port check follows the selected target authority.
- VALORANT runtime configuration uses `postgresql+asyncpg://...?ssl=require`
  with explicit CA, hostname, and full-verification settings; libpq-only URL
  parameters are rejected for the target PostgreSQL runtime.
- Host/release/cutover validation checks password-file ownership/mode, the
  exact target binding, the backup client TLS mode/ownership contract, and the
  VALORANT asyncpg Compose contract. Rendered Compose JSON is held in mode-0600
  temporary files and rendered with `--no-env-resolution`. A disposable
  container fixture covers UID/GID 999 password, CA, certificate, and server-key
  readability.

## Validation evidence

Passed:

- `node --test backend/tests/production-container-config.test.js backend/tests/backup-scripts.test.js` — 44/44.
- `npm test` from `backend` — 1125 passed, 0 failed, 11 skipped (the skipped
  tests require external E2E configuration).
- `npm test` from `frontend` — 294 passed, 0 failed.
- `ops/tests/restore-production-backup.test.sh` — passed.
- `ops/tests/media-backup-contract.test.sh` — passed.
- `ops/tests/backup-multi-remote.test.sh` — passed.
- `ops/tests/postgres17-rehearsal.test.sh` — unresolved locally: the Windows
  Git Bash fixture timed out during the rehearsal run.
- `node --check backend/scripts/verify-database-security.js` and
  `node --check backend/src/lib/prisma.js` — passed.
- `docker compose config` for the production topology and the staged
  PostgreSQL overlay, using temporary fixture environment files — passed.
- Git Bash `bash -n` checks for restore, rehearsal, host validation, release,
  cutover, release verification, and related contract-test scripts — passed.
- `git diff --check` — passed; only normal Git LF/CRLF conversion warnings were
  emitted.

Validation rerun for the committed follow-up pass:

- `node --test backend/tests/production-container-config.test.js backend/tests/backup-scripts.test.js` — 44/44,
  including asyncpg TLS, backup mode, and composite/window-function ownership contracts.
- `npm test` from `backend` — 1125 passed, 0 failed, 11 skipped.
- `npm test` from `frontend` — 294 passed, 0 failed.
- `ops/tests/restore-production-backup.test.sh` — passed under Git Bash.
- `ops/tests/media-backup-contract.test.sh` and
  `ops/tests/backup-multi-remote.test.sh` — passed under Git Bash.
- Git Bash `bash -n` checks for the changed restore, rehearsal, deployment, and
  contract-test scripts — passed.
- `git diff --check` — passed; only normal Git LF/CRLF conversion warnings were
  emitted.
- `ops/tests/postgres17-rehearsal.test.sh` — unresolved locally: the Windows
  Git Bash fixture timed out during the rehearsal run.
- `ops/tests/deploy-release.test.sh` — unresolved locally: the Windows-hosted
  Git Bash fixture did not complete within the local five-minute timeout. A
  short diagnostic run showed it progressing through fixture scenarios; no VPS
  or remote target was touched.

Skipped or unresolved locally:

- `ops/tests/postgres-container-readability.test.sh` — skipped because the
  pinned PostgreSQL 17 image was not available locally.
- `ops/tests/deploy-release.test.sh` — the Windows-hosted Git Bash harness did
  not complete within the local timeout; this remains unresolved locally.

## Operational conclusion

Source-level contracts and disposable PostgreSQL security behavior pass the
available local validation; the deployment integration fixture remains an
environment-specific Windows-harness concern. Before production use, run the
full rehearsal on a disposable PostgreSQL 17 host with the pinned image
available, then capture the signed evidence bundle and operator approvals
required by the migration plan.
