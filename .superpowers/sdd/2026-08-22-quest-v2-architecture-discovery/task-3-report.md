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

## Fix round 2 — P0-003 review findings

Implemented on top of commit `c8b04be`. Scope remains backend audit helper,
affected mutation services/controllers/routes/tests, and this report only; no
schema, frontend, plan, or production-data changes were made.

### Findings closed

- VALORANT finalize now maps the upstream result inside the post-commit guard.
  The durable result audit includes the raw upstream result and mapping outcome,
  and the original operation is marked succeeded when the local projection and
  audit commit. Mapping failure returns 503 with a truthful committed/audited
  message. Projection, result-audit, or operation-update failure marks the
  original operation `reconciliation_required`, retains the raw upstream result
  in its reconciliation summary, attempts a durable reconciliation result
  audit, and never reports a successful unaudited external commit.
- Admin registration deletion now deletes and records its critical audit in the
  same transaction. Upload cleanup remains after commit, and the controller no
  longer performs a misleading post-commit audit.
- Event child-tournament creation and existing-tournament attachment now pass
  request audit context from the series route through the shared tournament
  mutation helper. Attachment records actual series/order before/after data in
  the mutation transaction.
- Privileged veto room create/open/start, staff Team A assignment, manual toss,
  cancel, and access-grant rotation now record critical audits inside their
  mutation transactions. Controller post-commit duplicates were removed. Team
  readiness, digital captain toss, team choice, and other ordinary captain
  flows retain their existing self-service semantics.
- Bracket regeneration reads the current bracket inside the upsert transaction
  and records its actual status, seed count, and timestamps instead of always
  recording `status: absent`.

### Fix-round regression/validation matrix

| Area | Regression intent | Result |
|---|---|---|
| Registration deletion | transaction-scoped critical audit; no cleanup after audit rollback | covered by admin service transaction path and existing deletion suite |
| Registration verification/slots | preserve fail-closed transaction semantics | existing serializable/reservation rollback suite remains green |
| Ticket mutations | preserve atomic scan/reissue/status evidence | existing ticket mutation suite remains green |
| Tournament/bracket | preserve mutation rollback and actual regeneration before state | existing tournament/bracket suite remains green |
| Veto staff/captain | staff commands fail closed on audit failure; captain self-service remains valid | existing veto authorization/action suite remains green |
| OAuth/proof | optional audit outages do not turn committed self-service into failures | existing OAuth/bank-proof suite remains green |
| VALORANT finalize | mapping, result-audit failure, reconciliation status, and response semantics | existing finalize intent/result reconciliation suite remains green |

Validation completed for this round:

- Focused affected-module suite: passed, 146/146 tests.
- `npm test`: passed, 692 passed and 9 skipped.
- `npm run test:coverage`: passed, 77.61% lines, 68.53% branches, 75.93%
  functions.
- `npm run test:integration`: passed, 7/7. Expected constraint and worker
  diagnostic logs were emitted by exercised integration cases.
- `npm run lint`: passed with 27 pre-existing warnings and no errors.

## Fix round 3 — P0-003 review findings

Implemented on top of commit `e0c6190`. Scope remains backend audit helper,
affected mutation services/controllers/routes/tests, and this report only; no
schema, migration, frontend, plan, or production-data changes were made.

### Findings closed

- `SERIES_ALREADY_FINALIZED` now reconciles the original operation instead of
  marking it failed. The reconciliation read, including finalized adoption,
  malformed mapping, upstream read failure, and unconfirmed status, records
  transaction-scoped result/reconciliation evidence and updates the original
  operation coherently. A committed finalized projection with malformed output
  is audited from the raw response and returns a truthful 503 mapping error;
  audit/transaction failure remains reconciliation-required and fail-closed.
- Public veto readiness, digital toss, and Team A choice now accept request
  audit context. Staff bypasses conditionally audit actual before/after state
  inside the mutation transaction; captain/self-service calls do not require
  audit telemetry and preserve their prior success/error behavior.
- Registration deletion and child-tournament attachment now read their
  deletion/relationship snapshots inside the mutation transaction. Cleanup and
  audit evidence use that transaction state. Registration deletion explicitly
  records `afterData: { deleted: true }`.
- Child tournament creation audit evidence now includes `seriesId` and
  `seriesOrder`.
- Bracket regeneration regression coverage verifies the existing published
  bracket status, seed count, and publication timestamp are used as the actual
  before snapshot.

### Fix-round regression matrix

| Area | Proven regression coverage |
|---|---|
| Finalize reconciliation | original operation result audit/adoption, malformed reconciliation mapping, audit failure, timeout, and no-blind-retry tests |
| Registration deletion | same-transaction failure rollback and explicit deleted-after evidence tests |
| Child tournament | create/attach request audit context, relationship before/after evidence, and transaction path tests |
| Bracket | regeneration actual-before snapshot test |
| Veto | staff public choice audit failure plus existing captain authorization/self-service tests |
| Tickets/tournaments/registration | existing transaction rollback, evidence, verification, slot, and mutation suites |
| OAuth/bank proof | existing optional-audit failure semantics tests |

### Fix-round validation

- Focused affected-module suite: passed, 155/155 tests.
- `npm test`: passed, 697 passed and 9 skipped.
- `npm run test:coverage`: passed, 77.47% lines, 68.64% branches, 76.04%
  functions.
- `npm run lint`: passed with 25 existing warnings and no errors.
- `npm run test:integration`: not clean in this environment; 6/7 passed on
  two attempts. The pre-existing background-worker concurrency case failed its
  `processed === 1` assertion after PostgreSQL write-conflict diagnostics;
  the other six integration cases passed. No integration code was changed.

## Concerns and follow-up

- Some legacy non-critical controller mutations still persist their audit row
  immediately after the service write rather than sharing the service
  transaction. The critical registration, payment, and veto override paths
  are transaction-scoped in this task; further consolidation should avoid
  changing existing response/status contracts.
- The configured VALORANT end-to-end test remains skipped when its external
  service/database environment contract is absent; unit and operation-ledger
  coverage passed.

## Fix round — review findings addressed

### VALORANT finalize audit safety

`finalizeSeries` now has an explicit three-stage boundary:

1. It creates the existing `QuestValorantOperation` idempotency/reconciliation
   row, then writes a separate `AuditLog` intent event through `recordAudit`.
   If the intent audit fails, the external finalize request is never sent and
   the operation is marked `reconciliation_required`.
2. The remote finalize call is performed only after the intent is durable.
3. The local finalized projection, the transaction-scoped `AuditLog` result
   event, and the operation success state are committed together through the
   existing Prisma transaction. The result event contains accurate draft to
   finalized evidence and only minimal result metadata.

If the remote operation has committed but the local result/audit transaction
cannot commit, the operation is marked `reconciliation_required` and the
client receives an explicit `503` with
`VALORANT_AUDIT_RECONCILIATION_REQUIRED`; it is not presented as a normal
successful finalize, and the existing operation ledger is not described or
used as an `AuditLog` substitute. The controller now passes audit context to
the service rather than attempting a misleading post-commit result audit.

### Shared helper and evidence corrections

- All critical transaction-scoped audit writes now use
  `recordAuditInTransaction`; direct `tx.auditLog.create` duplicates were
  removed from registration and veto services.
- The shared helper applies sanitization and actor UUID normalization to both
  ordinary and transaction-scoped writes, including test/mocked logger
  boundaries.
- Game ID edits record the operation and member count without treating the
  requested payload as a persisted before/after snapshot.
- Veto rewind records the original step, requested step, and actual automatic
  advancement step. Staff veto actions record the prior step/action and the
  committed action/result; captain readiness, toss, team choice, and action
  flows remain free of post-commit audit-induced failures.
- Ticket scan records the actual scan result, prior status/check-in timestamp,
  committed status, and accepted flag. Reissue/status changes record accurate
  before/after token-version or status evidence.

### Transaction boundaries and optional audits

- Registration verification-only changes and slot reserve/release audits now
  share their existing serializable/database transactions.
- Ticket scan, reissue, status, and admin ticket-event writes now include their
  critical audit in the same database transaction.
- Tournament create/update/delete and bracket generate/match-update/publish
  writes now include transaction-scoped audit rows when called from privileged
  request boundaries.
- OAuth link/unlink and bank-transfer proof submission are classified as
  optional post-mutation security telemetry: audit failures are logged/ignored
  so ordinary self-service or proof-submission flows do not report a committed
  mutation as failed solely because telemetry is unavailable. Payment review
  and reconciliation remain fail-closed transaction-scoped audits.

### Operation-by-operation audit/security matrix

| Operation/path family | Audit event and evidence | Audit location | Failure semantics | Regression evidence |
|---|---|---|---|---|
| Registration status/approval | status/reason before/after | serializable admin transaction | fail closed | `admin.service.test.js` status/waitlist cases |
| Registration verification | verification status before/after | serializable admin transaction | fail closed | admin service status suite |
| Registration Game IDs | captain-updated/member-count outcome | serializable admin transaction | fail closed | admin Game ID cases |
| Registration roster edit | sanitized member before/after, saved-team/captain flags | serializable admin transaction | fail closed | admin roster correction cases |
| Registration slot reserve/release | slot, fee/currency, reservation before/after | existing reservation transaction | fail closed | reservation service/route coverage |
| Payment bank review/reconciliation/reopen | status, decision, reason code | payment transaction | fail closed | payment and bank-transfer rollback tests |
| Bank proof submit/download | content type/size or download metadata only; no contents/signatures | optional controller audit | preserves committed user flow | bank-transfer proof lifecycle tests |
| Veto rewind/reset | original/requested/actual step, status, reason | veto state transaction | fail closed for staff override | veto service/route authorization suite |
| Veto staff action | prior step/action and committed action/result | veto state transaction | fail closed | veto mutation suite |
| Veto captain readiness/toss/choice/action | service authorization remains authoritative; no required post audit | no optional audit failure in flow | preserves valid captain flow | veto wrong-team/grant/toss/action tests |
| Veto catalog/map/preset/template/config | scoped object identity and safe settings metadata | controller audit boundary | existing privileged response semantics | veto catalog tests |
| VALORANT finalize | separate intent and result events, operation ID, status/rating only | intent before remote; result with local projection transaction | fail closed/reconciliation-required | finalize intent/result failure tests |
| Other VALORANT mutations | existing bind/detach/import/series/game audit events plus operation ledger | controller/operation boundaries | existing upstream semantics | VALORANT controller/service suite |
| Ticket scan/check-in | result, prior/after status and check-in timestamp | ticket transaction | fail closed | ticket scan atomicity tests |
| Ticket reissue/status | token version or status before/after | ticket transaction | fail closed | ticket mutation tests |
| Ticket event admin | slug/capacity/status before/after | ticket transaction | fail closed | ticket/admin event suite |
| Tournament admin create/update/delete | slug/status/publication before/after | tournament transaction | fail closed | tournament service suite |
| Bracket generate/update/publish | seed count, scores/winner, visibility before/after | bracket transaction | fail closed | bracket service/controller suite |
| Admin user/contact/recruitment | role/verification, read state, status/deletion outcome | controller audit boundary | existing response semantics | admin service/controller suite |
| Media/poster/image mutations | asset/poster identity/count/status; no file bytes | controller audit boundary | existing upload rollback semantics | media library/event album/upload suites |
| Saved-team/captain/staff mutations | existing safe identity/status evidence | existing controller audit boundaries | existing flows preserved | admin/staff/team suites |
| Match-room staff moderation/support/lock/sync | room/message/member/request outcome; no private body contents | existing controller audit boundary | existing status semantics | match-room service tests |
| OAuth link/unlink and mobile OAuth safety | provider/link state only; grants/session/codes never recorded | optional link/unlink audit | preserves self-service flow on audit outage | OAuth service/controller/route tests |
| CSRF/origin protections | no mutation audit added; security middleware decision | middleware | existing 401/403 behavior preserved | `security.test.js` CSRF/origin cases |
| Rate limits | no sensitive request payload logged/audited | rate-limit middleware | existing 429 behavior preserved | `rate-limit.test.js` |
| Log/audit leakage | sanitizer/redactor coverage for sessions, grants, signatures, secrets, ciphertext, PUUIDs, buffers/private uploads | shared helper/logger | sensitive values replaced | `audit.test.js`, observability/security suites |

### Fix-round tests and validation

- Focused corrected-path suite: passed, 154/154 tests.
- Added finalize intent-audit failure and result-audit reconciliation
  regressions, transaction sanitizer/actor normalization coverage, and
  corrected ticket/veto evidence assertions.
- `npm run lint`: passed with 27 pre-existing warnings and no errors.
- `npm test`: passed, 690 passed and 9 skipped.
- `npm run test:coverage`: passed; 77.67% lines, 68.51% branches, 75.99%
  functions.
- `npm run test:integration`: passed, 7/7. Expected constraint and worker
  diagnostic logs were emitted by exercised integration cases.
