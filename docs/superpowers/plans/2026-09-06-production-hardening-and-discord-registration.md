# Production Hardening and Discord-Required VALORANT Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a linked Discord identity on every Quest-authenticated VALORANT registration, expose it read-only in the private profile and registration form, and remediate the confirmed production, reliability, dependency, and documentation risks from the audit.

**Architecture:** Reuse the existing Quest OAuth-link flow and `OAuthAccount(provider="discord")` as the identity source. Registration routes require a Quest session and derive Discord identity server-side; the frontend only displays the linked identity and submits a PUUID. Independent hardening lanes address Discord role mutation, VALORANT production readiness, frontend reliability, mobile/CI, and documentation without overlapping writer ownership.

**Tech Stack:** Express 5, Prisma/PostgreSQL, FastAPI/Pydantic/SQLAlchemy, Next.js 16/React 19, Expo SDK 57, Vitest, Node test runner, Ruff/pytest, Docker Compose, Nginx, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-production-hardening-and-discord-registration-design.md`

## Global Constraints

- VALORANT registration requires an authenticated Quest account and a linked Discord `OAuthAccount`.
- `discordId` is private account/admin data only; it is never added to public player projections.
- Client-submitted Discord IDs/usernames must never override the server-derived linked identity.
- Existing Quest OAuth-link state, nonce, PKCE, callback-cookie, CSRF, and origin protections remain authoritative.
- Do not add a new identity table or embed real secrets in source, examples, tests, or documentation.
- Do not apply breaking dependency upgrades solely through `npm audit fix --force`.
- Production topology is immutable Docker Compose on the Quest VPS; Vercel/PM2 instructions are historical or non-production.
- Every task must add or update focused tests before implementation and run its relevant checks.
- Do not commit, push, or alter Git configuration.

---

### Task 1: Backend Discord identity projection and registration authorization

**Writer owner:** backend fixer. **Validation owner:** parent orchestrator.

**Files:**
- Modify: `backend/src/modules/auth/session.service.js` (the authenticated-user projection and session mapping)
- Modify: `backend/src/modules/valorant-leaderboard/controller.js`
- Modify: `backend/src/modules/valorant-leaderboard/service.js`
- Modify: `backend/src/routes/v1.js:175-181`
- Modify: `backend/src/modules/auth/auth.routes.js` only if the existing linked-provider response needs a private `discordId` field
- Test: existing `backend/tests/valorant-leaderboard.controller.test.js`, `backend/tests/valorant-leaderboard.client.test.js`, and the nearest auth/session tests

**Interfaces:**
- Consumes: `req.user.id` from `attachSession`; Prisma `OAuthAccount` rows with `provider = "discord"`.
- Produces: authenticated registration handlers that accept `{ puuid }`, derive `{ discordId, discordUsername }`, and return stable `DISCORD_LINK_REQUIRED` errors.

- [ ] **Step 1: Write failing backend tests** for anonymous `401`, authenticated-but-unlinked `403 DISCORD_LINK_REQUIRED`, linked-user derivation, forged Discord field rejection/ignoring, and all three stateful endpoints requiring auth.
- [ ] **Step 2: Run focused tests** with `npm test -- tests/valorant-leaderboard.controller.test.js tests/valorant-leaderboard.client.test.js`; verify the new cases fail for the current public route and client-trusted identity behavior.
- [ ] **Step 3: Add a private linked-Discord resolver** that queries only the authenticated user's Discord OAuth account, preferring `providerUserId` as canonical ID and current stored display data for the username.
- [ ] **Step 4: Apply `requireAuth`** to check-PUUID, preview, and submit routes; remove the leaderboard-specific Discord login/callback routes from the active registration contract.
- [ ] **Step 5: Change submit/preview service calls** so the controller accepts only PUUID and passes the server-derived Discord identity to the upstream service. Reject or ignore legacy identity fields without using them.
- [ ] **Step 6: Run the focused tests** and then `npm run lint`; expected result is all focused cases passing and no new lint errors.

### Task 2: Private profile Discord ID and registration UX

**Writer owner:** designer. **Validation owner:** parent orchestrator.

**Files:**
- Modify: `backend/src/modules/auth/session.service.js` only if Task 1 does not expose the private ID
- Modify: `frontend/components/auth/AccountLinkingPanel.tsx`
- Modify: `frontend/components/auth/ProfileView.tsx` only where the private connected-account section is mounted
- Modify: `frontend/components/valorant/ValorantRegistration.tsx`
- Modify: `frontend/app/valorant-leaderboard/register/page.tsx` if route-level auth state is needed
- Modify: `frontend/lib/valorant-api.ts`
- Modify: `frontend/lib/account-linking.ts` only for existing-link refresh behavior
- Test: `frontend/tests/unit/account-linking.test.tsx`, `frontend/tests/unit/account-linking-client.test.ts`, and a new/updated registration unit test

**Interfaces:**
- Consumes: authenticated session user with nullable private `discordId`/`discordTag`; existing account-linking redirect URL.
- Produces: read-only connected Discord display and PUUID-only registration request.

- [ ] **Step 1: Write failing UI tests** for private ID rendering, no editable Discord input, anonymous sign-in state, authenticated-unlinked connect state, linked-user read-only autofill, and submit payload containing only PUUID.
- [ ] **Step 2: Run those tests** with `npx vitest run tests/unit/account-linking.test.tsx tests/unit/account-linking-client.test.ts <registration-test> --maxWorkers=1`; confirm failures.
- [ ] **Step 3: Replace standalone registration OAuth state** with the existing `/api/v1/auth/oauth/discord/link` flow and refresh session/profile state after callback completion.
- [ ] **Step 4: Render private connected Discord ID/username read-only** and clear it on unlink; keep public player components unchanged.
- [ ] **Step 5: Implement the registration state machine**: anonymous sign-in prompt, authenticated-unlinked connect prompt, linked read-only identity plus PUUID form, and no registration request until linked.
- [ ] **Step 6: Change `submitValorantRegistration`** to send only `{ puuid }`, while retaining a compatibility type that cannot serialize editable Discord fields.
- [ ] **Step 7: Run focused UI tests, `npm run typecheck`, and `npm run lint`; expected result is all pass with no new warnings.

### Task 3: Safe Discord role reconciliation

**Writer owner:** Python fixer. **Validation owner:** parent orchestrator.

**Files:**
- Read first: `valorant-platform-backend/codemap.md`
- Modify: `valorant-platform-backend/workers/discord_bot.py:174-239`
- Test: `valorant-platform-backend/tests/unit/test_discord_bot.py`

**Interfaces:**
- Consumes: rank-role names, `Unverified`, `Manual`, and Discord member role collections.
- Produces: role updates that mutate only bot-managed roles and preserve unrelated roles.

- [ ] **Step 1: Add failing async interaction tests** for registered members, unregistered members, `Manual` members, unrelated roles, and bot members.
- [ ] **Step 2: Run `pytest tests/unit/test_discord_bot.py -q`** through the repository-managed environment; confirm the destructive behavior is caught.
- [ ] **Step 3: Compute the managed-role allowlist** from rank-role names plus `Unverified`; filter removals to that allowlist only.
- [ ] **Step 4: Check `Manual` before nickname or role mutation** and preserve all unrelated roles in every branch.
- [ ] **Step 5: Run the focused tests and Ruff**; expected result is role-preservation coverage and no lint errors.

### Task 4: VALORANT production settings, readiness, and edge security

**Writer owner:** deployment fixer. **Validation owner:** parent orchestrator.

**Files:**
- Read first: `valorant-platform-backend/codemap.md`
- Modify: `valorant-platform-backend/app/config.py`
- Modify: `valorant-platform-backend/app/api/routes/health.py`
- Modify: `valorant-platform-backend/app/api/dependencies.py` only if readiness probes need a non-mutating service-token check
- Modify: `ops/docker/valorant.production.env.example`
- Modify: `ops/docker/valorant.production.compose.yml` if healthcheck/readiness wiring changes
- Modify: `ops/deploy/host-hooks.sh:531-540`
- Modify: `ops/deploy/verify-release.sh` and/or `ops/deploy/validate-host.sh` for release checks
- Modify: `ops/docker/nginx/quest.conf:103-141`
- Test: relevant `valorant-platform-backend/tests/unit/test_production_contract.py`, `test_health.py`, `test_contract_pins.py`, `test_write_freeze.py`, and shell contract tests under `ops/tests/`

**Interfaces:**
- Consumes: production env file, mounted TLS material, service-token configuration, worker commands.
- Produces: fail-closed production startup/readiness and release verification that cannot declare an unusable VALORANT integration healthy.

- [ ] **Step 1: Add failing settings tests** for missing production service secrets, Henrik credentials, Discord worker credentials, OAuth redirect origin, and invalid TLS/configuration.
- [ ] **Step 2: Add failing readiness/release tests** proving database-only health cannot authorize integration readiness and worker admission checks each required writer.
- [ ] **Step 3: Implement production-only validation** while preserving development/test defaults.
- [ ] **Step 4: Expand the safe env template** with every required key name and non-secret placeholder shape.
- [ ] **Step 5: Add non-mutating integration readiness checks** for service-token configuration and required external settings; keep health probes safe under write freeze.
- [ ] **Step 6: Change the Nginx HTTP edge contract** to reject/redirect plaintext only with the documented Full (strict) Cloudflare prerequisite and preserve ACME handling.
- [ ] **Step 7: Run Python unit/contract tests, shell tests, and static config validation**; expected result is all pass without exposing secrets.

### Task 5: Frontend runtime reliability, lint, and test determinism

**Writer owner:** frontend fixer. **Validation owner:** parent orchestrator.

**Files:**
- Modify: `frontend/proxy.ts:24-28`
- Modify: `frontend/components/match-rooms/MatchRoomView.tsx:74-88`
- Modify: `frontend/components/notifications/NotificationBell.tsx:57-66`
- Modify: `frontend/components/recruitment/RecruitmentForm.tsx:91`
- Modify: `frontend/components/valorant/ValorantLeaderboard.tsx:270`
- Modify: `frontend/components/posters/AdminPosterStudio.tsx:2`
- Modify: `frontend/components/admin/AdminMediaManager.tsx:2`
- Modify: `frontend/tests/unit/veto-room-view.test.tsx:12`
- Modify: `frontend/vitest.config.ts` and `frontend/package.json` for bounded workers and coverage thresholds
- Test: corresponding existing component tests plus new malformed-config, cancellation/error, and hostile structured-data tests

**Interfaces:**
- Consumes: existing `getConfiguredApiOrigin` behavior, realtime subscription cleanup, Vitest test configuration.
- Produces: safe proxy configuration, coalesced/cancellable refreshes, no unjustified hook suppressions, and deterministic test execution.

- [ ] **Step 1: Add failing tests** for malformed proxy API URL, overlapping refresh cancellation, polling failure retry state, and hostile JSON-LD serialization.
- [ ] **Step 2: Run focused tests** with bounded workers and confirm failures.
- [ ] **Step 3: Reuse safe API-origin parsing** in `proxy.ts` and return a safe CSP without throwing on malformed runtime values.
- [ ] **Step 4: Add abort/coalescing/visibility handling** to polling and realtime refresh effects, preserving existing UI layout and copy intent.
- [ ] **Step 5: Refactor effect dependencies** instead of suppressing exhaustive-deps; replace raw image usage with optimized components or narrow exceptions.
- [ ] **Step 6: Fix test image alt/unoptimized warnings** and configure Vitest worker limits plus a documented coverage provider/threshold.
- [ ] **Step 7: Run `npm run lint`, `npm run typecheck`, bounded unit tests, and production build with valid HTTPS env**; expected result is no lint warnings, all tests pass, and build succeeds.

### Task 6: Mobile dependency and native-build validation

**Writer owner:** mobile fixer. **Validation owner:** parent orchestrator.

**Files:**
- Modify: `mobile-admin/package.json` and lockfile only after selecting a compatible fixed dependency path
- Modify: `.github/workflows/ci.yml:946-983`
- Test: mobile package tests and new CI contract test if the workflow test suite asserts job contents

**Interfaces:**
- Consumes: Expo SDK 57 dependency constraints and Android release configuration.
- Produces: dependency audit without forced breaking changes and CI validation of native Android compilation.

- [ ] **Step 1: Determine a compatible fixed dependency/version** from the Expo-compatible graph; do not run `npm audit fix --force`.
- [ ] **Step 2: Add/update a dependency contract test** proving the selected graph has no vulnerable decode URI package or has a documented safe patched path.
- [ ] **Step 3: Update CI** to run reproducible Expo prebuild/Android build validation in an appropriate scheduled/release job.
- [ ] **Step 4: Run mobile typecheck, tests, audit, and Expo Doctor**; record any host-only Android limitation explicitly.

### Task 7: Documentation and contract cleanup

**Writer owner:** documentation fixer. **Validation owner:** parent orchestrator.

**Files:**
- Modify: `README.md:11,17-20,116-135`
- Modify: `docs/setup-and-deployment.md:28,450-560,694-716`
- Modify: `docs/ci-cd.md:3-5,26-56`
- Modify: `docs/production-runbook.md:1221-1226`
- Modify: `docs/environment-reference.md`
- Modify: `frontend/README.md`, `backend/README.md`, `mobile-admin/README.md`, and `valorant-platform-backend/README.md` only where commands/contracts are stale
- Modify: `docs/api-documentation.md` for the authenticated PUUID-only registration contract
- Modify: relevant codemaps when responsibility/data flow changes
- Test: documentation contract tests and a repository-relative Markdown link checker

**Interfaces:**
- Consumes: final APIs and release contracts from Tasks 1–6.
- Produces: one consistent operator/developer contract with no stale production path.

- [ ] **Step 1: Add/update documentation contract tests** for the Compose production topology, HTTP local VALORANT URL, Python support, authenticated registration, and required release gates.
- [ ] **Step 2: Update all affected guides** after code contracts stabilize; mark generic `npm start`/Vercel instructions non-production or historical.
- [ ] **Step 3: Document private read-only Discord profile behavior** and registration prerequisites.
- [ ] **Step 4: Add protected E2E, coverage, Android build, and VALORANT `uv` verification commands.**
- [ ] **Step 5: Run link validation and documentation contract tests**; expected result is no broken relative links or contradictory current-state claims.

### Task 8: Integrated verification and reconciliation

**Owner:** parent orchestrator.

**Files:** No planned source changes; only reconcile prior lane edits.

- [ ] **Step 1: Inspect `git diff`, `git status`, and all writer outputs**; remove unintended generated files and resolve overlapping edits without flattening intentional frontend design.
- [ ] **Step 2: Run backend lint/tests/coverage and focused integration tests.**
- [ ] **Step 3: Run frontend lint/typecheck/bounded unit tests/build and relevant E2E tests.**
- [ ] **Step 4: Run mobile typecheck/tests/audit/Doctor/native validation as available.**
- [ ] **Step 5: Run repository-managed VALORANT Ruff/pytest and protected two-service E2E where isolated environments are available.**
- [ ] **Step 6: Run deployment shell/config/documentation contract tests and inspect secret tracking.**
- [ ] **Step 7: Report any environment-gated checks separately from code failures; do not claim completion until all required evidence is recorded.**

## Plan self-review

- Registration, private profile display, and autofill are covered by Tasks 1–2.
- Discord destructive-role behavior is covered by Task 3.
- Production settings, health, release gates, TLS edge, and image/deployment risk are covered by Task 4.
- Frontend URL, polling, hooks, images, warnings, tests, and coverage are covered by Task 5.
- Mobile vulnerability and native CI are covered by Task 6.
- URL/version/topology/API/E2E documentation is covered by Task 7.
- Final evidence and clean-tree checks are covered by Task 8.
- No unresolved `TBD`, `TODO`, or implementation placeholders appear in the plan.
