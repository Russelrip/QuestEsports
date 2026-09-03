# Quest ← ValorantSL Player Leaderboard Standardization — Design (Phase 2)

**Status:** Approved design; implementation-ready pending plan
**Date:** 2026-08-14
**Scope:** Port all `valorantsl-new` endpoints, the `players` data model, and the background workers into `valorant-platform-backend`, consolidating the Sri Lankan player leaderboard + registration + Discord auth into the standard backend. Companion repos: `valorant-platform-backend` (target), `valorantsl-new` (source + thin-BFF transition), `QuestEsports` (proxy repoint).
**Relationship to prior specs:** This is Phase 2 of the roadmap in `QuestEsports/docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md` (§2.2). It does not reopen the settled `valorant-platform-backend` architecture (`docs/superpowers/specs/2026-08-13-valorant-platform-backend-design.md`).

---

## 1. Problem and goals

### 1.1 Settled decisions (do not reopen)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Port all 18 endpoints.** | Leaderboard reads + geo-gated registration + Discord OAuth auth + app-level. `valorant-platform-backend` becomes the single source of truth. |
| D2 | **Port both background workers.** | The 30-min `updater` (rank refresh), the weekly `name_audit`, and the Discord role-sync bot all move to `valorant-platform-backend`. |
| D3 | **One-time data migration.** | Existing ~279 players migrate from `valorantsl-new` Supabase `public.players` → `valorant` schema in one run-once script. |
| D4 | **Atomic cutover, no dual-write.** | Migrate → point updater + endpoints at the `valorant` schema → repoint Quest → repoint the BFF → verify. Single source of truth immediately. |
| D5 | **Service-token everywhere + system principal.** | Every new `/api/v1` route is HMAC-service-token gated (the repo invariant: `/health` is the only open route). Public leaderboard reads are signed by Quest with a **system actor** `sub`; registration/auth are signed by the BFF with a system actor. |
| D6 | **Same HenrikDev key.** | Reuse the existing `HENRIK_API_KEY` for the new MMR/matches calls. |
| D7 | **Reuse valorantsl-new's Discord app.** | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` come into `valorant-platform-backend` config. |
| D8 | **No geo-gating.** | Registration is NOT geo-restricted in the port (the `require_allowed_country` / `CF-IPCountry` dependency is dropped). |
| D9 | **`valorantsl-new` backend becomes a thin BFF.** | Its FastAPI keeps serving its own frontend at the same paths, but strips its DB/HenrikDev logic and delegates to `valorant-platform-backend` via signed service tokens. |

### 1.2 Problem statement

Phase 1 shipped a read-only Quest leaderboard page that proxies `valorantsl-new`'s leaderboard API directly. `valorantsl-new` is a separate FastAPI service with its own Supabase `public.players` table, a 30-min HenrikDev updater, a weekly name-audit, and a Discord role-sync bot — duplicating domain logic that `valorant-platform-backend` already centralizes (HenrikDev client, private `valorant` schema, service-token auth, player identity). The goal is to consolidate all of that into `valorant-platform-backend` so there is one authoritative Valorant backend, while keeping `valorantsl-new`'s registration frontend working through a thin BFF during the transition.

### 1.3 Goals

1. **One authoritative backend.** Leaderboard, registration, Discord auth, and the player data all live in `valorant-platform-backend`, in the private `valorant` schema.
2. **Behavior parity.** The ported endpoints reproduce `valorantsl-new`'s current behavior exactly — including the current leaderboard filter (strict 14-day `last_played_match` window, exclude `currenttierpatched = 'Unrated'`, ELO DESC) and the `rank_details` dual-shape tolerance.
3. **Repo-convention compliance.** New code follows the existing route → service → repository → session layering, `AppError` UPPER_SNAKE codes, plain-SQL migrations via `scripts/apply_migrations.py`, and is added to `DOCUMENTED_SURFACE` in `tests/unit/test_route_inventory.py`.
4. **Zero frontend churn.** `valorantsl-new`'s frontend keeps calling its own backend at the same paths; only that backend (now a thin BFF) changes underneath.
5. **Clean Phase-3 seam.** Phase 3 (cut registration into Quest, retire `valorantsl-new`) only needs Quest to add registration/auth UI + proxy; no further changes to `valorant-platform-backend`.

---

## 2. Non-goals

- Moving registration/auth *into* Quest (that is Phase 3).
- Retiring `valorantsl-new`'s frontend or backend (the backend is kept as a BFF during the transition).
- Geo-gating (explicitly dropped, D8).
- The match engine / teams / series / rankings domains already in `valorant-platform-backend` (unchanged).
- Riot official API / RSO; HenrikDev remains the only data source.

---

## 3. Architecture

### 3.1 Topology (after Phase 2)

```text
 Browser (valorantsl-new frontend, /register)
   → valorantsl-new backend (thin BFF: no DB, no Henrik, signs HMAC)
        → valorant-platform-backend  (auth / registration / leaderboard routers)
             → valorant schema (leaderboard_players) + HenrikDev MMR client

 Browser (Quest /valorant-leaderboard)
   → Quest Express (signs HMAC with system actor)
        → valorant-platform-backend  (leaderboard router)

 valorant-platform-backend background workers (updater + name_audit + discord-bot)
   → HenrikDev + Discord  →  valorant schema (leaderboard_players)
```

### 3.2 Service ownership

- `valorant-platform-backend` owns: `leaderboard_players` table, leaderboard/registration/auth endpoints, HenrikDev MMR calls, updater/name-audit/discord-bot workers, migration script.
- `valorantsl-new` owns: the registration frontend + a thin BFF that signs service tokens and forwards.
- `QuestEsports` owns: the public `/valorant-leaderboard` page + proxy (repointed to `valorant-platform-backend`, system-actor signed).

---

## 4. Data model — `leaderboard_players`

New table `leaderboard_players` in the private `valorant` schema (migration `0015_leaderboard_players.sql`). It is deliberately NOT named `players` — that table already exists for match-engine player identity (`0001_players.sql`) and is a different concept (canonical name#tag→puuid resolution vs. Sri Lankan leaderboard ranking with Discord identity + HenrikDev MMR).

### 4.1 Columns (mirror `valorantsl-new` `public.players`, dropping legacy/unused)

| Column | Type | Notes |
|---|---|---|
| `puuid` | text **PK** | |
| `name`, `tag`, `region` | text not null | |
| `discord_id` | text not null default `''` | snowflakes AND string handles |
| `discord_username` | text not null | unique index |
| `elo` | integer | indexed DESC |
| `currenttierpatched` | text | drives the "exclude Unrated" filter |
| `rank_details` | jsonb not null default `'{}'` | dual shape (flat + legacy `data.*`) |
| `peak_rank` | jsonb | `{tier_name, season_short, tier}` |
| `seasonal_ranks` | jsonb | array of seasonal rank objects |
| `last_played_match` | timestamptz | indexed; drives the 14-day filter |
| `update_source` | text | e.g. `"updater_service"` |
| `updated_at` | timestamptz | |

Dropped (unused/legacy in `valorantsl-new`): `match_stats`, `account_level`, `card`, `raw_source`, `seasonal_extended_at`, `last_updated`, `row_created_at`, `row_updated_at`.

### 4.2 `rank_details` dual-shape tolerance

Production data has 491 flat-shape rows and 1 legacy nested (`rank_details.data.*`) row. The ported code MUST keep the `get_rank_field` tolerance (read `rank_details[key]` first, fall back to `rank_details["data"][key]`) anywhere it reads a rank field — mirrored from `valorantsl-new` `models/user.py` and its discord-bot.

---

## 5. Endpoint inventory (ported)

All routes are **service-token gated** (`Depends(require_service_token)`) except the repo's existing open `/api/v1/health`. Paths are preserved from `valorantsl-new` so the BFF and Quest can call them with minimal change. Every new route must be added to `DOCUMENTED_SURFACE` in `tests/unit/test_route_inventory.py`.

### 5.1 `leaderboard` router (`app/api/routes/leaderboard.py`, prefix `/api/v1`)

| Method | Path | Behavior (parity with `valorantsl-new`) |
|---|---|---|
| GET | `/api/v1/leaderboard` | Paginated `page`(≥1)/`per_page`(1–200); filter `last_played_match >= now()-14d` AND `currenttierpatched != 'Unrated'`; `elo DESC`; 404 past last page → `LeaderboardPage{entries,total,page,per_page,total_pages}` |
| GET | `/api/v1/leaderboard/top/{count}` | Top N (page-1 query, `count` 1–100) → `LeaderboardEntry[]` |
| GET | `/api/v1/leaderboard/search/{discord_username}` | case-insensitive exact match → `LeaderboardEntry \| null` |
| GET | `/api/v1/leaderboard/stats` | `{total_users, highest_elo, lowest_elo, average_elo, rank_distribution}` |

`LeaderboardEntry` (camelCase projection for Quest, snake_case upstream-compat in the DB): `{puuid, name, tag, discord_username, current_tier, elo, rank_in_tier, peak_rank, peak_season, last_played_match}` — matching the Phase-1 Quest contract so `QuestEsports`'s `valorant-leaderboard` client needs only a base-URL + auth change.

### 5.2 `registration` router (`app/api/routes/registration.py`, prefix `/api/v1/register`)

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/register/preview` | Fetch live HenrikDev MMR + last match; 409 if puuid exists, 404 no competitive data → `PlayerPreview` |
| POST | `/api/v1/register/submit` | Fetch MMR, upsert `leaderboard_players`; 409 discord/puuid dupes, 404 not found → `{success, player}` |
| GET | `/api/v1/register/preview/{puuid}` | GET alias of preview |
| POST | `/api/v1/register` | POST alias of submit (frontend hits this) |

No geo-gating (D8). The "handle 403 and other HenrikDev errors in preview" behavior from the latest `valorantsl-new` commit is preserved (map upstream errors to `AppError` codes rather than blank/500).

### 5.3 `auth` router (`app/api/routes/auth.py`, prefix `/api/v1/auth`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/v1/auth/discord/login` | Return Discord OAuth authorize URL |
| GET | `/api/v1/auth/discord/callback?code=` | Exchange code → Discord user, check DB, in-memory code dedupe (409) |
| POST | `/api/v1/auth/check-discord` | `{discord_id}` → `{exists, user\|null}` |
| POST | `/api/v1/auth/check-puuid` | `{puuid}` → `{exists, user\|null}` |
| GET | `/api/v1/auth/login` | alias of login |
| GET | `/api/v1/auth/check-discord/{discord_id}` | GET alias |
| GET | `/api/v1/auth/check-puuid/{puuid}` | GET alias |

Discord OAuth uses `fastapi-discord` (already a `valorantsl-new` dep) or an equivalent, with `DISCORD_CLIENT_ID/SECRET/REDIRECT_URI` from config.

### 5.4 App-level endpoints

`/`, `/health`, and `/api/v1/info` are NOT ported as-is: `valorant-platform-backend` already has `/api/v1/health`, and `/api/v1/info` (a self-describing map) is superseded by its OpenAPI + route-inventory test. `/` may be omitted.

---

## 6. Auth model — service token + system principal

- `require_service_token` (existing, `app/api/dependencies.py`) gates every new route. No changes to its HMAC verification.
- A **system principal** is a fixed, configured `sub` value used for non-user callers. Two system actors are introduced via config:
  - `QUEST_LEADERBOARD_SYSTEM_ACTOR` — Quest's public-leaderboard proxy signs with this `sub`.
  - `VALORANTSL_BFF_SYSTEM_ACTOR` — the thin BFF signs registration/auth with this `sub`.
- The token's `sub` is not interpreted as a user identity for these routes (the player's Discord id/username travel in the request body/path, not the token). This matches the existing behavior where the FastAPI validates the signature, not `sub` semantics.
- `QuestEsports` already has `valorant.auth.js` (HMAC signer) and config for shared secrets; it gains a system-actor signing path for the public leaderboard (no `actorUserId`). The BFF gains the same signer using the shared `QUEST_SERVICE_SHARED_SECRETS`.

---

## 7. HenrikDev MMR client

`app/integrations/henrik/` already owns all HTTP. Extend it with the player-MMR calls used by registration + updater:

- `GET /valorant/v3/by-puuid/mmr/{region}/{platform}/{puuid}` — MMR/rank.
- `GET /valorant/v4/by-puuid/matches/{region}/{platform}/{puuid}?mode=competitive&size=1` — last competitive match.

Same client, same `HENRIK_API_KEY`, same retry/timeout posture (`HENRIK_*` settings). The MMR parsing logic (nested `data.current.tier` vs. flat) is centralized here, replacing the duplicated parsing currently split across `valorantsl-new` `registration.py` and `updater/riot_api.py`.

---

## 8. Background workers

Port `valorantsl-new`'s `updater/` + `discord-bot/` into `valorant-platform-backend` as a top-level `workers/` package, sharing the app's `leaderboard_players` model + HenrikDev client + config:

- **`updater`** — every `update_interval_minutes` (30): pull all PUUIDs, fetch MMR + last match, write `name/tag/rank_details/elo/currenttierpatched/peak_rank/seasonal_ranks/last_played_match/update_source`. Honors `Retry-After` on 429, `max_retries`, `rate_limit_delay`. Keeps the initial-full-pass-on-startup behavior.
- **`name_audit`** — weekly Sunday 02:00 Asia/Colombo (with the Sunday 01:30–06:00 rank-update pause window). Verifies each player's name/tag against Riot and corrects drift.
- **`discord-bot`** — every 15 min: assign rank/Verified roles + rank nicknames across the two bots; write back discord_id/username corrections.

These are in-process scheduled loops (as in `valorantsl-new`) — no new infra. They read/write `leaderboard_players` via the same async SQLAlchemy layer.

---

## 9. One-time data migration

`scripts/migrate_valorantsl_players.py` (run-once): reads `valorantsl-new`'s Supabase `public.players` (DSN via env), normalizes (`rank_details` left as-is for dual-shape tolerance; discord_username dedupe keeps newest by `max(updated_at, last_updated)`), upserts into `valorant.leaderboard_players` on `puuid`. Dry-run by default, `--apply` to write. Requires the source DSN only at migration time.

---

## 10. Quest side

- Repoint `QuestEsports` `valorant-leaderboard` client (`client.js`) from `VALORANT_SL_API_URL` → `valorant-platform-backend`'s internal base URL, signing an HMAC service token with the system actor (`QUEST_LEADERBOARD_SYSTEM_ACTOR`).
- The Phase-1 proxy contract (`{entries,total,page,perPage,totalPages}` / `{entry}`) is unchanged, so the page + frontend fetchers are untouched. Only the Quest backend module's client changes.
- New config: `QUEST_LEADERBOARD_SYSTEM_ACTOR` (or reuse an existing system-actor convention) + the target base URL.

---

## 11. `valorantsl-new` thin BFF

- Keep its FastAPI + routers/paths, but each handler becomes a forwarder: sign an HMAC service token (shared secrets) and call the corresponding `valorant-platform-backend` endpoint, returning the response unchanged.
- Remove from `valorantsl-new`: the SQLAlchemy DB layer, the HenrikDev fetch logic, the geo dependency, and the updater/discord-bot (now in `valorant-platform-backend`).
- Its frontend is unchanged. This is the transition bridge until Phase 3.

---

## 12. Cutover order (D4)

1. Implement + test everything in `valorant-platform-backend` (routers, table, workers, migration script) — nothing live changes yet.
2. Run the one-time migration (dry-run → `--apply`).
3. Start the `valorant-platform-backend` updater/name-audit/discord-bot against `valorant.leaderboard_players`.
4. Repoint Quest's leaderboard client to `valorant-platform-backend` (system actor).
5. Convert `valorantsl-new` backend to the thin BFF (repoint at `valorant-platform-backend`).
6. Verify end-to-end (leaderboard page, registration preview/submit, auth) and decommission the old `valorantsl-new` Supabase table.

---

## 13. Testing & docs

- **Backend tests:** unit + integration for leaderboard (filter: 14-day + exclude Unrated; pagination; search; stats), registration (preview/submit, 409/404, HenrikDev error mapping), auth (Discord OAuth flow with fakes), `rank_details` dual-shape, the migration script (dry-run idempotence), and the route-inventory contract (all new routes in `DOCUMENTED_SURFACE`, all service-token gated).
- **Worker tests:** updater parse/write + retry; name-audit correction; discord-bot role mapping (fakes).
- **Docs:** ADR(s) for the `leaderboard_players` domain + system-principal auth; OpenAPI entries for all new routes; update `docs/` where the endpoint surface changes.
- **Quest:** update `valorant-leaderboard` client tests for the new target + system-actor signing; no frontend changes.

---

## 14. Files touched

**`valorant-platform-backend` (primary):**
- `supabase/migrations/0015_leaderboard_players.sql` (new)
- `app/db/models/leaderboard_player.py`, `app/db/repositories/leaderboard_player_repository.py` (new)
- `app/api/routes/leaderboard.py`, `registration.py`, `auth.py` (new)
- `app/schemas/leaderboard.py`, `registration.py`, `auth.py` (new)
- `app/services/leaderboard_service.py`, `registration_service.py`, `auth_service.py` (new)
- `app/api/dependencies.py` (register service factories + system-actor awareness)
- `app/main.py` (include routers), `app/config.py` (Discord/system-actor/HenrikDev-MMR settings)
- `app/integrations/henrik/` (MMR/matches client + mapper)
- `workers/` (updater, name_audit, discord_bot) (new)
- `scripts/migrate_valorantsl_players.py` (new)
- `tests/` (unit + integration + fixtures)

**`QuestEsports`:**
- `backend/src/modules/valorant-leaderboard/client.js` (repoint + system-actor signing)
- `backend/src/config/env.js` + `.env.example` (system actor + target URL)
- tests for the client change

**`valorantsl-new` (thin BFF):**
- backend routers become forwarders (sign service tokens); delete DB/Henrik/geo/workers

---

## 15. Risks & open items

- **`rank_details` dual shape** — preserved via `get_rank_field`; the migration must not normalize it.
- **System-principal semantics** — `sub` is not user-identity for these routes; the token still authenticates the caller. Confirmed acceptable; no FastAPI verification change needed.
- **Discord OAuth in the standard backend** — `fastapi-discord`'s in-memory code-dedupe is single-instance (as in `valorantsl-new`); acceptable until Phase 3 moves auth to Quest.
- **Geo-gating discrepancy** — `valorantsl-new` `master` still contains `require_allowed_country` (verified after sync); D8 drops it from the port. Confirm this is intended (the user stated geo-gating is "already dropped"; if it must remain, re-add it config-gated).
- **Worker single-instance** — the scheduled loops assume one replica (as today); no distributed lock is added.
- **`/api/v1/info`** — dropped in favor of OpenAPI; confirm no consumer relies on it.
