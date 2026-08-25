# VALORANT Match Data — Findings and Plan

Goal: public, VLR.gg-style match pages — scoreboard, per-map results, round
timeline, economy — and automated ingestion so match data arrives without an
admin typing Riot IDs.

This file is a handover. It records what was inspected, what already exists,
what is missing, and the decisions still open, so the work can be picked up
without repeating the investigation.

Written 25 August 2026. Everything below was read from source, not assumed.

---

## 1. What already exists

### Quest side (this repo)

`backend/src/modules/valorant/` — admin-only, ~2,200 lines:

| File | Role |
| --- | --- |
| `valorant.client.js` | HTTP client to the upstream service |
| `valorant.auth.js` | Signed service tokens (HS256, `kid`/`iss`/`aud`/`operation_id`) |
| `valorant.mapper.js` | snake_case upstream → camelCase Quest projections |
| `valorant.service.js` | Bindings, discovery, import, series, finalize, reconcile |
| `valorant.controller.js` | Admin routes under `/api/admin/valorant/*` |

Prisma models:

- `ValorantTeamBinding` — binds a `SavedTeam` to an upstream VAL team
- `QuestValorantSeries` — a BO1/BO3 between two bindings; has `tournamentId`,
  `format`, `playedAt`, `status`, `valorantSeriesUuid`
- `QuestValorantSeriesGame` — one map: `gameNumber`, `matchId`, `mapName`,
  `teamASide` / `teamBSide`
- `QuestValorantMatch` — cached per-map result: scores, `winningSide`, and
  `rosterSummary` as **opaque JSON**
- `QuestValorantOperation` — operation ledger for idempotency and reconciliation

The series → maps → players shape is therefore already modelled, and already
tied to a tournament. **There is no public read path**: everything is behind
`requireAdmin`.

### Upstream (`valorant-platform-backend`, separate repo)

FastAPI + SQLAlchemy + Supabase, ingesting from HenrikDev. Relevant models:

- `matches` — `henrik_match_id`, `map_name`, `started_at`, `duration_ms`,
  `red_score`, `blue_score`, `winning_side`, `game_version`, and
  **`raw_payload` (JSONB, NOT NULL)** — the complete Henrik v4 envelope
- `match_players` — per-player, per-match snapshot (see below)
- `players`, `leaderboard_players`, `rating_event`, `rating_run`, `series`

---

## 2. The central finding

**The stats needed for a VLR-style scoreboard are already ingested and already
returned by the upstream API. Quest discards them.**

`MatchPlayerResponse` (`app/schemas/matches.py`) returns:

```
id  player_id  puuid  name  tag  side
agent_id  agent_name
score_total  kills  deaths  assists
damage_dealt  damage_received
headshots  bodyshots  legshots
```

`valorant.mapper.js#mapMatchPlayer` projects only:

```js
puuid, name, tag, side, agentName, kills, deaths, assists
```

So `score_total`, `damage_dealt`, `damage_received`, `headshots`, `bodyshots`
and `legshots` are dropped on the Quest side. Recovering them is a **mapper
change in this repo**, not upstream work.

### Derivable immediately once the mapper is widened

| Stat | Formula |
| --- | --- |
| Rounds | `red_score + blue_score` |
| ACS | `score_total / rounds` |
| ADR | `damage_dealt / rounds` |
| HS% | `headshots / (headshots + bodyshots + legshots)` |
| K/D/A, KD, +/− | direct / `kills - deaths` |
| Agent, side | direct |

That is most of a VLR match page.

### Reachable, but needs an upstream decision

Round timeline, economy, plants and defuses, first bloods, multi-kills,
clutches, KAST, per-half splits.

These live in `matches.raw_payload`, which is retained in full. The API already
has the plumbing to return it: `MatchDetailResponse.raw_payload` plus
`raw_payload_available`, echoed only when `Settings.raw_payload_in_responses`
is true (`app/config.py:52`, default `False`). A custom serializer omits the key
entirely when unset, so the response shape does not change.

Two options, both in the other repo:

1. **Enable the flag.** Smallest change; Quest parses Henrik's shape itself.
   Couples Quest to Henrik's payload format.
2. **Add a derived-stats endpoint** that projects rounds/economy out of
   `raw_payload` into a typed schema. More work upstream, but Quest stays
   insulated from Henrik's format and the parsing lives next to the data.

**Recommend (2)** if the round timeline is a permanent feature rather than an
experiment. `raw_payload` is Henrik's contract, not Quest's, and a format change
would otherwise break the public match page.

---

## 3. Why ingestion is manual today

The current admin flow:

1. `bindTeam` — bind each `SavedTeam` to an upstream VAL team
2. `discover` — **requires two anchor Riot IDs, one player from each team**,
   posted to `/api/v1/match-search/two-player`
3. `importMatch` — per candidate match
4. `createSeries` / `createManualSeries`, then `attachGame` per map with sides
5. `finalizeSeries` — pushes to the upstream rating engine

Step 2 is the reason it is manual: an admin has to know and type a player from
each side.

### What changed, and why automation is now possible

Quest now knows the rosters. `RegistrationMember` → `player_id` → `GameAccount`
→ `external_id` (the PUUID), for approved registrations, per tournament, with
frozen snapshots of who actually played.

So the anchors are **derivable**. That is the concrete payoff of the identity
work shipped 24–25 August: discovery can be driven from the bracket instead of
from an admin's memory.

Automated shape:

```
tournament
  -> approved registrations (TeamRegistration.status = approved)
    -> RegistrationMember -> GameAccount.externalId   (anchors per team)
      -> discover(anchorA, anchorB, from = tournament window)
        -> candidates matched against bracket fixtures
          -> import + attach + (admin confirms) finalize
```

Admin **confirms** rather than types. Automation should propose, never
auto-finalize: a wrongly attached map changes ratings and a public result.

---

## 4. Plan

### A — Widen the mapper *(small, no migration)*

Project the six dropped fields in `mapMatchPlayer`, and carry `duration_ms`,
`map_id` and `game_version` through `mapMatchDetail`. Nothing else changes;
`rosterSummary` starts carrying the richer shape.

### B — Structured Quest tables *(medium, additive migration)*

`QuestValorantMatch.rosterSummary` is opaque JSON. That is fine for an admin
panel and wrong for a public page that must sort, filter and aggregate.

Proposed, all additive:

- `MatchMap` — one row per played map: map, sides, scores, winner, duration,
  linked to `Match` and to `QuestValorantSeriesGame`
- `MatchPlayerStat` — one row per player per map: agent, side, score, K/D/A,
  damage dealt/received, head/body/leg shots, and a nullable `playerId` link so
  a scoreboard row can point at a Quest profile
- `MatchRound` — only if option (2) above is taken: round number, winner,
  win condition, economy, plant/defuse

Keep `rosterSummary` during the expand phase; it stays authoritative until reads
move.

### C — Public read path *(medium)*

- `GET /api/matches/:id/public` and `GET /api/tournaments/:slug/results`
- `frontend/app/matches/[id]/page.tsx` — scoreboard, per-map, timeline
- `frontend/app/tournaments/[slug]/results/page.tsx`

Same projection discipline as the player profile: no PUUIDs, no emails, no
internal ids. See `backend/src/modules/players/codemap.md`.

Link scoreboard rows to `/players/QPID-…` where a `playerId` resolves — that is
what turns a scoreboard into a profile network.

### D — Automated ingestion *(largest)*

Roster-derived discovery per tournament, as in §3. Must be idempotent: reuse the
existing `QuestValorantOperation` ledger, and never attach a map twice —
`QuestValorantSeriesGame` already has `@@unique([matchId])` and
`@@unique([questSeriesId, gameNumber])`.

### E — Backfill the August/September event *(one-off)*

Run D against the completed event to populate real history.

**Do this early, or at least check feasibility early — see §5.**

---

## 5. Open questions, in priority order

1. **Are the August matches in the upstream `matches` table?**
   The tournament was **not ingested at the time**. `matches` is populated only
   by import, and HenrikDev retains only recent match history. If those matches
   were never imported, the raw payloads may no longer be fetchable at all.
   This is a deadline, not a code problem. Check first:
   ```sql
   SELECT count(*), min(started_at), max(started_at) FROM matches;
   ```
   If they are gone, the August event needs manual entry and only future events
   can be automated — which changes the value of E entirely.

2. **`raw_payload` flag, or a derived-stats endpoint?** §2. Decides whether the
   round timeline is days or weeks of work.

3. **Bracket linkage.** `Match` (Quest) and `QuestValorantSeries` both exist and
   are both tournament-scoped, but nothing joins a discovered VAL series to a
   bracket `Match`. Needed before results can render against a bracket.

4. **Does the upstream deploy alongside Quest?** Its topology is not documented
   in this repo. Anything requiring an upstream change needs that answered.

---

## 6. Constraints that apply to all of this

Learned the hard way on 24–25 August; ignoring any of them fails CI or
production.

- **Every new public table needs RLS** and the Supabase Data API roles revoked.
  `scripts/verify-database-security.js` fails otherwise. Copy the block from
  `20260823120000_add_players_and_game_accounts`.
- **`id` and `updated_at` must carry no database default.** Prisma generates
  both client-side; a DB-side default is drift and `prisma migrate diff
  --exit-code` fails. Supply them explicitly in every INSERT.
- **Expand, never contract.** New columns nullable, legacy columns retained and
  authoritative until reads move. Dropping is a later, separate release.
- **Verify against the local database, never Supabase.** `backend/.env` points
  at production:
  ```bash
  docker compose -f docker-compose.local.yml up -d postgres
  cd backend && node scripts/with-local-db.js npx prisma migrate deploy
  ```
- **Run the full CI sequence locally.** `npm test` alone is not enough:
  `migrate status`, `verify-prisma-schema-scope.js`,
  `verify-database-security.js`, `migrate diff --exit-code`, `test:coverage`,
  `lint`.
- **Every mounted route must be in `src/lib/openapi.js`** or `openapi.test.js`
  fails.
- **Read the nearest `codemap.md` before changing a directory, and update it**
  — required by `AGENTS.md`.
- **Deploying**: backend CD pauses for the `Production` environment's required
  reviewer; approve under `Actions -> the run -> Review deployments`. When
  migrations are pending, confirm the log prints
  `Encrypted production backup uploaded successfully:` **before** the first
  `Applying migration`. Migrations are forward-only.

---

## 7. Related state

Phases 1–7 of the platform integration shipped 24–25 August and are in
production — canonical game identity, audit provenance, durable Discord
identity, versioned rulebooks, public player profiles, cached rankings. See
[Platform Integration Roadmap](./platform-integration-roadmap.md) for what
remains there, including the Discord bot.

The ranking sync (`modules/players/ranking-sync.service.js`) exists and is
tested but **has no scheduler**, so `player_rankings` stays empty and profiles
show no rank. The leaderboard refreshes every **15–30 minutes**, so a 15-minute
interval matches its cadence. Wiring it to `BackgroundJob` is small and
unblocks the rank display on both profiles and any future scoreboard.
