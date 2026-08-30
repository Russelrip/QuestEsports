# VPS PostgreSQL Migration Final Fix Report

## Status

Implemented the final security/readiness fix wave in the existing worktree. No
VPS, production database, live upload root, hosted service, or remote backup
was contacted.

Commit: `a70c176` (`fix: close VPS PostgreSQL migration security gaps`).

## Changes

- Enforced separate backup and recovery TLS client identities.
- Restricted production restore to `quest_recovery_admin` and verified the
  target endpoint, TLS session, PostgreSQL major, and object ownership.
- Normalized Quest and VALORANT schema ownership and kept both migration
  ledgers private from runtime roles.
- Expanded the database verifier to cover both schemas, runtime policies,
  cross-schema grants, Data API grants, non-bypass roles, and ownership.
- Tightened release/cutover/host validation for runtime URLs, image bundle
  values, readiness JSON, recovery URLs, and privileged settings.
- Kept image references in the signed release Compose bundle rather than the
  backend runtime environment.
- Required PostgreSQL healthchecks to validate the private CA, SAN coverage,
  private key, and `verify-full` readiness.
- Updated backup/recovery/rehearsal documentation and disposable fixtures.

## Validation

- `npm test --prefix backend` — passed: 1123 passed, 11 skipped, 0 failed.
- `npm test --prefix frontend` — passed: 294 passed.
- `ops/tests/backup-multi-remote.test.sh` — passed.
- `ops/tests/media-backup-contract.test.sh` — passed.
- `ops/tests/restore-production-backup.test.sh` — passed.
- `ops/tests/postgres17-rehearsal.test.sh` — passed.
- Bash syntax checks for changed shell scripts — passed.
- `git diff --check` — passed.

## Environment-specific limitation

`ops/tests/deploy-release.test.sh` did not complete within 180 seconds under
Windows Git Bash (`exit 124`). The fixture is known to include POSIX ownership
checks that cannot be faithfully observed on this host. It should be rerun in
Linux CI or a Linux checkout before production deployment.

## Operational concerns

- No live PostgreSQL 17 restore rehearsal or production cutover was performed.
- Production remains gated on the documented owner approvals, Linux-host
  rehearsal evidence, and deployment fixture completion.
