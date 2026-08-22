# V2-P0-003 Implementation Report

## Status

Implemented on the approved checkout based on `3755fac` plus the integrated
backend fix. No schema, migration, frontend, plan, or production-data changes
were made.

## Scope and implementation

### Shared audit/security helper

- Extended `backend/src/lib/audit.js` with a durable-audit sanitizer that is
  stricter than the general logger redactor.
- Redacts sessions, OAuth grants, tokens/capabilities, PayHere signatures,
  secrets, encrypted/ciphertext identifiers, PUUIDs, buffers, and private
  upload contents before persistence.
- Preserves safe scalar metadata and serializes `Date` values consistently.
- Keeps malformed/non-UUID actor IDs from violating the UUID audit relation;
  authenticated production actor IDs remain persisted.
- Exported the sanitizer for direct regression coverage.

### Critical mutation boundaries

- Registration Game ID edits and roster corrections now accept request audit
  context and write their audit rows inside the existing serializable admin
  transaction. Audit persistence failures therefore roll back the mutation.
- Existing registration status/approval and payment reconciliation audit paths
  were preserved, including their transaction-scoped fail-closed behavior.
- Veto rewind/reset overrides now write request-context audit rows inside their
  state transaction. Existing service authorization and status/error contracts
  remain unchanged.

### Privileged operation coverage

Added or completed audit events for:

- OAuth account link and unlink.
- Bank-transfer proof submission without recording file contents.
- Registration verification-only changes, deletion, slot reservation/release,
  Game ID edits, and roster corrections.
- Saved-team updates, organization changes, captain transfer (existing), and
  deletion.
- Ticket event administration, ticket scan/check-in/reissue/status changes.
- Tournament create/update/delete and bracket generate/update/visibility.
- Veto readiness, toss, team-order choice, submitted actions, and existing
  room/catalog operations.
- Existing VALORANT bind/detach/import/series/game/finalize audit coverage was
  retained; operation rows remain the Quest-side idempotency/audit ledger.

### Audit coverage matrix

| Operation | Handler boundary | AuditLog | Same transaction | Before/after or minimal outcome | Severity before fix |
|---|---|---:|---:|---|---|
| Registration status/approval | `admin.service.updateTeamRegistrationStatus` | Yes | Yes | status + reason | High |
| Registration verification | admin status controller | Yes | Legacy post-write | resulting verification status | Medium |
| Registration Game IDs | admin service/controller | Yes | Yes | captain/member count | High |
| Roster correction | admin service/controller | Yes | Yes | sanitized roster before/after | Critical |
| Payment reconciliation/reopen | payment services | Yes | Yes | status + decision/reason | Critical |
| Bank-transfer proof review | bank-transfer service | Yes | Yes | status + decision/reason | Critical |
| Private proof submission/download | payment controller | Yes | Submission legacy post-write; download read audit | metadata only | High |
| Veto rewind/reset | veto service/controller | Yes | Yes | step/status + reason | Critical |
| Veto team/toss/action mutations | veto controller | Yes | Legacy post-write | room outcome, no grant token | High |
| VALORANT mutations | VALORANT controller + operation ledger | Yes | Operation/remote contract | operation/status metadata | High |
| Staff assignment | staff controller | Yes | Legacy post-write | assignment outcome | High |
| Tournament/bracket admin mutations | tournament controller | Yes | Legacy post-write | status/visibility metadata | High |
| Slot reservation | admin controller | Yes | Existing service transaction plus audit boundary | expiry/registration | High |
| Ticket admin mutations | ticket controller | Yes | Legacy post-write | status/result metadata | High |
| OAuth link/unlink | auth controller | Yes | OAuth state transaction plus audit boundary | provider/result only | High |

## Test-first regressions

- Added `backend/tests/audit.test.js` covering all required sensitive-data
  classes, private upload buffers, safe metadata, and dates.
- Updated OAuth route fixtures to provide the audit boundary without changing
  route/auth behavior.
- Existing payment fail-closed, registration, veto, and VALORANT audit tests
  were run against the updated boundaries.

## Validation

- Focused audit/security suite: passed, 136/136.
- `npm run lint`: passed with 28 pre-existing warnings and no errors.
- `npm test`: passed, 687 passed and 9 skipped.
- `npm run test:coverage`: passed; 77.88% lines, 68.63% branches, 75.94%
  functions.
- `npm run test:integration`: passed, 7/7. Expected constraint and worker
  diagnostic logs were emitted by exercised integration cases.

## Concerns and follow-up

- Some legacy non-critical controller mutations still persist their audit row
  immediately after the service write rather than sharing the service
  transaction. The critical registration, payment, and veto override paths
  are transaction-scoped in this task; further consolidation should avoid
  changing existing response/status contracts.
- The configured VALORANT end-to-end test remains skipped when its external
  service/database environment contract is absent; unit and operation-ledger
  coverage passed.
