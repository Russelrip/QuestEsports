# Valorant Leaderboard → Quest Standardization — Full Session Handoff

**Purpose:** Complete record of everything done this session, so a fresh agent (or you) can resume with zero context loss. Covers the standardization of `valorantsl-new` into `valorant-platform-backend`, the Quest integration (leaderboard page + Quest's own registration flow), and the data migrations into testing + production.

**Working directory:** `/Users/naheedroomy/Documents/valorant-stats-endpoints/` (three sibling repos).

---

## 1. Repos, branches, remotes

| Repo | Path | Branch | Remote | Push status |
|---|---|---|---|---|
| `valorant-platform-backend` | `.../valorant-platform-backend` | `main` | `github.com/naheedroomy/valorant-platform-backend` | ✅ pushed (`fb5f3fd`) |
| `QuestEsports` | `.../QuestEsports` | `chore/local-development-environment` | `github.com/Russelrip/QuestEsports` | ✅ pushed (`3708d19`) |
| `valorantsl-new` | `.../valorantsl-new` | `master` | `github.com/naheedroomy/valorantsl-new` | ⚠️ **2 unpushed commits** (`b4ccfca`, `7917d51` — thin-BFF conversion, deliberately deferred) |

---

## 2. What was accomplished

### 2.1 Phase 2 — port `valorantsl-new` into `valorant-platform-backend` (12 tasks, all done + reviewed)

All backend logic now lives in `valorant-platform-backend`:

| Phase | What |
|---|---|
| **A** | New `leaderboard_players` table (`supabase/migrations/0015_leaderboard_players.sql`) + ORM model + repository; leaderboard schemas; `LeaderboardService` + `get_rank_field` (dual-shape tolerant) + Henrik MMR client/mapper; `leaderboard` router (4 GET routes, service-token gated) + route-inventory. |
| **B** | Registration (`/api/v1/register/preview`, `/submit`, aliases) + Discord OAuth auth (`/api/v1/auth/*` — login/callback/check-discord/check-puuid + aliases) via a minimal httpx OAuth exchange (no `fastapi-discord`). |
| **C** | `workers/` package: `updater.py` (30-min rank refresh), `name_audit.py` (weekly name/tag audit), `discord_bot.py` (15-min role/nickname sync + write-back). |
| **D** | `scripts/migrate_valorantsl_players.py` — one-time migration (`public.players` → `valorant.leaderboard_players`), dry-run by default, `--apply` to write. |
| **E** | Quest `valorant-leaderboard` client repointed from `valorantsl.com` → `valorant-platform-backend` (HMAC system-actor signed). |
| **F** | `valorantsl-new` backend converted to a thin BFF forwarder — **DEFERRED/UNPUSHED** (you decided Quest hosts registration itself; valorantsl-new will eventually become empty). |

### 2.2 Quest's own registration flow (new — built this session)

The user's end goal is "all on Quest", so a **Quest-hosted registration page** was built (porting valorantsl-new's UI logic into Quest's Next.js + Tailwind style, NOT MUI):

- **Quest backend** (5 new HMAC proxy routes, public, no cache) under `/api/v1/valorant/leaderboard/register/...`: `discord/login`, `discord/callback`, `check-puuid` (POST), `preview` (POST), `submit` (POST). Client propagates upstream status + message (409/404/422/503), 60s timeout for Henrik-backed calls.
- **Quest frontend**: `app/valorant-leaderboard/register/page.tsx` + `components/valorant/ValorantRegistration.tsx` (3-step flow: Discord auth → PUUID + preview → confirm + submit). `lib/valorant-api.ts` fetch helpers + `lib/valorant.ts` types. The leaderboard "Register your account" CTA is now an internal `<Link>` to `/valorant-leaderboard/register`.

**This flow is verified working end-to-end locally** (Discord OAuth → PUUID → submit → row in `leaderboard_players`).

---

## 3. Architecture (final topology)

```
Browser
  → Quest frontend (Next.js, :3000)
       → Quest backend (Express, :5001)              ← Quest's "normal" backend
             ├─ Quest's usual stuff (tournaments/matches/teams/auth)
             └─ Valorant proxies (HMAC-signed, server↔server)
                   → valorant-platform-backend (FastAPI, :8000)   ← SEPARATE service
                         → Supabase (leaderboard_players) + Henrik + Discord OAuth + workers
```

- **Quest backend** = front-facing Express; the browser never talks to the platform backend directly. Wired via `VALORANT_INTERNAL_BASE_URL` in Quest's `.env`.
- **valorant-platform-backend** = separate FastAPI service, owns ALL Valorant concerns (leaderboard + registration + auth + the admin valorant module + workers + data).
- **valorantsl-new** = legacy; will become an empty repo (server redirects to Quest).

---

## 4. Data migrations

| DB | Supabase project | Role | State |
|---|---|---|---|
| `nrqjxxmeufrztyyxysbd` (aws-1-eu-west-1) | platform backend **testing** | `valorant` schema | 484 players in `leaderboard_players` |
| `hnmdjxunraeqyklzgiro` (aws-0-eu-west-3) | platform backend **production** | `valorant` schema | 16 migrations applied; 484 players migrated ✅ |
| `ixojdexnhodqizvbnkcx` (aws-1-eu-west-1) | **valorantsl-new** source | `public.players` | 484 rows (source of truth) |

The migration script (`scripts/migrate_valorantsl_players.py`) is **idempotent** (upserts on `puuid`), so it can be re-run to refresh production from the live source anytime:
```bash
DATABASE_URL="postgresql+asyncpg://<prod>?ssl=require" \
VALORANTSL_SOURCE_DB_DSN="postgresql+asyncpg://<ixojdexnhodqizvbnkcx>?ssl=require" \
uv run python -m scripts.migrate_valorantsl_players   # dry-run, then add --apply
```
(DB credentials live in the git-ignored `.env` files — not in this doc.)

---

## 5. Local testing state (what's running)

- platform backend `:8000` — running, `APP_ENV=development`, with Discord config + `kid-local`/`kid-bff` in `QUEST_SERVICE_SHARED_SECRETS`.
- Quest backend `:5001` — running, has the new registration routes.
- Quest frontend `:3000` — running, has the new register page.
- valorantsl-new BFF `:8001` — running but **unused** (Quest hosts registration now).

**Local commands:**
```bash
# platform backend
cd valorant-platform-backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
# tests: uv run pytest -m "not live" -q ; uv run ruff check app tests scripts
# integration: TEST_DATABASE_URL=... uv run pytest tests/integration -q

# Quest backend + frontend
cd QuestEsports/backend && npm run dev      # :5001
cd QuestEsports/frontend && npm run dev     # :3000
# tests: node --test tests/valorant-leaderboard.*.test.js  (backend) ; npm test (frontend)

# workers
uv run python -m workers.updater --once | --test <PUUID> | --info
uv run python -m workers.name_audit
uv run python -m workers.discord_bot
```

---

## 6. Production deploy runbook (REMAINING WORK)

### 6.1 Deploy the platform backend (only piece with no host yet)

FastAPI service, run **exactly ONE uvicorn worker** (in-memory OAuth code dedupe). Env template:

```bash
APP_ENV=production
DATABASE_URL=postgresql+asyncpg://<prod hnmdjxunraeqyklzgiro credentials>?ssl=require
HENRIK_API_KEY=<henrik key>
DISCORD_CLIENT_ID=1252755055006715954
DISCORD_CLIENT_SECRET=<the D7 app client secret>
DISCORD_REDIRECT_URI=https://questesports.lk/valorant-leaderboard/register
QUEST_SERVICE_SHARED_SECRETS=kid-local=<quest secret>            # Quest signs with kid-local
QUEST_SERVICE_ISSUER=quest-esports
QUEST_SERVICE_AUDIENCE=valorant-platform
TZ=Asia/Colombo                                                   # updater pause-window parity
# (discord bot worker also needs:)
DISCORD_TOKEN_1=... DISCORD_TOKEN_2=... DISCORD_GUILD_ID=...
```

Run:
```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
# workers (separate processes / systemd / pm2):
uv run python -m workers.updater                 # 30-min loop
uv run python -m workers.name_audit              # cron: Sunday 02:00 Asia/Colombo
uv run python -m workers.discord_bot             # 15-min loop
```

### 6.2 Point Quest at it (prod `.env` on the Quest VPS)

```bash
VALORANT_INTERNAL_BASE_URL=https://<platform-backend host>
VALORANT_SERVICE_KEY_ID=kid-local
VALORANT_SERVICE_SECRET=<same secret as QUEST_SERVICE_SHARED_SECRETS kid-local>
QUEST_LEADERBOARD_SYSTEM_ACTOR=quest-leaderboard   # any fixed string; backend doesn't validate sub
```

### 6.3 Discord portal

Add `https://questesports.lk/valorant-leaderboard/register` to the D7 app (`1252755055006715954`) **OAuth2 → Redirects**. Keep `https://valorantsl.com/register` until valorantsl-new is retired.

### 6.4 Deploy Quest (merge the branch + frontend)

The Quest work lives on `chore/local-development-environment` — merge it to `main` (or deploy the branch), deploy the frontend to Vercel, then verify `https://questesports.lk/valorant-leaderboard` + `/valorant-leaderboard/register`.

### 6.5 Cutover order (safe sequence)

1. Deploy platform backend + env + workers (6.1).
2. Migrate data (already done — section 4; re-run to refresh).
3. Point Quest at it (6.2) + deploy Quest (6.4).
4. Update Discord redirect (6.3).
5. Verify e2e, then retire valorantsl-new (redirect → Quest, decommission its Supabase table).

---

## 7. Known items / gotchas

- **7 pre-existing ruff errors + 1 network-dependent test failure** (`test_series_create_contract_shape`) in valorant-platform-backend — unrelated to this work; separate cleanup.
- **~40 deferred minor findings** triaged in the SDD ledger: `.superpowers/sdd/2026-08-14-valorant-player-leaderboard-standardization/progress.md`.
- **valorantsl-new thin BFF** (commits `b4ccfca`, `7917d51`) is unpushed + effectively abandoned (Quest hosts registration instead).
- **Error-shape change**: platform backend errors are `{"error":{"code","message","request_id"}}` (was valorantsl-new's `{"error":true,"message"}`). The Quest registration UI handles this; watch any other consumers.
- **`discord_client_secret` is in the git-ignored `.env`** — not committed, not in this doc.
- **One uvicorn worker only** (in-memory `_used_codes` OAuth dedupe) — no `--workers N` until the dedupe moves to a shared store.
- **The `b9f1b94` / `e4682cd` / `a5881bc` / `4febe61` / `f572c36` / `8e57e62` commits** on the repos are the user's own "manual series" work, interleaved and untouched.

---

## 8. Key files (for quick orientation)

- `valorant-platform-backend/app/api/routes/{leaderboard,registration,auth}.py` — the 15 new endpoints.
- `valorant-platform-backend/app/db/repositories/leaderboard_player_repository.py` — all DB access.
- `valorant-platform-backend/app/services/{leaderboard_service,registration_service,auth_service,rank_field}.py`.
- `valorant-platform-backend/app/integrations/henrik/{client,mapper}.py` — Henrik (MMR/matches/account).
- `valorant-platform-backend/workers/{updater,name_audit,discord_bot}.py`.
- `valorant-platform-backend/scripts/migrate_valorantsl_players.py`.
- `QuestEsports/backend/src/modules/valorant-leaderboard/{client,service,controller}.js` + `routes/v1.js`.
- `QuestEsports/frontend/app/valorant-leaderboard/register/page.tsx` + `components/valorant/ValorantRegistration.tsx` + `lib/{valorant-api,valorant}.ts`.
