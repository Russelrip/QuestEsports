# `backend/prisma/`

## Responsibility

Prisma owns the relational application schema and committed migration history.
`schema.prisma` defines `EventSeries`, the nullable tournament series
relation, child registration fields, waitlist metadata, and public references.

The additive support-conversation schema defines authenticated user-owned
support threads, staff assignment/status state, persisted messages, and
per-user read cursors. The migration is committed but must be applied with
`prisma migrate deploy` before support endpoints are enabled; it does not alter
existing contact, match-room, notification, or OAuth tables.

## Quest Ascension migrations

- `20260831120000_add_caster_veto_access_role` adds the additive `caster`
  value to `VetoAccessRole`; `prisma migrate deploy` must apply this migration
  before application code writes caster grants.
- `20260817120000_extend_event_series_quest_ascension` adds nullable event
  presentation fields, `featured`, tournament `waitlistEnabled`, registration
  `waitlisted`/`waitlistPosition`/`publicReference`, and supporting indexes.
- `20260817130000_add_waitlist_position_uniqueness` clears stale positions and
  adds unique per-tournament waitlist-position enforcement.
- `20260819130000_add_tournament_bracket_visibility` adds the additive,
  non-null `show_bracket_publicly` tournament setting with default `TRUE`.
- `20260819120000_add_support_conversations` adds support conversation,
  message, and per-user read-cursor tables plus their status enum and indexes.
- `20260819170000_add_oauth_link_safety` adds the explicit password-set marker
  and durable, one-time OAuth link nonce records. Existing users without OAuth
  accounts are conservatively marked from `created_at`; OAuth-linked users stay
  unmarked until they set a password.
- `20260819190000_add_saved_team_member_phone` adds nullable phone data for
  saved-team members. Saved teams may persist `COACH` members alongside player,
  substitute, and captain roles; coach phone data remains nullable for legacy
  and partially populated saved rosters.
- `20260823120000_add_players_and_game_accounts` adds the Quest-owned durable
  player identity (`players`, with a sequence-backed `QPID-000001` public
  reference and a nullable, unique `user_id` so a player may be unclaimed) and
  the per-title `game_accounts` table keyed on the upstream's stable identifier
  (PUUID for VALORANT). Display name, tag, and region are a cached snapshot and
  are never an identity key. Integrity lives in the database: unique
  `(game, external_id)`, a partial unique index allowing one `active` account
  per player per game, and a CHECK forcing `external_id` to be stored
  normalized. Verification strength and lifecycle are separate columns, and the
  verification enum deliberately has no ownership state — the VALORANT upstream
  resolves accounts through HenrikDev, which proves an account exists but never
  proves the signed-in user holds it. Wholly additive: the legacy free-text
  `saved_team_members.riot_id`, `registration_members.riot_id`, and
  `team_registrations.captain_riot_id` columns are untouched, and nothing is
  backfilled.
- `20260823130000_add_player_links_to_rosters` adds the nullable
  `saved_team_members.player_id` and `registration_members.player_id` links.
  Nullable and unbackfilled by design: roster history is sensitive, so every
  existing `riot_id`, `email`, `discord`, and invite column keeps its value and
  stays authoritative for rows that predate player identity. Both foreign keys
  are `SET NULL` — deleting a player must never delete roster or registration
  history; the worst case is a row falling back to its legacy free-text
  identity, which is the pre-migration state. `TeamRegistration` ownership is
  deliberately unchanged: a registration's captain is represented through its
  captain `registration_members` row, so the link lands there rather than on
  the aggregate.
- `20260823140000_add_roster_identity_snapshots` adds the competitive identity
  snapshot to `registration_members`: `game_account_id`,
  `external_id_snapshot`, `username_snapshot`, `tag_snapshot`,
  `verification_status_snapshot`, and `snapshot_at`. The table already copied a
  roster, but it copied free text that was typed by a human and checked against
  nothing; these columns record which game account was actually committed and
  what it looked like at that moment. Written only when a registration is
  approved, never by a profile or roster edit. The foreign key is `SET NULL` —
  deleting a game account must not delete the evidence of what a team
  registered with, and the text snapshot survives the reference on purpose.
  Additive and unbackfilled: a NULL snapshot honestly means "predates identity
  snapshots", which is different from "no account".
- `20260823150000_add_game_account_change_requests` adds the admin-reviewed
  account-replacement workflow. It exists for one case only: the underlying
  account is genuinely different. A Riot rename is not that case — the stable
  identifier is unchanged, so display fields refresh with no request and no
  approval. Conflating the two would either bury admins in rename paperwork or
  let a real account swap pass as a rename. Integrity is in the database: a
  partial unique index allows one pending request per player per game, and
  CHECK constraints require a non-empty reason and a normalized requested
  identifier. Every foreign key except the owning player is `SET NULL` — a
  decision record must outlive the rows it references or the audit trail rots.
- `20260823160000_add_tournament_discord_requirement` adds
  `tournaments.discord_required`, defaulting to FALSE so every existing
  tournament behaves exactly as it does today. Roster readiness reports each
  member's Discord status regardless of the flag — a captain should always be
  able to see who is reachable — and the flag only decides whether a missing
  connection BLOCKS registration. Unlike a game account this covers every roster
  member including a coach, because the point is being contactable during the
  event. Discord identity is read from `OAuthAccount`, never from the mutable
  `User.discordTag`.
- `20260907120000_add_unlimited_capacity_and_auto_approval` makes
  `tournaments.max_teams` nullable and adds
  `tournaments.auto_approve_registrations`, defaulting to FALSE. NULL capacity
  means "no slot ceiling", which is a different fact from 0 — a tournament
  configured with no slots — so only NULL uncaps a tournament and no existing
  row is rewritten. Dropping NOT NULL is safe in the way that matters: every
  capacity check now reads NULL as "has room" instead of erroring, and slot
  numbering continues past any fixed ceiling so bank-transfer references stay
  stable. Slot-numbered fee tiers remain incompatible with an uncapped
  tournament by validation rather than by constraint, because a tier list must
  cover every slot and an unbounded range cannot be covered. Automatic approval
  defaults off so every existing tournament keeps its manual review step;
  turning it on approves a registration the moment nothing is outstanding,
  which is the click an admin was performing by hand for a free, open-entry
  event.

- `20260822150000_add_saved_team_logo_cleared_at` adds the nullable
  `saved_teams.logo_cleared_at` marker. `logo_name` alone cannot say why a team
  has no logo, so this column separates a team that has never had one — which
  may adopt a logo supplied by a registration — from a deliberate removal, which
  stays authoritative so a stale registration snapshot cannot resurrect it. The
  column is additive and intentionally not backfilled: existing logo-less teams
  read as never having had a logo.

- `20260824210000_add_canonical_game` introduces `games` and `game_aliases`, and
  adds a nullable `game_id` to `tournaments`, `rulebooks`,
  `recruitment_applications`, `saved_teams`, `veto_maps`, `veto_map_pools`,
  `veto_rule_presets` and `game_categories`. Before it, "which game" was stated
  seven ways with nothing tying them together, so a tournament could reference a
  rulebook for a different title and no constraint objected. `game_categories`
  already held the established public slugs (`codm`, `mlbb`, `pubg-mobile`,
  `valorant`), so those are adopted as canonical rather than invented afresh, and
  `games.slug` deliberately carries the same values as the `GameAccountGame` enum
  so the enum and the table agree by construction.

  `game_aliases` exists because normalising text is not sufficient: "COD Mobile"
  slugifies to `cod-mobile`, which is not `codm`, so normalisation alone would
  create a second title for one that already exists. Known spellings are seeded;
  an unrecognised title still resolves by becoming its own row, and can be merged
  later by adding an alias. The SQL normaliser and
  `modules/games/game.service.js#normalizeGameKey` must stay in step — a test
  asserts this, because divergence would strand rows the migration mapped.

  This is the EXPAND half of expand-migrate-contract. Every new column is
  nullable, no legacy column is dropped or made NOT NULL, and no read path
  depends on the new columns yet. Dropping `tournaments.game`,
  `rulebooks.game`, `saved_teams.game`, `recruitment_applications.game` and the
  three veto catalog `game` columns is the CONTRACT step and belongs in a later
  release once reads have moved.

- `20260824234500_add_discord_identity` adds `discord_identities`, attaching a
  player's Discord account to `players` rather than leaving it inside
  `oauth_accounts`. `oauth_accounts` is an AUTHENTICATION record: it exists so
  somebody can sign in, and it cascades away with the user row. Tournament
  operations need the link to outlive that, and need it to exist for a player
  with no Quest account at all — a LAN entrant a captain registered on their
  behalf is still someone a referee has to reach, which is why `source`
  distinguishes an `oauth` link Discord confirmed from an `admin` assertion.
  `discord_user_id` is the snowflake and the only identity key; `username` and
  `global_name` are a cached display snapshot, and a CHECK constraint requires
  digits so a username cannot be stored in the identity column at all. Unique on
  both `player_id` and `discord_user_id`: one Discord account belongs to one
  player, or a tournament role could be granted to the wrong person. Unlike the
  roster snapshots this one IS backfilled — a completed OAuth flow already
  established the fact, so copying it asserts nothing new — and reads fall back
  to `oauth_accounts` during the expand phase so a link made before cutover is
  never reported as missing. Row level security is enabled and the Supabase Data
  API roles are revoked, matching `players` and `game_accounts`.

- `20260824230000_add_audit_source_and_reason` adds the nullable
  `audit_logs.source` (`AuditSource`: web, admin, mobile, bot, system) and
  `audit_logs.reason`. Actor, action, target and before/after are enough while
  every write comes from a person in a browser; they stop being enough once
  automation writes, because a role granted by a bot acting for an admin and the
  same role granted by that admin in the dashboard are indistinguishable by
  actor alone. Both columns are nullable with no default and are deliberately
  not backfilled: NULL means "predates provenance tracking", which is a
  different fact from "came from the web". `source` is derived only from what a
  request proves — a service token means `bot`, the `/api/admin` prefix means
  `admin` — and `mobile` is never inferred, because the Android client calls the
  same routes as the web dashboard and announces nothing that separates them.

- `20260825010000_add_rulebook_versioning` adds `rulebooks.layer` /
  `rulebooks.parent_id`, the `rulebook_versions` table, and
  `tournaments.rulebook_version_id`. `rulebooks` held one flat `content` string
  with no version and no effective date, so a tournament resolved to whatever
  the rulebook says TODAY — editing a rule mid-season silently rewrote what a
  completed event ran under. A published version is immutable; editing rules
  means publishing a new version, never rewriting a row. `layer` defaults to
  `game` because the table is keyed and indexed on `(game, variant)`, so its own
  shape says "rules for a title, in a variant"; reclassifying to `policy` or
  `tournament` is an editorial decision for staff, not one a migration should
  guess. Backfilled — unlike the roster snapshots — because the text already
  exists and already governs, so recording it as v1 states a fact rather than
  inventing one; `effective_from` uses the rulebook's own `created_at` rather
  than `now()`, which would claim every existing rulebook took effect at
  migration time. Existing tournaments are pinned to their rulebook's v1 so they
  resolve to the same text after cutover as before. `rulebooks.content` is
  retained and still authoritative; moving reads onto versions and dropping it
  is the contract step.

- `20260825030000_add_player_rankings` adds `player_rankings`, a cached
  projection of a player's standing in the external leaderboard. It is a CACHE,
  never a source of truth: the VALORANT ranking lives in
  `valorant-platform-backend`, which owns its own rating engine and ingests from
  HenrikDev, and Quest reads it over a signed service token. Caching it means a
  profile still renders when that service is slow, rate limited, or down —
  losing the table costs a refresh, not data. Keyed on `player_id` rather than
  the PUUID even though the PUUID is what the join is made on: `game_accounts`
  already owns that mapping, duplicating it would create a second place for it
  to be wrong, and keying on the player keeps the PUUID out of every profile
  query, which is the boundary the public projection depends on. `position` is
  CHECK-constrained to >= 1 so "Rank #0" is impossible, and is stored NULL when
  the board was only partially read — a rank from a truncated board would be
  quietly wrong, which is worse than showing nothing.

- `20260825120000_add_structured_valorant_match_tables` adds `match_maps` and
  `match_player_stats`, the structured form of what
  `quest_valorant_matches.roster_summary` holds as opaque JSON. The blob is fine
  for an admin panel rendering one match at a time and wrong for a public page
  that must sort by ADR, filter by agent, or aggregate a tournament — none of
  which is expressible against JSON without scanning every row. The two tables
  also give `duration_ms`, `map_id` and `game_version` a home; the mapper
  carries all three and `quest_valorant_matches` has no column for any of them,
  so until now they were read and discarded.

  Nothing is derived and nothing is stored that can be computed. ACS, ADR and
  HS% are ratios over `red_score + blue_score`, so a `rounds_played` column is
  deliberately absent — storing a derived value would freeze a formula the
  upstream owns. Every per-player counter is nullable because NULL means "not
  reported", which is a different fact from zero: a player with 0 kills and a
  player whose stats never arrived must not render the same.

  The three foreign keys out of `match_maps` are deliberately of different
  strengths. `quest_valorant_match_id` CASCADEs because the row is a projection
  of that import and means nothing without it. `series_game_id` is `SET NULL` —
  detaching a map from a series is admin bookkeeping and must not destroy a
  scoreboard the public page is rendering. `match_id` is the bracket link and
  stays NULL: nothing joins a discovered VAL series to a bracket `matches` row
  yet, so this is the column a later release fills rather than a schema change
  it has to make. `match_player_stats.player_id` is `SET NULL` for the same
  reason as the roster links — most people on a VALORANT scoreboard are not
  Quest players, and deleting a player must not delete the record of a match
  they played; the row falls back to its display-name snapshot.

  `puuid` carries the same normalization CHECK as `game_accounts.external_id`,
  because that column is what it joins against. If the two could disagree on
  case or padding the join would not error, it would silently miss and render a
  real Quest player as an unlinked stranger. Both tables have RLS enabled and
  the Supabase Data API roles revoked; `match_player_stats` holds PUUIDs, so an
  exposed Data API role there would leak the identity key the public projection
  exists to keep private.

  EXPAND half of expand-migrate-contract, and unbackfilled. `roster_summary` is
  retained and stays authoritative until the public read path moves onto these
  tables; existing imports carry no structured scoreboard until they are
  re-imported, which reads honestly as "imported before structured stats" rather
  than as a match played with no stats. Dropping `roster_summary` is the
  CONTRACT step and belongs in a later release.

The rollout is additive and preserves legacy null/default behavior. The
tournament relation is nullable with `SetNull`, while the service archive and
delete guards protect children during normal admin operations. OAuth link
nonces are claimed atomically and password markers distinguish a real password
login method from OAuth-only random password hashes.

## Deployment boundary

Use generated Prisma output and `prisma migrate deploy` against an isolated
verification database before a shared deployment. Back up PostgreSQL and both
upload roots first; check migration status, schema/security verification, and
event aggregate/route smoke paths. Never reset or edit an applied migration.
Application rollback restores code only because production migrations are not
reversed. A database rollback requires the approved write-free backup/restore
procedure and post-restore validation.
