# Platform Integration Roadmap

Remaining work for the Quest platform integration: unifying `questesports.lk`,
the database, Discord, and the VALORANT SL leaderboard so the website is the
permanent source of truth and Discord handles community and live operations.

Phases 1–7 shipped on 24–25 August 2026. This file records what is left, why
each item is not done yet, and what a person has to decide before it can be.

Status legend: **Live** in production · **Open** decision needed · **Ready**
specified, just needs building.

---

## Done — in production

| Phase | What landed | Migration |
| --- | --- | --- |
| 1 | Canonical game identity (`games`, `game_aliases`, `game_id` on 8 tables) | `20260824210000_add_canonical_game` |
| 2 | Audit provenance (`audit_logs.source`, `.reason`) | `20260824230000_add_audit_source_and_reason` |
| 3 | Durable Discord identity (`discord_identities`) | `20260824234500_add_discord_identity` |
| 4 | Layered, versioned rulebooks | `20260825010000_add_rulebook_versioning` |
| 6 | Public player profiles (`GET /api/players/:publicId`) | none |
| 7 | Cached player rankings (`player_rankings`) and their sync scheduler | `20260825030000_add_player_rankings` |

Every migration is **expand-only**: legacy columns are retained and still
authoritative, and no read path depends on the new ones. The contract step —
dropping `tournaments.game`, `rulebooks.game`, `saved_teams.game`,
`recruitment_applications.game`, the three veto catalog `game` columns, and
`rulebooks.content` — is deliberately not done and belongs in a later release
once reads have moved.

### Phase 5 (eligibility) — dropped, not deferred

A configurable restricted-team / guest-cap engine. Its only driver was the
house-team rule from the September 2026 announcement (Team QUEST and Team
Chromnz excluded, "max ONE per team"), which was a one-off. The parts that
generalise already exist: `discordRequired`, `minRosterSize`/`maxRosterSize`,
`maxSubstitutes`, `allowCoach`/`coachRequired`.

Revisit only if per-event restrictions recur. The narrow version is a
per-tournament list of restricted teams plus a numeric cap, counting players
only, advisory rather than auto-rejecting — roughly a day. It needs one
decision first: **does a restricted person coaching another team consume the
cap slot, or does the cap count players only?**

---

## Small, ready to build

### Ranking sync scheduler — **Live**

Shipped 25 August 2026 (`feat: schedule the player ranking sync`).
`modules/players/ranking.jobs.js` enqueues `players.ranking-sync` on the
`BackgroundJob` queue, deciding due-ness from `player_rankings.syncedAt` so a
restart or a second instance does not trigger an extra sync. It is controlled by
`PLAYER_RANKING_SYNC_ENABLED` (off by default) and `PLAYER_RANKING_SYNC_MINUTES`
(default 15, matching the upstream leaderboard refresh) — see
`docs/environment-reference.md`. If profiles still report `rankings: []`, check
that the flag is enabled in that environment.

### Team profiles — **Open**

`GET /api/teams/:slug`, mirroring the player profile. Historical rosters render
from frozen `RegistrationMember` snapshots, never from the current roster.

Blocked on identity: `SavedTeam` is unique **per captain by name**, not
globally, so it has no public identifier. Two captains may both have a "Team
Alpha". Needs a decision on slug generation and collision handling before the
route can exist. The projection itself is the same discipline as the player
profile — see `backend/src/modules/players/codemap.md`.

---

## Discord bot — the large remaining chunk

Everything below needs something that **does not exist today**: an inbound
gateway connection. Current Discord integration is outbound REST only —
`lib/discord/discord-dm.js` opens a DM channel and posts, plus webhook alerts
and OAuth login. There is no long-lived process, no slash commands, no
interaction handling.

That is a new operational surface: reconnect logic, interaction acknowledgement
within 3 seconds, its own deployment, health check, and failure modes, sitting
next to live payments and ticketing. It is the largest single cost in this plan
and should be started deliberately.

`saseq/discord-mcp` on `localhost:8085` is an **operator tool**, not part of the
product. It must never become a production dependency.

### Phase 8 — Bot skeleton

Gateway connection, health endpoint, and API authentication. Ships `/profile`
and `/rank` only, so the whole pipeline is proven on read-only commands.

**The bot must hold no database credentials.** It authenticates to the Express
API exactly as the leaderboard client already does — short-lived HS256 service
tokens with `kid`, `iss`, `aud` and `operation_id`. That pattern exists in
`modules/valorant/valorant.auth.js`; reuse it rather than inventing one.

Least-privilege Discord permissions: Manage Roles, Manage Channels, View
Channels, Send Messages, Embed Links, Read Message History, Use Application
Commands, Manage Webhooks. **Not** Administrator, Ban, Kick, or Manage Server.

Temporary Administrator is needed only to edit roles at or above the bot's own
position, because Discord forbids granting a permission you do not hold. Grant
it, make the change, remove it, and audit all three. It must never be the steady
state. A bot also cannot demote itself — that is always a manual step.

### Phase 9 — Tournament workspace generator

Create a Discord category, channels and event roles from a website tournament.

Idempotency is the design: write a `DiscordWorkspace` row **before** any Discord
call so a duplicate request finds it and no-ops, and persist every created
object's ID. Reconcile compares persisted IDs against live Discord and creates
only what is missing.

**Delete only IDs Quest recorded.** Never match by name — that is how an
automation eats a human-made channel. If a human renames or deletes a managed
channel, reconcile should report it rather than silently recreating it.

Prove it on Quest Ascension.

### Phase 10 — Registration → Discord sync

Approved rosters get event roles (`ASC26 | Captain`). `Tournament.discordRequired`
already exists — reuse it rather than adding a parallel flag.

Discord is downstream and best-effort, mirroring `discord-dm.js`: a failed role
assignment produces a retryable job and a staff-visible warning. **It must never
invalidate a paid entry.**

Event roles are generated and disposable so permissions do not carry between
events. **No team-specific roles** — ten teams per event becomes ten permanent
roles per tournament; use channel overwrites instead.

### Phase 11 — Match events and check-in

A `MatchEvent` stream for referees (`ready`, `team_late`, `technical_pause`,
`warning`, `penalty`, `dispute_opened`, `result_submitted`, …) with a
`visibility` field: pauses and results public, warnings and disputes staff-only
until published.

Referees already exist as `TournamentStaffRole.referee` with `match.operations`
and `veto.operations` scopes, and `Match.assignedStaffId` assigns them.

`/checkin` is identity-critical: verify the snowflake resolves to a Player
through `discord-identity.service.js`. **A slash command must never accept a
claimed identity** — that is straightforward impersonation.

---

## Later

### Phase 12 — Veto link surface

Post the existing veto room's link and, when complete, its result. **Do not
build a second veto engine.** The existing one has eight models covering map
pools, versioned rule presets, digital and manual toss, per-turn deadlines,
`revision`-based optimistic concurrency, a full `VetoRoomAction` log and
`VetoAccessGrant` links. It satisfies every requirement — authorised-captain
actions, referee override, logging, duplicate prevention, state surviving
restart — *and it survives a Discord outage because it does not depend on
Discord*. Quest events are LAN; captains are in the room. This is roughly a day
against re-implementing the hardest concurrent logic in the codebase.

### Phase 13 — Per-map results and public match pages

`Match.scoreData` is opaque JSON. Public match pages need structured per-map
rows, and the completed veto already knows the map list.

### Phase 14 — Automatic archival

On tournament completion, remove event roles and match channels — **managed IDs
only** — and lock the event category read-only. Website history stays permanent.

### Phase 15 — Ranking tier roles

`VAL | Top 10` and similar. Only worth building if recalculation is scheduled
and **idempotent, revoking as reliably as it grants**. A half-built version
leaves people wearing ranks they lost months ago, which is worse than no roles.
Ship `/rank` first and see whether anyone asks. Never per-rank roles.

---

## Deploying any of this

Production CD: there is no GitHub required reviewer (the `production-compose` environment has only a branch policy, verified 2026-10-10), so a release with no pending migration deploys automatically once CI passes. A release with a pending Quest or VALORANT migration is refused by `ops/deploy/release.sh` unless the host's `/etc/quest-esports/release.env` sets `BACKUP_APPROVAL=BACKUP_QUEST_PRODUCTION` and `QUEST_MIGRATION_OWNER_APPROVAL_SHA` (or `VALORANT_MIGRATION_OWNER_APPROVAL_SHA`) to that exact release commit; it then takes and verifies a release-bound backup before migrating.

When migrations are pending, CD runs `ops/backup-production.sh` first. Confirm
the log line

```
Encrypted production backup uploaded successfully: quest-production-<ts>.tar.gz.enc
```

appears **before** the first `Applying migration`. Migrations are forward-only —
recovery is restore-from-backup, not a down-migration.

Verify locally against the throwaway Postgres, never the Supabase URL in
`backend/.env`:

```bash
docker compose -f docker-compose.local.yml up -d postgres
cd backend
node scripts/with-local-db.js npx prisma migrate deploy
node scripts/with-local-db.js npx prisma migrate diff --exit-code \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma
node scripts/with-local-db.js node scripts/verify-database-security.js
node scripts/with-local-db.js npm run test:coverage
npm run lint
```

Two CI steps are easy to miss locally and will fail the pipeline:

- **Every new public table needs RLS** and the Supabase Data API roles revoked.
  `verify-database-security.js` fails otherwise. Copy the block from
  `20260823120000_add_players_and_game_accounts`.
- **`id` and `updated_at` must carry no database default.** Prisma generates
  both client-side, so a DB-side default is drift and `prisma migrate diff`
  fails on it. Supply them explicitly in any INSERT.
