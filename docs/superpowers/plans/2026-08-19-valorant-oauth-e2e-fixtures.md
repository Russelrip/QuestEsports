# OAuth E2E Fixture Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OAuth E2E command generate and clean its own disposable test accounts from one existing PostgreSQL database URL.

**Architecture:** A backend-owned CommonJS fixture script will migrate the dedicated database, create run-scoped users/sessions/OAuth rows, write a mode-0600 JSON manifest to a runner-provided temporary path, and clean only those rows later. The frontend runner will invoke prepare before starting the existing fake provider/real backend/real frontend stack and cleanup in `finally` after children stop.

**Tech Stack:** Node 24, Prisma, PostgreSQL, bcryptjs, Playwright, existing OAuth fake provider and runner.

**Spec:** `docs/superpowers/specs/2026-08-19-valorant-oauth-e2e-fixtures-design.md`

## Global Constraints

- Require an existing dedicated disposable PostgreSQL database; do not create or drop databases.
- Require loopback database hosts and a database name containing `test`, `e2e`, or `oauth`; apply this safety check to both database URLs with no production bypass.
- Require only the existing dedicated disposable `OAUTH_E2E_DATABASE_URL`; default `OAUTH_E2E_DIRECT_URL` to it when omitted and default `OAUTH_E2E_SESSION_COOKIE_NAME` to `quest_test_session`.
- Generate fixture passwords, emails, usernames, provider IDs, and session cookies; never log secrets.
- Initial state: link target, collision target, collision owner, and safe-unlink account have no linked providers; last-method account has only Google OAuth.
- Use bcrypt cost 10, verified email state, and `passwordSetAt` only for real-password fixtures.
- Run cleanup after child process termination and preserve the first test/cleanup failure.
- Keep production OAuth endpoints and dotenv behavior unchanged.

---

### Task 1: Backend fixture manifest and seed/cleanup script

**Files:**
- Create: `backend/scripts/oauth-e2e-fixtures.js`
- Create: `backend/tests/oauth-e2e-fixtures.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- `node scripts/oauth-e2e-fixtures.js prepare --manifest <path>` reads `OAUTH_E2E_DATABASE_URL`, optional `OAUTH_E2E_DIRECT_URL`, `OAUTH_E2E_RUN_ID`, and `SESSION_COOKIE_NAME`; writes one mode-0600 JSON manifest to the path and prints no manifest (only a safe marker, if any).
- `node scripts/oauth-e2e-fixtures.js cleanup --manifest <path>` deletes rows identified by the manifest and exits nonzero on failure.
- Manifest fields: `runId`, `sessionCookieName`, `users` keyed by `link`, `collisionTarget`, `collisionOwner`, `safeUnlink`, `lastMethod`; each user contains `id`, `email`, `password`; `collisionProviderUserId`; `lastMethodCookie`.
- Tests mock Prisma/session dependencies or use pure manifest helpers so they run without PostgreSQL.

- [ ] **Step 1: Add failing manifest/helper tests** — Cover deterministic run-scoped email/username/provider ID generation, no password logging in serialized output, normal users marked with `passwordSetAt`, OAuth-only last-method user omitted from password marker, and cleanup where clauses containing only generated IDs.
- [ ] **Step 2: Implement fixture generation and validation** — Use `crypto.randomUUID/randomBytes`, `bcrypt.hash(password, 10)`, verified email timestamps, and unique usernames. Reject non-test/production `NODE_ENV` and missing database URL.
- [ ] **Step 3: Implement Prisma prepare** — Run `prisma migrate deploy` before inserts, create five users, seed one Google OAuthAccount for last-method, call `createSession` for its raw token, and write the manifest only to the mode-0600 path supplied by `prepare --manifest`.
- [ ] **Step 4: Implement cleanup** — Delete generated OAuth accounts and sessions before users, constrain every delete by manifest IDs, and make cleanup idempotent.
- [ ] **Step 5: Add the backend script command and run focused tests** — Add `test:oauth:e2e:fixtures` to `backend/package.json`; run `node --test tests/oauth-e2e-fixtures.test.js` and backend lint.

### Task 2: Integrate bootstrap with the OAuth E2E runner

**Files:**
- Modify: `frontend/scripts/run-oauth-e2e.mjs`
- Modify: `frontend/tests/e2e/account-linking.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-19-valorant-oauth-account-linking.md`
- Modify: `.superpowers/sdd/2026-08-19-valorant-oauth-account-linking/progress.md`

**Interfaces:**
- Runner accepts only `OAUTH_E2E_DATABASE_URL` plus optional `OAUTH_E2E_DIRECT_URL` and `OAUTH_E2E_SESSION_COOKIE_NAME`.
- Runner invokes prepare with a unique temporary manifest file, reads/validates that file without logging it, maps generated values to the existing `OAUTH_E2E_*` Playwright variables, and invokes cleanup on the same file in `finally` whenever prepare reports success.

- [x] **Step 1: Add prepare/cleanup process helpers** — Spawn the backend script with an allowlisted environment, capture the safe prepare result, read exactly one manifest JSON from the mode-0600 path without printing it, and use a unique system temporary directory for cleanup.
- [x] **Step 2: Replace fixture credential validation** — Remove the eleven manually supplied account/password/cookie requirements and validate the generated manifest environment instead; retain the dedicated database safety check.
- [x] **Step 3: Wire cleanup ordering** — Stop Playwright/frontend/backend/provider, run cleanup, and combine exit codes so the first Playwright failure is retained while cleanup failures are reported.
- [x] **Step 4: Update fixture contract documentation** — Document that only the disposable DB URL is user-supplied and list the generated initial states.
- [ ] **Step 5: Run runner guard and syntax checks** — Verify missing `OAUTH_E2E_DATABASE_URL` fails before prepare and `node --check` passes for runner/provider/script.

### Task 3: Verification and final review

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run backend fixture/OAuth/OpenAPI tests** — Use the repository test database placeholders for non-integration tests.
- [ ] **Step 2: Run backend lint and frontend typecheck/lint** — Confirm no new errors; existing warnings may remain documented.
- [ ] **Step 3: Run `npm run test:e2e:oauth`** — With the existing disposable PostgreSQL URL, confirm all Chromium/Firefox/Mobile Safari projects run and cleanup removes generated rows.
- [ ] **Step 4: Inspect diff/status and request independent review** — Confirm no secrets, generated manifests, or unrelated files are included.
