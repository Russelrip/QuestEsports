# Data Egress Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser navigation, payment submission, and backend observability fail closed at untrusted or misconfigured egress boundaries.

**Architecture:** Add a small frontend URL-policy module for same-origin paths and PayHere origins, use it from notifications, payments, and API URL construction, and keep the service-worker policy local because the public worker is not bundled with application modules. Add an explicit backend observability host allowlist in environment configuration, enforce it again in the transport, and sanitize remote payloads without removing useful local console diagnostics.

**Tech Stack:** Next.js 16, React 19, TypeScript, browser service worker JavaScript, Node.js CommonJS, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-data-egress-hardening-design.md`

## Global Constraints

- Do not print, commit, or add any real secret from `.env`.
- Do not add a dependency.
- Preserve valid same-origin navigation, PayHere live/sandbox behavior, and local observability logging.
- Invalid external destinations must fail closed; they must never be submitted or opened.
- Remote observability payloads must not contain `stack`, raw upstream response bodies, or credential-bearing values.
- Use the existing test commands: `npm test` in `frontend` and `npm test` in `backend`.

---

### Task 1: Add frontend destination policies

**Files:**
- Create: `frontend/lib/safe-url.ts`
- Modify: `frontend/lib/api.ts:57-70`
- Modify: `frontend/lib/payments.ts:1-20`
- Test: `frontend/tests/unit/api.test.ts`
- Create: `frontend/tests/unit/safe-url.test.ts`
- Create: `frontend/tests/unit/payments.test.ts`

**Interfaces:**
- `normalizeSameOriginPath(value: string | null | undefined, fallback: string): string` returns a relative path beginning with `/`, rejects protocol-relative URLs, non-HTTP schemes, credentials, and foreign origins, and preserves valid query/hash values.
- `isAllowedPayHereActionUrl(value: string): boolean` accepts only HTTPS origins `sandbox.payhere.lk` and `www.payhere.lk` with no credentials.
- `buildApiUrl` must no longer return an arbitrary absolute URL unchanged; external media callers continue to use an explicit public-resource path where already supported.

- [ ] **Step 1: Write failing URL-policy tests**

  Cover `/match-room/abc?tab=veto`, `https://questesports.lk/profile` as a rejected foreign absolute URL, `//attacker.example`, `javascript:`, `data:`, `blob:`, malformed values, and a fallback to `/profile`. Cover PayHere live/sandbox hosts and reject HTTP, lookalike hosts, credentials, and unrelated origins.

- [ ] **Step 2: Run the focused frontend tests and confirm failure**

  Run from `frontend`:

  ```powershell
  npm test -- tests/unit/safe-url.test.ts tests/unit/payments.test.ts tests/unit/api.test.ts
  ```

  Expected: the new policy tests fail because the policy functions are not yet present and the existing absolute-URL expectation conflicts with the approved fail-closed behavior.

- [ ] **Step 3: Implement the policy and integrate API/payment helpers**

  Keep parsing based on `URL`. For API paths, allow only relative paths or URLs whose origin equals the configured API origin; reject all other absolute destinations rather than returning them unchanged. In `submitPayHereCheckout`, validate `actionUrl` before creating or submitting the form and throw a stable user-safe error without appending a form for invalid destinations.

- [ ] **Step 4: Update focused tests for the new contract and run them**

  Replace the old “preserves absolute resources” API expectation with a rejection/fallback assertion, retain configured API-origin behavior, and assert invalid checkout URLs do not call `form.submit`.

  Run:

  ```powershell
  npm test -- tests/unit/safe-url.test.ts tests/unit/payments.test.ts tests/unit/api.test.ts
  npm run typecheck
  ```

  Expected: all focused tests and the TypeScript check pass.

### Task 2: Harden notification and service-worker navigation

**Files:**
- Modify: `frontend/components/notifications/NotificationBell.tsx:10-20,206-218`
- Modify: `frontend/public/quest-sw.js:1-19`
- Create or modify: `frontend/tests/unit/notification-navigation.test.tsx`
- Create or modify: `frontend/tests/unit/service-worker-navigation.test.ts`

**Interfaces:**
- `NotificationBell` must pass every API-provided `actionUrl` through `normalizeSameOriginPath`, not only support notifications.
- The worker must normalize `event.notification.data.url` against `self.location.origin`, reject foreign origins and unsupported schemes, and skip `clients.openWindow` for invalid input.

- [ ] **Step 1: Write failing component and worker tests**

  Render a notification with an external `actionUrl` and assert the link resolves to `/profile` (or the documented safe fallback). Exercise the worker click handler with `/match-room/abc`, `https://attacker.example/steal`, `//attacker.example/steal`, and `javascript:alert(1)`; only the local path may reach `openWindow`.

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run from `frontend`:

  ```powershell
  npm test -- tests/unit/notification-navigation.test.tsx tests/unit/service-worker-navigation.test.ts
  ```

  Expected: external destinations are currently observed as links/open-window targets.

- [ ] **Step 3: Integrate the shared policy into notifications and duplicate only the minimal worker-safe validator**

  Preserve the existing support fallback and read-marking behavior. The worker must never navigate to an external origin, even if a future backend notification producer is compromised.

- [ ] **Step 4: Run focused tests and frontend lint**

  Run:

  ```powershell
  npm test -- tests/unit/notification-navigation.test.tsx tests/unit/service-worker-navigation.test.ts
  npm run lint
  ```

  Expected: both policy boundaries pass and no lint errors are introduced.

### Task 3: Enforce backend observability egress and remote-payload sanitization

**Files:**
- Read/update nearest responsibility docs: `backend/src/modules/*/codemap.md` only if a mapped responsibility changes; otherwise no codemap edit is required.
- Modify: `backend/src/config/env.js:433-437,539-556`
- Modify: `backend/src/lib/observability-transport.js:13-42,79-92`
- Modify: `backend/src/lib/monitoring.js:5-11,47-81`
- Modify: `backend/src/lib/logger.js:84-123`
- Test: `backend/tests/observability.test.js`
- Test: `backend/tests/env.test.js`

**Interfaces:**
- Add `OBSERVABILITY_ALLOWED_HOSTS` as a comma-separated host list in `env`; in production, configured observability URLs require this non-empty list.
- Export a pure transport validator such as `isAllowedObservabilityUrl(url, allowedHosts)` for direct unit testing. It must require HTTPS, reject credentials, and compare exact lowercase hostnames.
- `schedulePostJson` must reject an invalid destination before queueing or calling `fetch`.
- Remote log payloads must sanitize error objects by removing `stack` and raw response/body fields while retaining redacted message/name/code fields.

- [ ] **Step 1: Add failing backend tests**

  Add tests for missing production allowlist, non-HTTPS destinations, credentials, lookalike hosts, valid exact hosts, and the guarantee that invalid destinations do not call `fetch`. Extend monitoring/logger assertions to prove remote payloads omit stack and raw upstream body while local console logging still preserves existing diagnostic behavior.

- [ ] **Step 2: Run the focused backend tests and confirm failure**

  Run from `backend`:

  ```powershell
  node --test tests/observability.test.js tests/env.test.js
  ```

  Expected: new allowlist and remote-sanitization assertions fail against the current unrestricted transport/payloads.

- [ ] **Step 3: Implement environment validation, transport enforcement, and sanitization**

  Normalize hosts once in `env.js`. Keep Discord URL shape validation, and apply the same explicit host policy to all remote observability URLs. Make invalid configured sinks inert in non-production and fail fast in production when a configured sink lacks an approved host. Do not log the rejected URL's token or credential components.

- [ ] **Step 4: Run focused tests, backend lint, and full backend tests**

  Run:

  ```powershell
  node --test tests/observability.test.js tests/env.test.js
  npm run lint
  npm test
  ```

  Expected: focused tests, lint, and the complete Node test suite pass without making real outbound requests.

### Task 4: Integrate verification and operational checks

**Files:**
- Modify: `docs/environment-reference.md` with the non-secret `OBSERVABILITY_ALLOWED_HOSTS` contract.
- Modify: `docs/production-runbook.md` or the nearest existing secret-rotation section with the `HENRIK_API_KEY` rotation and log-review steps.

- [ ] **Step 1: Document the new non-secret configuration contract**

  Document hostnames only, never webhook URLs containing tokens. State that production observability sinks are disabled or fail startup unless every configured hostname is explicitly approved.

- [ ] **Step 2: Run repository checks without exposing `.env`**

  Run from the repository root:

  ```powershell
  git ls-files .env
  git log --all -- .env
  git grep -nEi "telemetry|analytics|postinstall|preinstall|sourceMappingURL" -- ":!*.lock"
  ```

  Expected: `.env` is not tracked, no secret value is printed, and no new unapproved telemetry path appears.

- [ ] **Step 3: Run final frontend and backend verification**

  Run:

  ```powershell
  npm test
  npm run typecheck
  npm run lint
  ```

  from `frontend`, then `npm test` and `npm run lint` from `backend`. Record failures as known limits rather than weakening security assertions.

## Final evidence

- Frontend tests prove all notification and API navigation inputs fail closed for foreign origins and dangerous schemes.
- Payment tests prove only the two configured PayHere origins receive POST forms.
- Backend tests prove observability fetch is never called for invalid destinations and remote payloads omit stack/raw body data.
- Full frontend/backend tests and static checks pass.
- Secret scan confirms `.env` remains untracked; credential rotation remains an operational action outside this code change.
