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
| Registration verification | admin status controller | Yes | Yes | resulting verification status | Medium |
| Registration Game IDs | admin service/controller | Yes | Yes | captain/member count | High |
| Roster correction | admin service/controller | Yes | Yes | sanitized roster before/after | Critical |
| Payment reconciliation/reopen | payment services | Yes | Yes | status + decision/reason | Critical |
| Bank-transfer proof review | bank-transfer service | Yes | Yes | status + decision/reason | Critical |
| Private proof submission/download | payment controller | Yes | Proof download audit is mandatory; proof submission telemetry is optional post-write | metadata only | High |
| Veto rewind/reset | veto service/controller | Yes | Yes | step/status + reason | Critical |
| Veto team/toss/action mutations | veto controller | Yes for staff overrides | State transaction for staff overrides; captain self-service does not require audit | room outcome, no grant token | High |
| VALORANT mutations | VALORANT controller + operation ledger | Yes | Operation/remote contract | operation/status metadata | High |
| Staff assignment | staff controller | Yes | Legacy post-write | assignment outcome | High |
| Tournament/bracket admin mutations | tournament controller | Yes | Audited tournament mutation transaction; bracket match/publication transaction | status/visibility metadata | High |
| Slot reservation | admin controller | Yes | Existing service transaction plus audit boundary | expiry/registration | High |
| Ticket admin mutations | ticket controller | Yes | Ticket mutation transaction | status/result metadata | High |
| OAuth link/unlink | auth controller | Yes | OAuth link state/account mutation is not one transaction with optional telemetry; optional post-mutation audit callback | provider/result only | High |

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

## Fix round 4 — P0-003 review findings

Implemented on the current HEAD after the prior fixer rounds. Scope is limited
to VALORANT reconciliation, related veto/tournament/bracket audit regressions,
and this report. No schema, migration, frontend, plan, or production-data
changes were made.

### Findings closed

- `SERIES_ALREADY_FINALIZED` now retains the original finalize mutation status
  and FastAPI request ID as the operation's primary response metadata. The
  reconciliation GET status/request ID/result are stored separately in the
  operation summary and result audit evidence.
- Reconciliation adoption no longer uses the requested `ratingMode` when the
  reconciliation response cannot be mapped. It preserves only the local stored
  rating mode or a successfully mapped upstream value.
- Malformed mapping is eligible for finalized adoption only when the call is
  explicitly carrying the trusted `SERIES_ALREADY_FINALIZED` error. Generic
  malformed and draft/unconfirmed reconciliation records evidence, leaves the
  local projection unchanged, and remains reconciliation-required.
- Added direct audit failure, reconciliation GET failure, unconfirmed/draft,
  metadata-preservation, staff-veto, captain-veto, child-tournament,
  tournament-create, and bracket-publication regressions.

### Corrected operation evidence matrix

| Operation/path | What the round-4 tests prove | State/audit boundary proven |
|---|---|---|
| VALORANT `SERIES_ALREADY_FINALIZED` | Original 409/request ID remains distinct from reconciliation GET metadata; requested rating mode is not treated as observed state | Trusted adoption only; result audit and operation metadata are coherent |
| Generic malformed reconciliation | Mapping failure does not finalize/adopt the local projection | Evidence is recorded and reconciliation remains required |
| Draft/unconfirmed reconciliation | Draft status does not finalize/adopt the local projection | Evidence is recorded and reconciliation remains required |
| Veto staff vs captain choice | Staff audit failure rejects the mutation; captain self-service succeeds without invoking staff audit telemetry | Staff override audit is transaction-scoped; captain path preserves self-service semantics |
| Child tournament attachment/create | Request context reaches the audit event and audit failure rejects the privileged mutation path | Transaction boundary is exercised by the service tests |
| Bracket publication/regeneration | Request context and actual before-state evidence are covered; publication audit failure rejects the mutation path | Transaction boundary is exercised by the bracket tests |

### Fix-round validation

- Focused affected-module suite: passed, 94/94 tests.
- `npm test`: passed, 705 passed and 9 skipped.
- `npm run test:coverage`: passed; 77.92% lines, 68.35% branches, 76.23%
  functions.
- `npm run test:integration`: passed, 7/7. Expected constraint, worker, and
  uniqueness diagnostic logs were emitted by exercised integration cases.

## Fix round 5 — P0-003 final review findings

Implemented on the current HEAD. Scope remains limited to VALORANT
reconciliation metadata, tournament/bracket mutation transaction boundaries,
regressions, and this report. No schema, migration, frontend, or plan changes
were made.

### Findings closed

- `SERIES_ALREADY_FINALIZED` keeps the original finalize status/request ID as
  the operation's primary metadata for finalized adoption, draft/unconfirmed
  reads, and reconciliation GET failures. GET status/request ID/error/result
  evidence is stored under a separate `reconciliation` summary.
- Generic reconciliation GET failures retain their known read status/request
  ID, record `upstreamCommitted: false`, and do not adopt or imply an observed
  committed projection.
- Tournament update/delete and bracket match/publication before-state reads
  now occur inside the same Prisma transaction as their mutation and audit
  when audit context is present. Delete and bracket mutation paths use the
  transaction boundary consistently even without audit context.
- Corrected the matrix to describe OAuth link/unlink auditing as optional
  post-mutation controller telemetry, and bracket publication as a mutation
  transaction. The matrix now explicitly avoids claiming a fault-injected
  OAuth outage regression that is not present in the test suite.

### Fix-round regressions

- Finalize adoption, draft/unconfirmed reconciliation, trusted GET failure,
  generic GET failure, and both primary/reconciliation metadata sets.
- Tournament update/delete transaction-boundary seam assertions.
- Bracket match/publication transaction-boundary seam assertions.

### Fix-round validation

- Focused affected-module suite: passed, 77/77 tests.
- `npm test`: passed, 707 tests; 9 configured VALORANT E2E tests skipped for
  missing external environment variables.
- `npm run test:coverage`: passed; 77.92% lines, 68.37% branches, 76.37%
  functions.
- `npm run test:integration`: passed, 7/7. Expected uniqueness and worker
  diagnostic logs were emitted by exercised integration cases.
- `npm run lint`: passed with 25 warnings and no errors; warnings are existing
  unused-argument/fixture warnings.

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
| OAuth/proof | OAuth link/unlink and proof flows preserve their implemented optional-audit semantics; this matrix does not claim a fault-injected OAuth outage test | existing OAuth/bank-proof route/service coverage remains green |
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

## Whole-branch review round — P0-003 finding

Found while reviewing the whole branch after V2-P0-004 landed, and fixed in the
same round.

### Ticket reissue audit evidence was redacted

`ticket.reissued` recorded its before/after under a `tokenVersion` key. The
durable-audit sanitizer added by this task redacts every key matching
`/token/i`, so both sides persisted as `"[REDACTED]"`. Because a reissue leaves
`status` unchanged, the row carried no distinguishing before/after evidence at
all, and this report's earlier claim of "accurate before/after token-version
evidence" was not true of the persisted row.

The sanitizer policy was deliberately left unchanged — weakening it to admit
`tokenVersion` would also admit real credential keys. The non-secret reissue
counter is now recorded as `qrVersion`, which the policy passes through.
`backend/tests/ticket.service.test.js` gained a regression that drives the real
sanitizer through the mocked transaction and asserts the persisted row holds
`qrVersion` 3 → 4 rather than `"[REDACTED]"`.

No other audit payload in `backend/src` collides with the sanitizer's key
policy; the payload keys were enumerated against the policy regex to confirm
this.

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
| Bank proof submit/download | content type/size or download metadata only; no contents/signatures | mandatory download audit; optional submission telemetry | preserves committed user flow | bank-transfer proof lifecycle tests |
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
| Bracket generate/update/publish | seed count, scores/winner, visibility before/after | match/publication mutation transaction; audited generation uses the generation transaction | fail closed when audit context is supplied | bracket service/controller suite |
| Admin user/contact/recruitment | role/verification, read state, status/deletion outcome | controller audit boundary | existing response semantics | admin service/controller suite |
| Media/poster/image mutations | asset/poster identity/count/status; no file bytes | controller audit boundary | existing upload rollback semantics | media library/event album/upload suites |
| Saved-team/captain/staff mutations | existing safe identity/status evidence | existing controller audit boundaries | existing flows preserved | admin/staff/team suites |
| Match-room staff moderation/support/lock/sync | room/message/member/request outcome; no private body contents | existing controller audit boundary | existing status semantics | match-room service tests |
| OAuth link/unlink and mobile OAuth safety | provider/link state only; grants/session/codes never recorded | OAuth link state/account mutation is not one transaction with optional telemetry; optional post-mutation controller audit | preserves self-service flow when optional audit persistence fails | OAuth service/controller/route coverage; no dedicated fault-injected outage assertion |
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
