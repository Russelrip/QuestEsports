# Future Technical Improvements

This document records technically feasible improvements that are not committed, scheduled, or implemented. It is an evaluation register, not a product roadmap or deployment guide. An entry must not be described as supported until its implementation, tests, rollout, and operational documentation have been completed.

## Entry Format

Use the following fields for future entries:

- **Status** — evaluation state, such as feasible but not scheduled, needs research, deferred, or rejected.
- **Potential value** — the problem the change could solve.
- **Current state** — the relevant implemented behavior that must be preserved.
- **Prerequisites** — decisions, contracts, evidence, or capacity needed before planning implementation.
- **Risks and compatibility constraints** — existing data, APIs, security, operations, and rollback behavior that could be affected.
- **Reconsider when** — a concrete trigger for reviewing the candidate again.

## 9Drive Image Storage

**Status:** Feasible — not scheduled

### Potential Value

9Drive could provide remote storage for selected public images and reduce the backend VPS's responsibility for durable public image bytes. The candidate scope is:

- User profile pictures.
- Saved-team and tournament-registration team logos.
- Poster images, subject to the scope decision below.

This candidate does not include private bank-transfer evidence, tournament schedules, game artwork, sponsor logos, or other upload categories unless a later review explicitly expands the scope.

### Current State

The candidate image uploads already pass through the authenticated application backend. Multer applies request limits, Sharp validates and normalizes JPEG, PNG, and WebP content, and the services perform authorization and database updates before cleaning up replaced files. Public images are served through application-owned `/api/uploads/...` URLs with immutable caching.

Image records currently store local filenames rather than storage-provider-aware references:

- `User.avatarImageName` stores an avatar filename.
- `SavedTeam.logoName` and `TeamRegistration.teamLogoName` store shared team-logo filenames.
- `ImageAsset.storedFilename` stores gallery and product image filenames, with a database-binary fallback for legacy assets.

Existing filesystem uploads, database-backed legacy images, public URLs, authorization rules, validation behavior, and cleanup retries must continue working during any future provider rollout.

The term “poster images” requires a product decision before implementation. The repository has both gallery/poster-studio assets stored through `ImageAsset` and tournament completed-event poster/showcase fields stored with tournament assets. A future implementation must state whether it covers one or both groups.

### Prerequisites

Authoritative 9Drive documentation or redacted working request/response examples are required. The reported `POST /api/v1/uploads` endpoint is not enough to implement or test the provider safely. The following contract details remain unverified:

- Required multipart field names and supported metadata.
- Successful response shape and stable file identifier.
- Error response shapes and HTTP status behavior.
- Whether returned image URLs are permanent, public, private, or signed.
- Supported deletion endpoint and deletion guarantees, if any.
- File-size, request-timeout, rate-limit, and retry constraints.

Implementation planning should begin only after this contract is available and the poster scope is confirmed.

### Likely Safe Approach

A future implementation should prefer the smallest compatibility layer:

- Introduce a focused server-side image-storage interface with local-filesystem and 9Drive providers; do not place 9Drive calls in controllers or frontend components.
- Keep the local filesystem provider available as the default, rollout fallback, and rollback path.
- Add provider metadata through nullable columns or a separate storage record while preserving every existing filename and database-backed legacy image.
- Continue returning application-owned image URLs. Resolve remote objects behind those URLs through a controlled redirect or proxy chosen after the 9Drive URL contract is known.
- Upload and validate the new remote object before changing the application record. Clean up the previous object only after the database update succeeds.
- Extend the existing durable cleanup jobs to understand provider-owned objects and tolerate remote deletion failures without removing a newly saved image.
- Mock 9Drive in automated tests and keep any credentialed smoke test opt-in and outside normal CI.

The following names are provisional examples only and are **not currently read or supported by the application**:

```env
NINE_DRIVE_ENABLED=false
NINE_DRIVE_API_URL=
NINE_DRIVE_API_KEY=
```

Do not add these values to production until an implementation validates them. The API key must remain in backend configuration and must never be exposed through frontend environment variables, browser requests, logs, or documentation.

### Risks and Compatibility Constraints

- Saving a remote URL directly in an existing filename column would break current URL construction, safe-filename checks, and cleanup behavior.
- Switching public URL hosts could affect Next.js image allowlists, browser/CDN caching, exports, and existing API consumers.
- Missing or unreliable remote deletion could create orphaned provider objects.
- A remote outage must not leave the database pointing at a failed upload or silently discard an upload.
- Existing local images must remain readable after enablement, disablement, and rollback.
- Team logos may be referenced by both reusable teams and tournament registrations, so cleanup must retain reference-aware behavior.
- Provider availability, retention, quotas, data location, account recovery, and backup expectations require operational review before production use.

### Reconsider When

Review this candidate when all of the following are true:

- Authoritative 9Drive API details or verified redacted examples are available.
- The gallery-versus-tournament poster scope has an owner-approved decision.
- Remote storage provides a concrete capacity, reliability, cost, or operational benefit over the current durable filesystem.
- There is time to implement migration-safe metadata, provider-aware cleanup, automated tests, a staged rollout, and rollback validation.

## Riot Sign On (RSO) Account Ownership Verification

**Status:** Deferred — blocked on Riot production approval and an RSO client

### Potential Value

Riot Sign On could prove that the signed-in Quest user controlled the Riot
account whose PUUID is linked to their player profile. This would support an
honest `riot_verified` state for tournament eligibility and player-data opt-in,
instead of treating knowledge of a Riot ID as proof of ownership.

This candidate is account linking for an already authenticated Quest user. It
does not require replacing Quest password, Google, or Discord login with Riot
login.

### Current State

The profile's Game Accounts panel accepts a Riot ID in `Name#Tag` form. Quest
asks the internal VALORANT service to resolve that display identity through the
current upstream provider, receives the stable PUUID, shows the result to the
user, and resolves it again server-side before creating `GameAccount`.

That process proves only that the account exists. A link is currently recorded
as `user_confirmed`, or `discord_corroborated` when the Quest user's linked
Discord identity is already paired with the same PUUID upstream. Neither state
is Riot account ownership proof. The database's `(game, externalId)` uniqueness
constraint prevents one PUUID from being claimed by multiple Quest players but
does not strengthen the proof behind the first claim.

### Prerequisites

- Register the player-facing product in the Riot Developer Portal and obtain an
  approved VALORANT production application. VALORANT personal keys are not an
  available substitute.
- Verify the production website and provide Riot a working site, prototype, or
  mockup that makes the account-linking, consent, tournament, and public-data
  flows clear.
- Obtain an RSO client and Riot's current client authentication, token,
  callback, scope, rotation, and revocation contracts. Do not infer these from
  the existing Google or Discord configuration.
- Update the privacy policy and link UI to explain the Riot identifiers and
  gameplay data collected, their purpose, retention, public visibility, and the
  effect of unlinking. Display Riot's required non-affiliation and player opt-in
  notices where applicable.
- Review public VALORANT projections against Riot's current opt-in rules. The
  existing public match scoreboard can include identifiable stats for players
  who have never used Quest; RSO implementation must not silently declare those
  players opted in.
- Decide how an unlink request interacts with locked tournament roster
  snapshots, historical results, public profiles, and any data that must be
  retained for dispute or event records.

Authoritative starting references are Riot's
[VALORANT developer documentation](https://developer.riotgames.com/docs/valorant)
and [Developer Portal FAQ](https://developer.riotgames.com/docs/faqs). Provider
instructions issued with the approved RSO client remain authoritative if they
differ from this evaluation entry.

### Likely Safe Approach

- Add a profile action such as **Verify with Riot** and keep manual Riot-ID
  resolution available only under an explicitly weaker label until the product
  owner decides whether it should remain after rollout.
- Start RSO from an authenticated, link-only backend route. Bind short-lived
  OAuth state and nonce to the current Quest session and use PKCE when Riot's
  issued client contract supports or requires it.
- Register one exact HTTPS callback, provisionally
  `https://api.questesports.lk/api/v1/game-accounts/valorant/rso/callback`, and
  return the user to `/profile?tab=account` with a safe relative redirect.
- Exchange the authorization code server-side, then call Riot's authenticated
  `/riot/account/v1/accounts/me` endpoint. Use the returned PUUID as
  `GameAccount.externalId`; never accept a browser-supplied PUUID as proof.
- Add a migration-safe `riot_verified` verification state plus consent and
  verification timestamps. Preserve the existing unique PUUID boundary and
  account-change review workflow.
- Avoid retaining Riot access or refresh tokens when a one-time identity check
  satisfies the approved use case. If ongoing access is required, encrypt
  tokens at rest, redact them from logs/audits, restrict backend access, rotate
  client credentials, and implement revocation and expiry handling.
- Make activation feature-gated so mock and contract tests can ship before
  credentials exist, while production continues to describe the current flow
  accurately.
- Cover state mismatch/replay, callback denial, expired grants, session changes,
  duplicate PUUIDs, provider outages, rename handling, unlinking, consent
  withdrawal, and secret redaction in automated tests.

The following names are provisional examples only and are **not currently read
or supported by the application**:

```env
RIOT_RSO_ENABLED=false
RIOT_RSO_CLIENT_ID=
RIOT_RSO_CLIENT_SECRET=
RIOT_RSO_REDIRECT_URI=https://api.questesports.lk/api/v1/game-accounts/valorant/rso/callback
```

Do not add real credentials to the repository, frontend environment variables,
browser code, logs, fixtures, or documentation.

### Risks and Compatibility Constraints

- Riot approval and RSO access are external dependencies; a complete-looking
  local OAuth imitation must never be presented as Riot verification.
- Publishing player-specific stats without the required opt-in could block
  approval or require changes to public leaderboard and match projections.
- Linking RSO directly as a Quest login provider could merge or create users in
  ways the existing link-only requirement avoids.
- Callback account injection, login CSRF, replay, and duplicate PUUID races must
  remain server-enforced security boundaries rather than frontend checks.
- Removing or replacing an account already frozen into a tournament roster must
  not rewrite historical identity evidence.
- Token retention expands breach impact and operational responsibility, so it
  must be justified by an approved ongoing-access requirement.

### Reconsider When

Review this candidate when all of the following are true:

- Quest has time to prepare an approval-quality RSO prototype and player-data
  opt-in experience.
- The public scoreboard and leaderboard policy decision has an owner-approved
  answer consistent with Riot's current rules.
- Privacy, consent, unlinking, and historical-retention behavior are defined.
- A Riot production application and RSO client can be requested and maintained
  by the product owner.
