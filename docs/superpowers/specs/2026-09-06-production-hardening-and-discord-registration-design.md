# Production Hardening and Discord-Required VALORANT Registration

## Status

Proposed for implementation after user review.

## Goal

Harden the Quest Esports monorepo's production paths and change VALORANT
leaderboard registration so it requires an authenticated Quest account with a
verified Discord account linked to that profile.

## Decisions

- VALORANT registration remains available to Quest users, but anonymous
  registration is removed.
- A Quest session is required for PUUID lookup, preview, and submission.
- The user must have a linked Discord `OAuthAccount` before registration can
  continue.
- The canonical Discord identity is the linked OAuth provider ID stored by the
  backend. Client-submitted Discord IDs and usernames are never trusted.
- Discord ID and username are displayed only in the signed-in user's private
  profile and to authorized administrators. They are not added to public player
  profiles.
- The registration form displays the linked Discord identity as read-only,
  but submits only the PUUID. The backend derives the Discord identity again.
- Existing leaderboard registrations are not deleted when Discord is
  unlinked. Unlinking blocks new registration submissions until Discord is
  linked again.
- Existing Quest OAuth account-linking routes are reused. The separate
  leaderboard-specific Discord OAuth/session-storage flow is retired.
- Riot/VALORANT account ownership is not claimed by this change. Henrik lookup
  proves that a PUUID exists; a future Riot ownership-verification feature would
  be separate.
- The current production topology is immutable Docker Compose on the Quest VPS;
  Vercel/PM2 instructions are historical or non-production only.

## Registration architecture

### Backend identity source

The authenticated request is populated by the existing `attachSession`
middleware. Registration routes use `requireAuth`, then resolve the user's
Discord OAuth account by `provider = discord`. The provider user ID is the
canonical Discord snowflake. The display username comes from the linked account
or the current user's stored Discord display projection.

The registration request schema becomes PUUID-only. The proxy service passes
the server-derived Discord identity to the VALORANT service. If the session is
missing, the route returns `401`. If the session exists but no Discord account
is linked, the route returns `403` with stable error code
`DISCORD_LINK_REQUIRED`.

The registration-specific Discord login and callback endpoints are removed from
the active frontend flow and no longer provide an alternate identity source.
The existing OAuth-link flow retains its signed state, nonce, PKCE, and callback
cookie protections.

### Profile and frontend behavior

The authenticated private profile/session projection exposes a nullable
`discordId` alongside the existing display tag. It is only returned through
authenticated account/session responses and admin-safe views. Public player
projections remain unchanged.

After a successful Discord account-link callback, the frontend refreshes the
session/profile state. The profile renders the Discord ID and username as
read-only connected-account data. Unlinking refreshes the state and removes the
displayed values.

The VALORANT registration page follows this state machine:

1. Anonymous: show a sign-in action and do not expose registration inputs.
2. Authenticated without Discord: show a connect-Discord action and block
   preview/submission.
3. Authenticated with Discord: show the read-only Discord identity and allow
   PUUID lookup/preview.
4. Submit: send only the PUUID; never serialize editable Discord fields.

### Persistence and compatibility

No new identity table is required. Existing OAuth account uniqueness and
Discord identity constraints remain authoritative. Existing upstream duplicate
handling remains unchanged. Existing clients sending Discord fields must either
be rejected with a validation error or have those fields ignored; they must
never override the server-derived identity.

## Discord worker safety

The Discord worker will manage only an explicit set consisting of its rank-role
names and the `Unverified` role. It will preserve every unrelated guild role.
The `Manual` exemption is checked before nickname or role mutation. The worker
will have tests covering registered, unregistered, manually managed, bot, and
unrelated-role cases.

## Production readiness

Production settings validation will remain permissive for development and test
but fail closed for production when required integration settings are absent or
malformed. The production environment contract will list every required setting
without embedding secret values. Release verification will cover:

- API health and database readiness;
- Quest-to-VALORANT service-token authentication;
- Henrik credential/configuration presence;
- production Discord OAuth redirect configuration;
- worker admission and sustained liveness;
- image identity and TLS checks.

Health endpoints will distinguish database readiness from integration readiness
so a database-only health result cannot authorize a fully functional release.

The VALORANT HTTP edge will not permit a plaintext Cloudflare-to-origin path
once Full (strict) mode and origin firewall restrictions are verified. The
frontend production image will use a digest-pinned Node base image.

## Frontend reliability and quality

- Runtime API-origin parsing will use the existing safe parser rather than an
  unguarded `new URL()` call.
- Polling and realtime refreshes will cancel or coalesce overlapping requests,
  respect page visibility, and expose retryable failures.
- Hook dependency suppressions will be removed or replaced with stable,
  tested callbacks.
- Raw image usage will use optimized images or narrowly justified exceptions.
- Vitest worker concurrency will be bounded in CI so the default command is
  deterministic under CI resource limits.
- Frontend coverage thresholds will be added for authentication, registration,
  payment, admin authorization, and failure-state paths.

## Mobile and Python contracts

- The mobile dependency chain containing `decode-uri-component` will be
  upgraded to a compatible fixed release or replaced through a tested Expo
  upgrade; a breaking `npm audit --force` change is not acceptable.
- CI will add reproducible Android native-build validation.
- Python version metadata, Docker runtime, README, and setup documentation will
  agree on one tested support range.

## Documentation

Documentation will be updated after the implementation contract is stable:

- root README local VALORANT URL;
- Python prerequisites and supported version;
- one authoritative Compose production topology;
- historical/non-production labeling for generic `npm start` and Vercel
  instructions;
- production environment requirements and release gates;
- private Discord ID visibility and account-linking behavior;
- protected VALORANT E2E prerequisites;
- coverage and Android build verification commands.

## Verification requirements

The implementation is not complete until the following evidence exists:

- backend tests cover anonymous, unlinked, linked, forged-field, and unlink
  registration cases;
- frontend tests cover sign-in, connect-Discord, read-only profile data,
  autofill, and submit payload shape;
- Discord worker tests prove unrelated roles survive;
- backend/frontend/mobile lint, typecheck, and unit suites pass;
- frontend production build passes with valid HTTPS configuration;
- mobile Expo Doctor and Android native-build checks complete;
- VALORANT Ruff/pytest run through the repository-managed `uv` environment;
- protected two-service VALORANT E2E runs against isolated databases;
- deployment and documentation contract tests pass;
- no real environment files or generated artifacts become tracked.
