# VALORANT Match Data — Findings and Plan

Goal: public, VLR.gg-style match pages — scoreboard, per-map results, round
timeline, economy — and automated ingestion so match data arrives without an
admin typing Riot IDs.

This file is a handover. It records what was inspected, what already exists,
what is missing, and the decisions still open, so the work can be picked up
without repeating the investigation.

Written 25 August 2026, and revised the same day once A-D were built: what
shipped, what the plan got wrong, and which of its open questions now have
answers. Everything below was read from source, not assumed.

**Status at revision:** A (#69), B (#70) and C (#72) are merged, C is in
production. D's anchor half is #74. The ranking scheduler is #73. None of it
has processed a real match — see §5.1.

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

### A — Widen the mapper *(small, no migration)* — **done, PR #69**

Project the six dropped fields in `mapMatchPlayer`, and carry `duration_ms`,
`map_id` and `game_version` through `mapMatchDetail`. Nothing else changes;
`rosterSummary` starts carrying the richer shape.

Shipped as written, plus `agent_id` — the plan had scoped it out on the
grounds that `agent_name` is the display value, but an agent icon needs the
id, and a name is a display string that can be localised or renamed while the
id is stable. Cheaper to carry it now than to widen the mapper twice.

No stats are derived or stored: ACS, ADR and HS% are ratios over
`red_score + blue_score`, cheap at read time, and storing them would freeze a
formula the upstream owns.

### B — Structured Quest tables *(medium, additive migration)* — **done, PR #70**

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

Shipped as `match_maps` and `match_player_stats`. `MatchRound` was not built —
it depends on §5.2, which is still open. `rounds_played` was deliberately left
out of `match_maps`: it is `red_score + blue_score`, and storing a derived
value freezes a formula the upstream owns.

### C — Public read path *(medium)* — **done, PR #72, in production**

Shipped as `GET /api/v1/valorant/series/:seriesId` and
`GET /api/v1/tournaments/:slug/results`, with
`frontend/app/matches/[id]/page.tsx` and
`frontend/app/tournaments/[slug]/results/page.tsx`.

Two corrections to what this section assumed. The route is keyed on the
**series**, not a bracket `Match` — `match_maps.match_id` is still NULL for
every row, so a bracket-keyed endpoint would have returned nothing for every
match. And there is **no timeline**: it needs §5.2, which is unresolved.

`QuestValorantSeries` has no winner column — `calculatedWinnerId` and
`officialWinnerId` belong to the upstream's series view, not to Quest's table —
so the result is counted from maps won. That is also the only version a reader
can check against the scoreboard in front of them.

Same projection discipline as the player profile: no PUUIDs, no emails, no
internal ids. See `backend/src/modules/players/codemap.md`.

Link scoreboard rows to `/players/QPID-…` where a `playerId` resolves — that is
what turns a scoreboard into a profile network.

### D — Automated ingestion *(largest)* — **anchors done, PR #74**

Roster-derived discovery per tournament, as in §3. Must be idempotent: reuse the
existing `QuestValorantOperation` ledger, and never attach a map twice —
`QuestValorantSeriesGame` already has `@@unique([matchId])` and
`@@unique([questSeriesId, gameNumber])`.

The anchor half is built: `valorant-anchors.service.js` derives Riot IDs from
approved rosters and pairs them **from the bracket** rather than from every
combination of teams, so a proposed fixture already knows its `Match` — which
is the value `match_maps.match_id` has been waiting for, and most of §5.3.

It proposes and never commits. Import, attach and finalize are all still
explicit admin actions, because a wrongly attached map changes a rating and a
public result.

**Untested against the upstream.** The derivation and its selects are covered,
but the `discover` round trip has never run — see §5.1.

### E — Backfill the August/September event *(one-off)* — **not possible as written**

Run D against the completed event to populate real history.

§5.1 is answered and the answer removes the source: the upstream `matches`
table is empty. There is nothing to backfill *from*, and whether HenrikDev
still holds those matches is a separate live question, not a database one.

**Do this early, or at least check feasibility early — see §5.**

---

## 5. Open questions, in priority order

1. **~~Are the August matches in the upstream `matches` table?~~ ANSWERED,
   25 August 2026 — no, and neither is anything else.**

   ```sql
   SELECT count(*) AS total, min(started_at), max(started_at),
          min(imported_at), max(imported_at)
   FROM valorant.matches;   -- schema is `valorant`, not `public`
   -- total 0, every other column NULL
   ```

   `matches` is written only by import, and `imported_at` is NULL, so **no
   match has ever been imported at all**. The pipeline has never run end to
   end, which is a wider finding than the question asked: everything in A–D is
   tested against fabricated data, and the first real import is also the first
   real test of the mapper, the structured tables and the scoreboard.

   E cannot be sourced from the upstream. Whether the matches are recoverable
   at all is now a **live** question, not a database one: discovery pages
   Henrik's `v4/by-puuid/matches/{affinity}/{platform}/{puuid}`, which is a
   rolling window of each player's most recent matches. So recoverability
   depends on how many matches those rosters have played *since* the event,
   not on the calendar date — and it erodes every day they keep playing.

   The way to find out is to run one two-player discovery against two players
   from that event, which is exactly what D's fixture endpoint does.

2. **`raw_payload` flag, or a derived-stats endpoint?** §2. Decides whether the
   round timeline is days or weeks of work.

3. **Bracket linkage — mostly closed by D.** `match_maps.match_id` exists and
   D's fixture endpoint pairs teams *from the bracket*, so a proposed fixture
   already knows its `Match`. What remains is writing that id when a map is
   attached; the column and the pairing are both in place.

4. **~~Does the upstream deploy alongside Quest?~~ ANSWERED — no, it ships
   independently.** `valorant-platform-backend` has its own CD workflow that
   deploys over SSH to its own host, gated on its own CI. That *lowers* the
   cost of option (2) in §2: an upstream change does not have to ride a Quest
   release, so the derived-stats endpoint is cheaper than this document
   assumed when it recommended it.

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
- **A mocked Prisma client accepts any `select`, including invented columns.**
  Two shipped in one afternoon — `finalizedAt`, and
  `calculatedWinnerId`/`officialWinnerId` (which belong to the upstream's series
  view, not to `quest_valorant_series`). Unit tests passed on all three. Probe a
  new projection against the real schema *before* writing tests around it, and
  leave a database-integration case behind that runs it.
- **The response cache outlives the row.** Both public routes are cached on the
  `foundation` tag, so a projection that correctly returns `null` for an
  unpublished tournament can still be served from cache. Visibility needs
  enforcing in the projection *and* invalidating on every admin write that can
  change a public result. A live check against seeded data found this; nothing
  that mocks Prisma or calls the service directly can.
- **Egress is the scarce resource, not storage.** The Supabase organisation hit
  141% of its 5 GB egress allowance against a 41 MB database in August 2026,
  with a grace period ending **24 September 2026**, after which requests return
  402. Idle polling and local development against the hosted database were the
  causes. `npm run dev` now uses the loopback Postgres and `dev:remote` is the
  opt-in; assume anything that polls is being counted.
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

The ranking sync (`modules/players/ranking-sync.service.js`) now **has a
scheduler** (`modules/players/ranking.jobs.js`, PR #73) on a 15-minute default
matching the leaderboard's own cadence. It is **off by default**:
`PLAYER_RANKING_SYNC_ENABLED` must be set where the upstream is configured, or
`player_rankings` stays empty and profiles and scoreboards show no rank, exactly
as before.

Due-ness is read from `player_rankings.syncedAt` rather than an in-process
timer, so a restart loop cannot walk a rate-limited leaderboard repeatedly, and
the answer is remembered between ticks so the minute timer does not query for
something it already knows.
