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
