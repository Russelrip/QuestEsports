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
