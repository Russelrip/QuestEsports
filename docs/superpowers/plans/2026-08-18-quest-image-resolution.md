# Quest Esports Image Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public/admin uploaded image resolve to the API origin and load directly, while preserving legacy values and graceful missing-image behavior.

**Architecture:** Add a single `resolveImageUrl` boundary in `frontend/lib/media.ts`. Image consumers use that boundary and direct-load API images rather than routing them through Vercel's failing optimizer; `buildApiUrl` remains for JSON/API requests. The Express upload allowlist and private root are unchanged.

**Tech Stack:** Next.js, React, TypeScript, `next/image`, Vitest, Express, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-18-quest-image-resolution-design.md`

## Global Constraints

- Preserve layouts, styling, routes, APIs, registration/tournament logic, and admin permissions.
- Use `NEXT_PUBLIC_API_URL`; do not hardcode `https://api.questesports.lk` in application code.
- The repository's public upload route is `/api/uploads`; do not introduce public access to `PRIVATE_UPLOAD_ROOT`.
- Preserve MIME/type validation, upload size limits, authentication, and public-directory allowlists.
- Do not perform database-wide rewrites or filesystem-wide case renames.
- Do not commit changes in this session unless explicitly requested.

### Task 1: Add the centralized resolver and tests

**Files:**
- Modify: `frontend/lib/media.ts`
- Modify: `frontend/lib/api.ts` only if the shared origin normalization needs a private internal helper
- Create: `frontend/tests/unit/image-url.test.ts`

**Interfaces:**
- Produces `resolveImageUrl(value: unknown, options?: { directory?: PublicUploadDirectory }): string | null`.
- `PublicUploadDirectory` is the existing public upload directory union: `team-logos`, `tournament-banners`, `poster-images`, `avatars`, `game-assets`, or `sponsor-logos`.
- `resolveMediaUrl` remains a compatibility export delegating to `resolveImageUrl` so existing non-image media consumers do not break during migration.

- [ ] Write Vitest cases for `null`, `undefined`, empty/whitespace, non-string values, absolute HTTP(S), data/blob URLs, `/api/uploads/...`, `/uploads/...`, `uploads/...`, duplicate slashes, a filename with `{ directory: "team-logos" }`, a legacy `/srv/quest-esports/uploads/...` value, and already-prefixed API URLs.
- [ ] Run `npm test -- --run tests/unit/image-url.test.ts` from `frontend`; confirm the new tests fail because the export/normalization is absent.
- [ ] Implement origin-safe URL construction using `new URL`/pathname normalization rather than `${base}${path}`. Return `null` for values that could produce `undefined`, `null`, `[object Object]`, local filesystem exposure, or an unsupported public path.
- [ ] Keep absolute external CDN URLs unchanged and map legacy public upload paths to `/<api-prefix>/uploads/...` without changing the configured API origin.
- [ ] Run the focused resolver test and confirm all cases pass.

### Task 2: Migrate public and admin image consumers

**Files:**
- Modify: `frontend/components/tournaments/TournamentDetailsContent.tsx`
- Modify: `frontend/components/tournaments/TournamentBannerImage.tsx`
- Modify: `frontend/components/tournaments/TournamentsContent.tsx`
- Modify: `frontend/components/gallery/EventAlbumCard.tsx`
- Modify: `frontend/components/gallery/EventAlbumBrowser.tsx`
- Modify: `frontend/components/posters/PosterGallery.tsx`
- Modify: `frontend/components/posters/PosterPreview.tsx`
- Modify: `frontend/components/posters/AdminPosterStudio.tsx`
- Modify: `frontend/components/admin/AdminMediaManager.tsx`
- Modify: `frontend/components/admin/AdminEventAlbumsManager.tsx`
- Modify: `frontend/components/admin/AdminTeamsManager.tsx`
- Modify: `frontend/components/admin/TournamentSponsorsManager.tsx`
- Modify: `frontend/components/auth/TeamManagementPanel.tsx`
- Modify: `frontend/components/auth/ProfileView.tsx`
- Modify: `frontend/components/UserMenu.tsx`
- Modify: `frontend/components/Navbar.tsx`
- Modify: `frontend/components/match-rooms/MatchRoomView.tsx`
- Modify: `frontend/components/veto/VetoRoomView.tsx`
- Modify: `frontend/components/admin/AdminGamesManager.tsx`

**Interfaces:**
- Consumers call `resolveImageUrl` for uploaded image `src` values; API request paths continue to call `buildApiUrl`.
- API-hosted uploaded `next/image` elements use `unoptimized` while local/static assets retain current behavior.

- [ ] Replace image-only `buildApiUrl`/`resolveMediaUrl` calls with `resolveImageUrl`, preserving existing null branches and all props/classes/dimensions.
- [ ] Add the directory option only where a response can contain a filename-only legacy value and the image type is known.
- [ ] Add a one-shot `onError` fallback to high-traffic team, tournament, avatar, sponsor, poster, gallery, and admin preview images; use existing component placeholders/initials and do not retry the failed URL.
- [ ] Ensure the Participants card renders `Temp Team` with either the direct API image URL or its existing initials placeholder, never a browser broken-image icon.
- [ ] Update source-level tests that assert resolver usage, adding an assertion that the participant image is direct-loaded.

### Task 3: Verify backend boundary and compatibility without changing security

**Files:**
- Modify only if a test exposes a regression: `backend/src/modules/uploads/upload.routes.js`, `backend/src/modules/uploads/upload.service.js`, or the relevant mapper.
- Test: existing backend upload/service tests and any narrowly scoped regression test required by the evidence.

**Interfaces:**
- Public files remain served only by `/api/uploads/<allowlisted-directory>/<safe-filename>` from `UPLOAD_ROOT`.
- `PRIVATE_UPLOAD_ROOT` remains inaccessible through public upload routes and is never serialized to frontend URLs.

- [ ] Run backend upload, media-library, tournament, auth, event, and admin mapping tests before any backend edit.
- [ ] Assert existing filename-only database fields map to `/api/uploads/<directory>/<filename>` and legacy media binary routes remain intact.
- [ ] Check case-sensitive filename behavior through the existing generated safe filename policy; do not add case-insensitive filesystem searching or renaming.
- [ ] Confirm no Nginx/static middleware change is needed because Express owns the upload route and the live API returns 200 for existing files.

### Task 4: Full verification and production evidence

**Files:**
- No source changes expected; inspect the final diff and test output.

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` in `frontend`.
- [ ] Run the relevant backend test suite and lint command in `backend`.
- [ ] Re-run live checks with `Origin: https://questesports.lk`: existing banner, sponsor, and Temp Team logo direct URLs must return HTTP 200 with image content types; `/uploads/...` and frontend-origin `/api/uploads/...` must not be treated as valid production image URLs.
- [ ] Verify the built participant component contains direct API image loading and no image-only ad-hoc URL concatenation remains in the audited consumers.
- [ ] Review `git diff`, `git status`, and changed-file scope; report files changed, old/fixed examples, backward compatibility, tests, and whether server/Nginx changes were required.
