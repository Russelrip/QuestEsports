# Quest ← Valorant SL Player Leaderboard — Design

**Status:** Approved design; implementation-ready pending plan
**Date:** 2026-08-14
**Scope:** QuestEsports public, read-only Sri Lankan Valorant *player* leaderboard page, proxying the `valorantsl-new` leaderboard API. Companion repos: `valorantsl-new` (source), `valorant-platform-backend` (future standardization target).
**Relationship to prior specs:** This supersedes the `A5` non-goal in `2026-08-13-standalone-valorant-integration-design.md` ("Public-facing VALORANT stats, leaderboards, or unauthenticated data access") for one specific surface — the player leaderboard page. It does **not** otherwise reopen that design's settled architecture.

---

## 1. Problem and goals

### 1.1 Settled architecture (do not reopen)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Quest reads `valorantsl-new` directly for now.** | Quest's Express BFF proxies the `valorantsl-new` leaderboard API server-to-server. Standardization into `valorant-platform-backend` is deferred to Phase 2; there is no `valorant-platform-backend` involvement in Phase 1. |
| D2 | **The leaderboard is public — no login.** | The proxy is a public cached route; the page is a public server component. No session/cookie involvement. |
| D3 | **Read-only in Phase 1.** | Quest displays data only; it never writes players, ranks, or registrations. |
| D4 | **Registration stays in `valorantsl-new` for a transitional period.** | The page shows a "Register" CTA that links out to `valorantsl-new`. Quest does not host registration or Discord OAuth yet. |
| D5 | **Quest styling, not `valorantsl-new` styling.** | The `valorantsl-new` frontend is irrelevant to this page. The page uses Quest's `PageLayout`, `ui/` primitives, and design tokens. |
| D6 | **Clean seam for Phase 2.** | A *new* `valorant-leaderboard` module, separate from the existing `valorant` module (HMAC'd to `valorant-platform-backend`). In Phase 2 only this module's client swaps its upstream target. |
| D7 | **60s read caching.** | `valorantsl-new` has no cache of its own and its data changes ~every 30 min; 60s is a safe freshness/load trade-off. |
| D8 | **Feature set: table + search + top-N.** | No stats summary in this cut (deferred). |

### 1.2 Problem statement

Quest wants to host the Sri Lankan Valorant player leaderboard as a first-class page in its own domain and styling, while registration/identity continue to live in `valorantsl-new` for a transitional period. The leaderboard is public, read-only data sourced from `valorantsl-new`'s leaderboard API (`/api/v1/leaderboard`, `/search`, `/top`). This must integrate with Quest's A1 rule (browser talks only to Quest), its public-page + caching conventions, and its doc/test discipline — without coupling to `valorantsl-new`'s frontend or disturbing the existing admin Valorant integration.

### 1.3 Goals

1. **Public page:** a `/valorant-leaderboard` route, no auth, Quest-styled, discoverable via nav + sitemap + SEO metadata.
2. **Read-only data:** paginated ranked table (ELO-desc, already sorted upstream), exact-match search, and a top-N highlight.
3. **A1 compliance:** the browser never calls `valorantsl-new`; Quest's Express proxies it server-side with caching.
4. **Resilience:** graceful degradation when `valorantsl-new` is down or the search misses, without a hard 500 page.
5. **Phase-2-ready seam:** the upstream target is a single client module that can later point at `valorant-platform-backend` without touching the page or proxy contract.

---

## 2. Non-goals and phased scope

### 2.1 Explicit non-goals (Phase 1)

- Migrating registration, Discord OAuth auth, or the geo-gate into Quest or `valorant-platform-backend`.
- Standardizing `valorantsl-new`'s endpoints into `valorant-platform-backend` (that is Phase 2).
- Stats summary (total/highest/avg ELO, rank distribution) — deferred.
- Any writes (registration, rank refresh, player create/update).
- `mobile-admin/` screens, admin gating, or the existing `valorant` admin module.
- Touching `valorantsl-new` or `valorant-platform-backend` repositories at all in Phase 1.

### 2.2 Phased roadmap

- **Phase 1 (this spec):** Quest public player-leaderboard page, proxying `valorantsl-new` directly.
- **Phase 2 (later, own spec):** Port all 18 `valorantsl-new` endpoints (auth/Discord OAuth, geo-gated registration, leaderboard) + `players` schema + 30-min `updater` + Discord bot into `valorant-platform-backend`, consolidating player data into the `valorant` schema. Repoint the Phase-1 client at `valorant-platform-backend`.
- **Phase 3 (later, own spec):** Cut registration/auth over to Quest (frontend + backend), retire the `valorantsl-new` frontend/updater/bot.

---

## 3. Phase 1 architecture and data flow

```text
 Browser → Next.js page (server component, ISR revalidate=60)
         → fetchApiJson → Quest Express  GET /api/v1/valorant/leaderboard[...]
         → valorant-leaderboard module (controller → service → client)
         → valorantsl-new  GET /api/v1/leaderboard[...]   (server-to-server, anonymous)
         → valorantsl-new Supabase `public.players`
```

- **Auth:** none on the public path. `valorantsl-new`'s leaderboard endpoints are anonymous (its geo-gate applies only to registration).
- **Caching:** Quest's `cachePublicData()` + `cacheJson({ ttlSeconds: 60 })` on the proxy (mirrors the `/home` route pattern); frontend `export const revalidate = 60`.
- **Resilience:** client enforces a 5s upstream timeout; upstream timeout/5xx maps to `503 VALORANT_LEADERBOARD_UNAVAILABLE`, which the page renders as a graceful empty state.

---

## 4. Proxy contract (Quest Express)

Two new public routes, declared inline in `backend/src/routes/v1.js` alongside the other public GET routes (before the `requireAdmin` mount at ~line 114), backed by `cachePublicData()` + `cacheJson`.

| Route | Query/Path | Upstream it proxies | Returns |
|---|---|---|---|
| `GET /api/v1/valorant/leaderboard` | `page` (default 1), `per_page` (default 50, max 200) | `valorantsl-new GET /api/v1/leaderboard?page&per_page` | `{ entries[], total, page, per_page, total_pages }` |
| `GET /api/v1/valorant/leaderboard/search` | `q` (exact discord username, case-insensitive) | `valorantsl-new GET /api/v1/leaderboard/search/{q}` | `entry \| null` |

Notes:
- Top-N is **not** a separate route: it is the client-side slice of the page-1 `entries` (upstream `/top/{count}` reuses the page-1 query anyway, so a third proxy route adds nothing).
- New module `backend/src/modules/valorant-leaderboard/` (`client.js`, `service.js`, `controller.js`). `client.js` does anonymous HTTP (no HMAC — distinct from `valorant.client.js`), 5s timeout, error mapping.
- Config: `VALORANT_SL_API_URL` added to `backend/src/config/env.js` + `.env.example`. Optional/fail-soft: if unset, routes return `503 VALORANT_LEADERBOARD_UNAVAILABLE` rather than failing deploy validation (mirrors how `VALORANT_INTERNAL_BASE_URL` gates the existing admin integration).

---

## 5. Data mapping

`valorantsl-new` `LeaderboardEntry` → Quest `ValorantPlayerLeaderboardEntry` (new types in `frontend/lib/valorant.ts`, distinct from the existing team `RankingEntry`).

| Upstream field | Quest field | Notes |
|---|---|---|
| `puuid` | `puuid` | opaque string id |
| `name`, `tag` | `name`, `tag` | display `name#tag` |
| `current_tier` | `currentTier` | tier label (e.g. "Diamond 2") |
| `elo` | `elo` | sort key (already DESC upstream) |
| `rank_in_tier` | `rankInTier` | |
| `peak_rank` (string tier name) | `peakRank` | API returns a plain tier-name string, not the DB jsonb |
| `peak_season` (string) | `peakSeason` | |
| `discord_username` | `discordUsername` | search key |
| `last_played_match` | `lastPlayed` | 2-week freshness already applied upstream |

Quest passes through `valorantsl-new`'s already-normalized fields; it does **not** replicate the upstream `rank_details` dual-shape normalization (that stays `valorantsl-new`'s responsibility until Phase 2).

---

## 6. Frontend page structure

- **`frontend/app/valorant-leaderboard/page.tsx`** (new) — thin server component mirroring `app/tournaments/page.tsx`: `export const revalidate = 60`, `buildPageMetadata({ title: "Valorant Leaderboard", ... })`, fetch page-1 data, render `<PageLayout>` wrapping a `"use client"` content component.
- **`frontend/components/valorant/ValorantLeaderboard.tsx`** (new) — client component:
  - search box (exact match, mirrors upstream semantics) with a "No player found" state;
  - top-10 highlight (client-side slice of page 1);
  - paginated table (server-paginated via `page`/`per_page`);
  - "Register" CTA linking to `valorantsl-new` (env-overridable `NEXT_PUBLIC_VALORANT_SL_REGISTER_URL`).
- **`frontend/lib/valorant-api.ts`** — add `fetchPublicValorantLeaderboard` / `searchPublicValorantLeaderboard` using `fetchApiJson` (no cookies).
- **`frontend/lib/valorant.ts`** — add the player-leaderboard types.
- **`frontend/lib/site.ts`** — one nav entry (desktop + mobile via `Navbar.tsx`) + `defaultPageDescriptions.valorantLeaderboard`.
- **`frontend/lib/sitemap.ts`** — add the `/valorant-leaderboard` path to `sitemapStaticPaths`.

---

## 7. Error handling and resilience

| Condition | Behavior |
|---|---|
| `VALORANT_SL_API_URL` unset | `503 VALORANT_LEADERBOARD_UNAVAILABLE` (fail-soft) |
| `valorantsl-new` unreachable, or timeout (5s) | `503 VALORANT_LEADERBOARD_UNAVAILABLE` |
| `valorantsl-new` returns a 5xx (or other non-ok) | `502` (upstream errored) — page shows the unavailable state |
| Upstream page out of range | `404` |
| Search miss (upstream `null`) | `200` with `null` → "No player found" state |
| Frontend fetch failure | graceful empty state ("Leaderboard is temporarily unavailable") + register link; no hard error page |

Errors use Quest's `http-error`/error-handler so the response shape matches Quest conventions.

---

## 8. Testing and docs (Quest repo conventions)

- **Backend** `backend/tests/valorant-leaderboard.test.js`: mock the upstream client; assert list/search field mapping, `cache-control`/cache headers, and `503` on upstream failure + unset URL.
- **Frontend** extend `tests/unit/valorant-api.test.ts` (public fetch), `sitemap.test.ts` (path), `site.test.ts` (nav + description). No FastAPI/Henrik/`X-Admin-Key`/secret references — satisfies the source-assertion tests.
- **OpenAPI/docs**: add the two operations to `backend/src/lib/openapi.js` and `docs/api-documentation.md`; note the new public path in `docs/valorant-integration.md`.

---

## 9. Files touched (QuestEsports, Phase 1)

**Backend**
- `backend/src/routes/v1.js` — two public routes
- `backend/src/modules/valorant-leaderboard/client.js` (new)
- `backend/src/modules/valorant-leaderboard/service.js` (new)
- `backend/src/modules/valorant-leaderboard/controller.js` (new)
- `backend/src/config/env.js` — `VALORANT_SL_API_URL`
- `backend/.env.example` — document the var
- `backend/src/lib/openapi.js` — two operations
- `docs/api-documentation.md`, `docs/valorant-integration.md`
- `backend/tests/valorant-leaderboard.test.js` (new)

**Frontend**
- `frontend/app/valorant-leaderboard/page.tsx` (new)
- `frontend/components/valorant/ValorantLeaderboard.tsx` (new)
- `frontend/lib/valorant-api.ts`, `frontend/lib/valorant.ts`
- `frontend/lib/site.ts`, `frontend/lib/sitemap.ts`
- `frontend/.env.example` — document `NEXT_PUBLIC_VALORANT_SL_REGISTER_URL`
- `frontend/tests/unit/{valorant-api,sitemap,site}.test.ts`

---

## 10. Risks and open items

- **Upstream search semantics:** `valorantsl-new` search is exact-match on `discord_username`. Quest mirrors this; a substring/fuzzy search is a future enhancement.
- **Single-instance upstream:** `valorantsl-new` has no distributed cache/lock and runs one backend; Quest's 60s cache shields it from extra load. If upstream moves to multi-replica later, caching still applies.
- **Transitional dual-write is avoided** by D1 (read-only, single upstream). No data consistency risk in Phase 1.
- **Phase 2 will change this seam:** the proxy contract and Quest page must not be rewritten when the client target swaps to `valorant-platform-backend`; only `client.js` changes.
