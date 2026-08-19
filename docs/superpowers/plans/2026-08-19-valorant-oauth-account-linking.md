# Valorant OAuth Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users safely link and unlink Google and Discord OAuth identities from profile settings without changing existing login behavior.

**Architecture:** Add link-specific OAuth state and callback flows alongside, but separate from, login callbacks. Provider identity is always derived server-side; the existing `OAuthAccount(provider, providerUserId)` uniqueness remains the collision boundary. A dedicated provider-status API feeds the profile account-linking panel.

**Tech Stack:** Express, Prisma/PostgreSQL, existing OAuth provider clients/state/PKCE helpers, Node `node:test`, Next.js, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-valorant-support-contact-design.md`

## Global Constraints

- Support only existing Google and Discord OAuth identities; do not add public social profile URLs or handles.
- OAuth state and PKCE validation remain mandatory.
- The callback derives provider identity from the provider response; the browser cannot submit a provider ID to link.
- Reject provider identities already owned by another account.
- Do not create or replace a session during account-link callbacks.
- Reject unlinking when no verified password and no other linked OAuth provider would remain.
- Keep existing Google/Discord login start and callback behavior unchanged.
- Validate provider values against `google|discord` and never accept client-supplied user IDs.

---

### Task 1: Add link-specific OAuth service behavior with tests

**Files:** Modify `backend/prisma/schema.prisma`, `backend/prisma/codemap.md`, `backend/src/modules/auth/oauth.service.js`, `backend/src/modules/auth/auth.service.js`, `backend/src/modules/admin/admin.service.js`, `backend/tests/oauth.service.test.js`, and `backend/tests/auth.service.test.js`; create `backend/prisma/migrations/20260819170000_add_oauth_link_safety/migration.sql`.

**Interfaces:** Consume existing state, authorization, PKCE, flow-cookie, token-exchange, provider-profile, Prisma `OAuthAccount`, and password verification helpers. Export `createOAuthLinkAuthorization({ provider, userId, redirectTo })`, `handleOAuthLinkCallback({ provider, code, state, flowToken, userId })`, `listLinkedOAuthProviders(userId)`, and `unlinkOAuthProvider({ userId, provider })`. Add `User.passwordSetAt` and durable `OAuthLinkNonce` records; link callbacks use a dedicated `/link/callback` provider URL and link-specific cookie, while login callbacks reject link payloads. Unlink uses a serializable transaction.

- [ ] **Step 1: Write failing service tests** — Cover authenticated-user state binding and PKCE, successful link creation, provider collision, mismatched callback user, state/cookie reuse rejection, and last-login-method protection. Include this collision assertion:

```js
test("link callback rejects a provider account owned by another user", async () => {
  prisma.oAuthAccount.findUnique.mockResolvedValue({ userId: "other-user" });
  await assert.rejects(
    oauthService.handleOAuthLinkCallback({ provider: "discord", code: "code", state: "state", flowToken: "flow", userId: "user-1" }),
    (error) => error.code === "OAUTH_ACCOUNT_CONFLICT",
  );
  assert.equal(prisma.oAuthAccount.create.mock.calls.length, 0);
});
```
- [ ] **Step 2: Run `node --test tests/oauth.service.test.js` from `backend` and verify failure** — It must fail because link-specific functions and safety checks do not exist.
- [ ] **Step 3: Implement the safe link boundary** — Add `passwordSetAt` with a conservative additive backfill: users without OAuth accounts are marked from `createdAt`, while users with OAuth accounts start null and become marked on signup/password reset/password change/admin password assignment. OAuth-only random password hashes remain unmarked. Add `OAuthLinkNonce` with unique nonce, owner/provider, expiry, and consumed timestamp; create it at link authorization and atomically claim it at callback, rejecting replay/store failures. Use dedicated link callback paths/cookies and reject link payloads in login verification. Derive provider identity server-side, reject ownership conflicts, use the link callback URL for token exchange, and use a serializable transaction for unlink so concurrent removals cannot delete every login method. Return refreshed provider summaries.
- [ ] **Step 4: Preserve and run login tests** — Do not change `handleOAuthCallback` or `findOrCreateOAuthUser`. Run `node --test tests/oauth.service.test.js tests/auth.service.test.js; npm test`; expect PASS.
- [ ] **Step 5: Commit** — Run `git add backend/src/modules/auth/oauth.service.js backend/src/modules/auth/auth.service.js backend/tests/oauth.service.test.js; git commit -m "feat: add oauth account linking service"`.

### Task 2: Add authenticated link routes and callbacks

**Files:** Modify `backend/src/modules/auth/auth.controller.js`, `backend/src/modules/auth/auth.routes.js`, and `backend/tests/auth.controller.test.js`; create `backend/tests/oauth-link.routes.test.js` for route middleware coverage.

**Interfaces:** Add these API contracts under the existing `/api/v1` mount: `GET /auth/oauth/providers` returns `{ success: true, providers }`; `GET /auth/oauth/:provider/link` redirects to the provider; `GET /auth/oauth/:provider/link/callback` redirects safely to `/profile?tab=account&oauth=linked|error`; `DELETE /auth/oauth/:provider` returns `{ success: true, providers }`.

- [ ] **Step 1: Write failing controller/route tests** — Assert every link endpoint requires the current session, callbacks clear only the link flow cookie, callbacks never invoke session creation, conflicts redirect with an error marker, and provider list/unlink pass `req.user.id` rather than a body user ID.
- [ ] **Step 2: Run `node --test tests/auth.controller.test.js tests/oauth-link.routes.test.js` and verify failure**.
- [ ] **Step 3: Implement handlers and routes** — Add `startGoogleLink`, `startDiscordLink`, `googleLinkCallback`, `discordLinkCallback`, `getLinkedProviders`, and `unlinkProvider`. Keep existing login routes untouched. Validate `req.params.provider` against `google|discord`, apply `requireAuth` to every link endpoint, use a fixed safe profile redirect, and never call session creation in a link callback. Serialize provider conflict and last-login-method failures without leaking provider tokens or IDs.
- [ ] **Step 4: Run focused and complete backend tests** — Run `node --test tests/auth.controller.test.js tests/oauth-link.routes.test.js tests/oauth.service.test.js; npm test`; expect PASS with existing login callbacks unchanged.
- [ ] **Step 5: Commit** — Run `git add backend/src/modules/auth/auth.controller.js backend/src/modules/auth/auth.routes.js backend/tests/auth.controller.test.js backend/tests/oauth-link.routes.test.js; git commit -m "feat: expose oauth account linking api"`.

### Task 3: Add the profile account-linking panel

**Files:** Create `frontend/components/auth/AccountLinkingPanel.tsx`, `frontend/lib/account-linking.ts`, and `frontend/tests/unit/account-linking.test.tsx`; modify `frontend/components/auth/ProfileView.tsx`.

**Interfaces:** `frontend/lib/account-linking.ts` exports `LinkedProvider = { provider: "google" | "discord"; linked: boolean }`, `getLinkedProviders(): Promise<LinkedProvider[]>`, `unlinkProvider(provider): Promise<LinkedProvider[]>`, and `getProviderLinkUrl(provider): string`.

- [ ] **Step 1: Write failing component tests** — Cover ProfileView `?tab=account` callback mounting for both `oauth=linked` and `oauth=error`, both providers, linked/unlinked states, canonical link navigation, DELETE behavior, initial-load failure/retry, unlink pending state, provider conflict error, last-login-method error, and refresh after successful unlink. Do not mock away the client helper URL/DELETE behavior in every test.
- [ ] **Step 2: Run `npm test -- account-linking.test.tsx` from `frontend` and verify failure**.
- [ ] **Step 3: Implement the panel and profile integration** — Initialize the valid `account` tab from `?tab=account`; load state when the Account tab renders; keep unknown provider state from appearing as unlinked and disable link controls until a successful load. Link buttons navigate to the backend URL and never submit provider IDs or OAuth codes. Unlink calls DELETE, refreshes state, and displays clear conflict/last-method errors. Preserve existing ProfileView tabs, mobile layout, profile mutations, URL hash, and history state during callback-query cleanup.
- [ ] **Step 4: Run `npm test -- account-linking.test.tsx; npm run typecheck` and verify PASS**.
- [ ] **Step 5: Commit** — Run `git add frontend/components/auth/AccountLinkingPanel.tsx frontend/lib/account-linking.ts frontend/tests/unit/account-linking.test.tsx frontend/components/auth/ProfileView.tsx; git commit -m "feat: add profile oauth linking controls"`.

### Task 4: Verify linking end to end and document the auth boundary

**Files:** Create `frontend/tests/e2e/account-linking.spec.ts`, `frontend/tests/e2e/fake-oauth-provider.mjs`, `frontend/scripts/run-oauth-e2e.mjs`, and `frontend/playwright.oauth.config.ts`; modify `backend/src/config/env.js`, `backend/src/modules/auth/oauth.service.js`, `backend/src/lib/openapi.js`, `backend/tests/openapi.test.js`, `frontend/package.json`, and `docs/api-documentation.md` with the OAuth fixture, real-runner, OAuth linking, and support-read contracts.

**Interfaces:** Consume backend link routes, OAuth service, profile panel, and existing Playwright fixture. Produce evidence for successful link, provider collision, safe unlink failure, and successful unlink when another login method remains using two real authenticated contexts. The dedicated `npm run test:e2e:oauth` runner starts a local fake provider, real backend, and real frontend with one API origin; fake provider endpoints validate runtime PKCE and return project/run-specific identities.

- [x] **Step 1: Write Playwright scenarios and fixture** — Make OAuth provider endpoints injectable only for test runs. Start a local fake provider that validates `state`, `redirect_uri`, and S256 `code_verifier`, then returns deterministic project/run-specific identities. Use two real authenticated browser contexts and clean each linked identity after the test; assert collision ownership is unchanged and the session cookie is unchanged across callback. Do not intercept support/profile API requests or use a mutable role switch.
- [x] **Step 2: Run `npm run test:e2e:oauth` from `frontend` and verify the pre-implementation failure** — The dedicated runner fails clearly when the required dedicated disposable database URL is absent and runs all browser projects against the same real API origin when configured.
- [ ] **Step 3: Run complete verification** — With configured Node 24 and test environment, backend: `npm test; npm run lint`. Frontend: `npm test; npm run typecheck; npm run lint; npm run test:e2e -- tests/e2e/account-linking.spec.ts`. Confirm existing OAuth login, session, profile, and contact flows remain green, the support-read OpenAPI contract is green, and callbacks create no session or expose provider tokens/user IDs.
- [ ] **Step 4: Commit** — Run `git add frontend/tests/e2e/account-linking.spec.ts docs/api-documentation.md; git commit -m "test: verify oauth account linking"`.

### Task 4 review fix scope

- Replace browser authorization interception and static codes with a local fake
  provider HTTP boundary. The fake provider validates authorization parameters,
  state, redirect URI, client identity, S256 PKCE, token exchange, and profile
  bearer tokens while the Quest UI, API, callback, database, and session remain
  real.
- Add explicit non-production endpoint URL overrides for provider authorize,
  token, and profile endpoints. Production defaults and HTTPS validation remain
  unchanged.
- Run OAuth E2E through a dedicated orchestrator that starts the fake provider,
  real backend, and real frontend on one API origin, fails before startup when
  database/test credentials are absent, and terminates every child process.
- Use run-specific successful-link identities, separately configured last-method
  data, cleanup in finally paths, an independently pre-owned Discord collision
  identity, and session-cookie invariance assertions.
- Replace generic OAuth OpenAPI responses with provider enums, required callback
  query parameters, redirect/cookie headers, real auth security, and explicit
  linked-provider response schemas. Preserve the staff support-read contract.

### Independent review fix round

- [x] Make the OAuth runner require only the dedicated disposable
  `OAUTH_E2E_DATABASE_URL`, with optional `OAUTH_E2E_DIRECT_URL` and
  `OAUTH_E2E_SESSION_COOKIE_NAME` defaults. Generic parent database variables
  are rejected. Generate the fixture credentials, collision identity,
  last-method cookie, and session-cookie name through the backend manifest.
  Pass allowlisted child environments, disable maintenance, Challonge, and
  workers, allocate fresh ports, and clean up process trees on normal exit or
  SIGINT/SIGTERM.
- [x] Keep all Playwright projects serial and make every mutable fixture
  repeatable: generated link, safe-unlink, collision-target, and collision-owner
  accounts must start with no linked providers in the dedicated disposable
  database; the generated last-method account starts with only Google OAuth.
  Safe unlink links Google through the real UI before unlinking, while collision
  ownership is established in a separate owner context and removed in cleanup.
- [x] Validate exact provider scopes, Discord `prompt=consent`, and runtime S256
  PKCE in the fake provider; remove the shared EventSource test fixture from the
  OAuth spec.
- [x] Document callback failures as safe `302` redirects with `Location` and
  link-cookie headers, retaining provider enums, required `code`/`state`, and
  authentication requirements.
