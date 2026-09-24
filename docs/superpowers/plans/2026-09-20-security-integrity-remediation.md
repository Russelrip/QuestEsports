# Security and Integrity Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remediate the highest-confidence security, authorization, payment-integrity, concurrency, operator-safety, and production-readiness findings from the project audit without changing the approved deployment architecture.

**Architecture:** Preserve existing service boundaries. Backend fixes will make ownership and financial state transitions authoritative and transactional; FastAPI will harden its legacy boundary without exposing provider bearer credentials; mobile/frontend fixes will reduce accidental disclosure and unsafe actions; operations changes will align contracts and CI without touching live credentials.

**Tech Stack:** Express 5, Prisma/PostgreSQL, Node test runner, FastAPI/Pydantic/SQLAlchemy, Expo/React Native, Next.js/React, GitHub Actions, shell/Compose contracts.

**Spec:** Approved remediation design in the parent conversation on 2026-09-20.

## Global Constraints

- Do not print, commit, delete, or rotate secret values from local environment files; report manual credential-rotation actions separately.
- Preserve stable `userId` ownership once a registration is claimed; email matching is only for unowned legacy rows.
- All payment, ticket-capacity, and registration deletion invariants must be enforced inside the database transaction that writes the state.
- Keep production PostgreSQL private to `quest-shared`; do not reintroduce host database publication to the steady-state Compose topology.
- Add regression tests before implementation where practical and run the owning package checks after each lane.
- Do not modify generated native output or commit ignored local artifacts.

---

### Task 1: Backend ownership and financial integrity

**Files:**
- Modify: `backend/src/modules/tournaments/registration.service.js`
- Modify: `backend/src/modules/tournaments/tournament.service.js`
- Modify: `backend/src/modules/auth/auth.service.js` only if ownership semantics require a helper adjustment
- Modify: `backend/src/modules/payments/payment.service.js`
- Modify: `backend/src/modules/tickets/ticket.service.js`
- Modify: `backend/src/modules/tickets/ticket.controller.js`
- Modify: `backend/src/lib/jobs.js`
- Test: relevant existing files under `backend/tests/` for registration, payment, tickets, jobs, and exports

**Interfaces:** Existing public service/controller contracts remain unchanged. New internal helpers may be added for `isOwnedRegistration`, transactional capacity checks, CSV formula neutralization, and job lease tokens.

- [ ] Add failing tests proving an owned registration cannot be found through a recycled captain email.
- [ ] Add failing concurrency tests for cancellation versus payment startup and capacity reduction versus order creation.
- [ ] Add failing tests for expired ticket PayHere reconciliation, repeated payment notification digests, and CSV formula prefixes.
- [ ] Add failing tests for job lease ownership: stale workers cannot complete or fail a job after reclamation.
- [ ] Change all registration lookup/mutation fallbacks so `{ captainEmail }` is paired with `userId: null`.
- [ ] Make cancellation eligibility and deletion one serializable transaction with a conditional unpaid/no-active-payment predicate.
- [ ] Recheck ticket expiry and capacity during manual PayHere acceptance inside the existing transaction.
- [ ] Make event capacity validation and update one serializable transaction.
- [ ] Reject already-recorded payment notification digests before applying state transitions.
- [ ] Add a shared CSV text sanitizer for spreadsheet-active prefixes.
- [ ] Add a unique lease token, heartbeat/lease refresh, and token-conditional terminal updates to background jobs.
- [ ] Run focused backend tests, then `npm run lint`, `npm test`, and `npm run test:coverage`.

### Task 2: FastAPI boundary hardening

**Files:**
- Modify: `valorant-platform-backend/app/services/auth_service.py`
- Modify: `valorant-platform-backend/app/schemas/auth.py`
- Modify: `valorant-platform-backend/app/api/routes/auth.py`
- Modify: `valorant-platform-backend/app/api/routes/health.py`
- Modify: `valorant-platform-backend/app/main.py`
- Modify: `valorant-platform-backend/app/schemas/match_search.py`
- Modify: `valorant-platform-backend/app/schemas/registration.py`
- Modify: `valorant-platform-backend/app/integrations/henrik/client.py`
- Modify: `valorant-platform-backend/app/config.py`
- Modify: `valorant-platform-backend/workers/discord_bot.py`
- Test: corresponding `valorant-platform-backend/tests/unit/` files

**Interfaces:** Keep Quest’s existing identity-check contract. If the legacy Discord login route remains, it must not return a provider access token and must validate an explicit state/replay contract; otherwise remove only the unused public route and its tests.

- [ ] Add tests for invalid health authorization returning no readiness detail.
- [ ] Add tests for encoded/rejected Henrik path segments and bounded numeric settings.
- [ ] Add tests that repeated Discord `on_ready` events do not start duplicate loops.
- [ ] Add tests for the chosen legacy OAuth behavior and provider-token non-disclosure.
- [ ] Implement the smallest compatible hardening changes, preserving service-token verification and Quest identity checks.
- [ ] Run `ruff check app workers tests scripts` and `pytest -m "not live" -q`.

### Task 3: Mobile operator safety and privacy

**Files:**
- Modify: `mobile-admin/src/types.ts`
- Modify: `mobile-admin/src/components/DetailModal.tsx`
- Modify: `mobile-admin/app/(tabs)/orders.tsx`
- Modify: `mobile-admin/app/(tabs)/payments.tsx`
- Modify: `mobile-admin/app/(tabs)/registrations.tsx`
- Modify: `mobile-admin/app/resources/[kind].tsx`
- Modify: `mobile-admin/app/expenses.tsx`
- Modify: `mobile-admin/app/match-room/[code].tsx`
- Modify: `mobile-admin/app/veto-room/[id].tsx`
- Modify: `mobile-admin/src/api.ts` and `mobile-admin/src/auth.tsx` if session-invalid handling needs centralization
- Test: `mobile-admin/tests/` new focused tests for redaction, confirmations, draft preservation, and minimal mutation payloads

**Interfaces:** Preserve existing API endpoints unless a minimal-patch endpoint is already available. Keep admin list/detail rendering explicit rather than generic for sensitive fields.

- [ ] Add tests proving capability tokens and secret-like fields never render in the generic modal.
- [ ] Add tests proving failed sends preserve drafts and successful sends clear them.
- [ ] Add tests proving destructive actions require confirmation and financial inputs reject blank values.
- [ ] Add tests proving role/status mutations send only intended fields.
- [ ] Redact capability tokens by response mapping and modal allowlist.
- [ ] Add confirmations and required trimmed input validation to high-impact actions.
- [ ] Clear drafts only after successful requests and centralize session-invalid handling.
- [ ] Run `npm run typecheck`, `npm test`, `npm run doctor`, and the dependency audit.

### Task 4: Frontend runtime and accessibility fixes

**Files:**
- Modify: `frontend/components/tickets/TicketCheckout.tsx`
- Modify: `frontend/components/gallery/EventAlbumBrowser.tsx`
- Modify: `frontend/components/veto/VetoRoomView.tsx`
- Modify: `frontend/app/players/[publicId]/page.tsx`
- Modify: `frontend/app/matches/[id]/page.tsx`
- Add or modify: relevant route loading boundaries only where existing app conventions support them
- Test: focused files under `frontend/tests/unit/`

**Interfaces:** Preserve approved visual hierarchy and existing API contracts. Redirects must accept only same-origin relative order paths or an explicit allowlist.

- [ ] Add tests for redirect allowlisting, delayed blob URL revocation, and dialog focus/restore.
- [ ] Memoize duplicate metadata/page loaders without changing rendered data.
- [ ] Add focus transfer, keyboard trap/escape handling, and focus restoration to the veto dialog.
- [ ] Add safe order-path validation before navigation.
- [ ] Delay gallery object URL revocation until the browser has consumed the download.
- [ ] Run frontend lint, typecheck, unit tests, and production build with explicit HTTPS production origins.

### Task 5: Release, documentation, and dependency contracts

**Files:**
- Modify: `.github/workflows/release-admin-apk.yml`
- Modify: `mobile-admin/README.md` only if release verification instructions change
- Modify: `docs/backup-and-disaster-recovery.md`
- Modify: `docs/database-and-storage.md` and `docs/setup-and-deployment.md` where active topology statements are stale
- Modify: `frontend/package.json` and lockfile only after confirming a compatible Vitest security update
- Add: CI/static tests for signing certificate verification and active recovery topology where missing

**Interfaces:** Do not change protected secret names or production deployment authority. Documentation must distinguish historical plans from active runbooks.

- [ ] Add a release step deriving the APK signing certificate fingerprint and comparing it with the protected expected value.
- [ ] Correct active recovery instructions to distinguish private backup access from loopback-only staging restore access.
- [ ] Correct the Windows backup documentation to state that both `public` and `valorant` schemas are included.
- [ ] Upgrade affected frontend development dependencies only if lockfile and tests remain compatible.
- [ ] Run workflow/documentation contract tests and inspect all diffs for secret values.

### Task 6: Final verification and handoff

**Files:** No source ownership; verification only.

- [ ] Inspect `git status`, `git diff --check`, and the complete diff; ensure no environment, generated, or secret files are staged/modified.
- [ ] Run backend, frontend, mobile, and VALORANT checks from the repository README.
- [ ] Run Linux shell/Compose contract suites in CI or a Linux-capable environment; document the Windows Bash limitation if still present.
- [ ] Re-run focused regression tests for every finding addressed.
- [ ] Report unresolved findings and manual credential rotation steps separately.
