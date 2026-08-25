# backend/src/modules/valorant/

## Responsibility

Quest's side of the VALORANT integration. The match data itself lives in
`valorant-platform-backend`, a separate service that owns its own rating engine
and ingests from HenrikDev; Quest calls it over a signed service token and
caches what it needs.

- `valorant.client.js` — HTTP client to the upstream service.
- `valorant.auth.js` — signed service tokens (HS256, `kid`/`iss`/`aud`/
  `operation_id`).
- `valorant.mapper.js` — snake_case upstream → camelCase Quest projections.
- `valorant.service.js` — bindings, discovery, import, series, finalize,
  reconcile, and the operation ledger.
- `valorant.controller.js` — the admin surface under `/api/v1/admin/valorant/*`.
- `valorant-public.service.js` / `valorant-public.controller.js` — the public
  read path.
- `valorant-anchors.service.js` / `valorant-anchors.controller.js` — discovery
  anchors derived from approved rosters, and the bracket fixtures they pair.

## Two surfaces, one module

Everything except the two `valorant-public.*` files is **admin-only** and sits
behind `requireAdmin`. The public files are unauthenticated and must be read as
a different thing entirely: they never call the upstream, never write, and never
touch the operation ledger. They read only what a completed import already left
in Quest's own tables.

Keep that split. An admin route may return anything a staff member is allowed to
see; a public route may return only what the projection below permits.

## The projection boundary

`valorant-public.service.js` is a **projection, never a model dump**, the same
boundary [`modules/players/codemap.md`](../players/codemap.md) draws. The
adjacent data is sensitive: `match_player_stats.puuid` is a stable
cross-service key the audit policy already treats as sensitive, bindings record
the staff user who created them, and `quest_valorant_operations` holds upstream
request ids.

The rule: a field is included only if it is **already public elsewhere** — a
scoreboard line appears on any match page, a team name appears on a bracket.
Everything else is omitted *by construction*. The `select` passed to Prisma
never asks for `puuid`, and `tests/valorant-public.service.test.js` asserts on
the `select` itself, because a projection that fetches a secret and strips it
later is one careless refactor from leaking it.

A scoreboard row links to a Quest profile as `publicId`, never as the PUUID that
resolved it. Most rows carry no link at all — most of a VALORANT lobby has never
touched Quest — and that is the ordinary case, not a failure.

## What "match" means here

**The series.** As on VLR, a match is a bo1/bo3/bo5 with one scoreboard per map,
so `/api/v1/valorant/series/:seriesId` is the match page and the route id is a
`QuestValorantSeries` id.

It is **not** a Quest bracket `Match`. `match_maps.match_id` exists for that link
and is still NULL for every row — nothing joins a discovered VAL series to a
bracket fixture yet. Nothing in the public read path reads that column; when it
is populated, a bracket page can join to these rows without a schema change.

## Rules encoded here

- **Only `finalized` series are public.** A `draft` is bookkeeping mid-import,
  and `orphaned` / `reconciliation_required` are known-inconsistent records.
  Publishing either puts a number in front of the world that staff have not
  stood behind.
- **Unpublished tournaments never appear**, matching the player profile. A
  series whose tournament is unpublished is invisible even by direct id.
- **404, never 403,** for a series that exists but is not public. A 403 would
  confirm the existence of unpublished events to anyone willing to guess ids.
- **The winner is read from the maps, never from a column.** Quest's
  `quest_valorant_series` records who played and when; the upstream owns the
  rating engine and Quest never copied a winner field. Counting maps won is the
  only version a reader can check against the scoreboard in front of them, and a
  tie or an unimported map yields no winner rather than a guess.
- **Sides are per map, not per series.** Teams swap halves between maps, so
  which of red/blue is team A is read from `QuestValorantSeriesGame`, per game.

## Roster-derived discovery

`valorant-anchors.service.js` removes the reason ingestion was manual.
`discover` needs two anchor Riot IDs, one player per side, and an admin used to
type them from memory. `RegistrationMember` already records the game account a
team committed to a tournament, so the anchors are derivable and discovery can
be driven from the bracket.

Anchor sources are ordered by how much each one proves:

1. **`snapshot`** — `usernameSnapshot`/`tagSnapshot`, what the team actually
   committed to THIS tournament. A later rename cannot rewrite it, so it wins.
2. **`game_account`** — the live active VALORANT account. A good guess, but it
   describes today rather than the day of the match.
3. **`legacy_text`** — the free-text `riot_id` a human typed, accepted only when
   it already parses as `Name#Tag`. Anything else is a note to a human.

Every usable anchor is returned, not just the best one: an anchor only works if
that person actually played the map being searched for, so a substitute who sat
out is a dead end the caller has to be able to retry past.

Pairs come from the **bracket**, never from every combination of teams. A
16-team event has 120 possible pairings and roughly 15 real ones; searching the
rest would spend upstream rate limit proving that teams who never met never
played. It also means a proposed fixture already knows its bracket `Match`,
which is the value `match_maps.match_id` has been waiting for.

Two rules this surface must keep:

- **It proposes, never commits.** Nothing here imports, attaches or finalizes.
  A wrongly attached map changes a rating and a public result, so a human
  confirms. `discoverFixture` runs one fixture per call for the same reason —
  one endpoint that swept a bracket would turn a careless click into dozens of
  upstream searches.
- **A blocked fixture says why.** `fixture_has_no_opponent_pair`,
  `participant_not_linked_to_registration`, `team_has_no_derivable_anchor`, and
  the tournament-level `unanchored` list. Silently omitting them would let an
  admin assume the whole bracket is covered when half of it is invisible.

Searches default to the tournament's `startDate`, because the same two teams may
well have scrimmed a month earlier and those matches are the false positives.

## Caching

Both public routes are served through `cacheJson` on the `foundation` tag, so a
payload can outlive the row it was built from for the cache TTL. Visibility is
therefore enforced in **two** places, and both matter:

- the projection returns `null` for a draft series or an unpublished tournament,
  which is what `tests/valorant-public.service.test.js` covers; and
- the admin writes that can change a published result — import, attach/remove a
  game, edit or delete a series, finalize — drop the `foundation` tag, as the
  tournament admin routes already did for publish/unpublish.

Without the second, unpublishing a tournament would leave the results page
serving from cache for up to the TTL. A live check against a seeded database
found exactly that, and it is not visible to a test that mocks Prisma or calls
the service directly.

## Derived stats

ACS, ADR and HS% are computed **on read**, in `valorant-public.service.js`, from
the counters `match_player_stats` stores and the round total
(`red_score + blue_score`). They are deliberately not columns: storing them
would freeze a formula the upstream owns, and they are cheap to divide.

A counter the upstream never reported is `null`, and every derived value from it
is `null` too — never `0`. A player with no kills and a player with no data must
not render the same, and the frontend renders the difference as an em dash.

## Not yet here

Round timeline, economy, first bloods, multi-kills and KAST. They live in the
upstream's `matches.raw_payload`, which is retained in full but not exposed to
Quest — enabling it, or adding a derived-stats endpoint upstream, is an open
decision recorded in
[`docs/valorant-match-data-plan.md`](../../../../docs/valorant-match-data-plan.md).
A half-built timeline would be worse than none, so the match page shows none.
