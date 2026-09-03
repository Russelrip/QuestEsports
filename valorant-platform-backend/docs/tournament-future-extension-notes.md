# Phase 3 / tournament future-extension notes (design §17–§18)

This file records what **was deliberately not built** in Phase 1/2 and the
**extension points** the design leaves open, so a future Phase 3 knows exactly
where to attach. It is derived from the approved design doc §17 (explicit
non-goals) and §18 (future extension points) and from the implementation plan
Appendix F.

> **Never assume a Revival generator exists.** Revival Impact Rating and
> player leaderboards are documented here as *later, from retained raw
> payloads* — they are deliberately **not** implemented now and no Revival
> static-JSON import exists or is assumed (the 13 `revival-stats` JSON files are
> not canonical data).

## Hard non-goals for Phase 1/2 (from design §17 / plan App. F)

The following were excluded by design; do not implement them silently as part
of Phase 3 without revisiting the design:

- Frontend / Streamlit / any UI.
- Tournament registration, brackets, groups, Swiss stages, map veto.
- Team roster registration; captain/player accounts; ownership verification.
- Riot official API, Riot RSO/OAuth, and any provider abstraction for a
  hypothetical Riot migration.
- Automatic one-player roster discovery.
- **Revival static JSON import** (the 13 JSON files are not canonical; no
  Revival generator is assumed).
- Player career statistics, VLR/Discord integration, real-time live match
  tracking.
- Complete kill/round/economy normalization (raw payloads retained only).
- Public authentication; image/logo storage beyond a URL field.
- `player_aliases` (deferred — see ADR-009).

## Extension points the schema already prepares

### 1. Rosters — `team_memberships`

Design §18: `team_memberships(team_id, player_id, valid_from, valid_to, role)`
later enables **auto-association of matches to teams from PUUID lineups**.

- Today: teams and matches are connected only through `series_games`
  (deliberate manual attachment of imported matches).
- The raw material is already retained: `match_players.puuid_snapshot` /
  `player_id` on every imported match, and `teams` as durable entities.
- Phase 3 shape: a membership table keyed by `(team_id, player_id)` with
  validity windows; discovery can then match lineups to rosters instead of
  requiring explicit two-player search.

### 2. Tournaments — `tournaments / stages / fixtures`

Design §18: a fixture can point to an existing `series` row.

- `series` already carries `importance` (`regular | playoff | finals`) and the
  finalized-audit machinery, so a fixture pointing at a `series` needs no
  changes to the rating path.
- Proposed shape: `tournaments(id, name, ...)`, `stages(id, tournament_id,
  name, order, ...)`, `fixtures(id, stage_id, series_id, ...)` with
  `series_id` nullable (a fixture may predate its series). Keep the
  draft/finalized status policy and the `played_at`-chronological rebuild
  ordering untouched.

### 3. Automatic discovery — one-anchor roster lookup

Design §18: expected-roster PUUIDs → one anchor history → validate all ten
expected players. Explicitly "no Match/Series schema redesign" — discovery
improves, the canonical identities do not move.

- The current two-player workflow (`POST /api/v1/match-search/two-player`) is
  retained and costs one extra history fetch; roster-aware discovery replaces
  that once memberships exist.
- Caching etiquette applies (see `docs/henrik-integration-notes.md`): history
  pages small (`size=10` default), identities cached in `players`, post-import
  reads from Supabase.

### 4. Statistics — from retained raw payloads

Design §18: parse `matches.raw_payload` / `match_players.raw_player_payload`
into `match_rounds`, `kill_events`, economy, plants/defuses, derived stats —
"no historical Henrik refetch for retained fields".

- Every imported match stores the **upstream v4 match-detail `data` object
  verbatim** in `matches.raw_payload` (ADR-002; the transport envelope's
  `status`/top-level fields are not stored), so all statistics work is a local
  parse.
- **Revival Impact Rating and player leaderboards can be reimplemented later
  from these payloads; not now.** Until then the only source of truth for
  ratings is the legacy ELO calculator preserved in `app/legacy/`.
- This is why raw payloads are excluded from default read responses
  (`RAW_PAYLOAD_IN_RESPONSES=false`): storage is for rebuildability, not
  casual exposure.

## What a Phase 3 must NOT break

- `rating_events` / `rating_event_sequences` are immutable (migrations
  0010/0013); tournament fixtures must reference series, never mutate events.
- The advisory-lock finalization protocol
  (`RATING_WORK_LOCK_KEY`) and the deferred exact-pair guard (0011/0012) are
  the durable invariants — new rating sources must route through
  `apply_rating_policy`, not new ad-hoc event writes.
- The `draft | finalized` status lock (ADR-006/ADR-021) and the rebuild
  ordering by `played_at` are load-bearing; new tournament states should be
  separate tables, not new `series.status` values.
- No provider abstraction for a hypothetical Riot migration (ADR-008) — add a
  real adapter only when the requirement is concrete.

## Open TODOs for future phases

1. `team_memberships` table + roster-aware discovery (auto-associate matches to
   teams from PUUID lineups).
2. `tournaments` / `stages` / `fixtures` tables; fixtures reference `series`.
3. Statistics parser over retained raw payloads (`match_rounds`, kill events,
   economy, plants/defuses).
4. Revival Impact Rating / player leaderboards — **later, from retained raw
   payloads; never assumed to exist upstream**.
5. `player_aliases` (deferred per ADR-009) if a real name-resolution need
   appears.
6. Public authentication to replace the admin token (ADR-010) when end-user
   accounts arrive.
