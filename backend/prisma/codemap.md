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
- `20260822150000_add_saved_team_logo_cleared_at` adds the nullable
  `saved_teams.logo_cleared_at` marker. `logo_name` alone cannot say why a team
  has no logo, so this column separates a team that has never had one — which
  may adopt a logo supplied by a registration — from a deliberate removal, which
  stays authoritative so a stale registration snapshot cannot resurrect it. The
  column is additive and intentionally not backfilled: existing logo-less teams
  read as never having had a logo.

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
