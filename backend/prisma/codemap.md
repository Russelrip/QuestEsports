# `backend/prisma/`

## Responsibility

Prisma owns the relational application schema and committed migration history.
`schema.prisma` defines `EventSeries`, the nullable tournament series
relation, child registration fields, waitlist metadata, and public references.

## Quest Ascension migrations

- `20260817120000_extend_event_series_quest_ascension` adds nullable event
  presentation fields, `featured`, tournament `waitlistEnabled`, registration
  `waitlisted`/`waitlistPosition`/`publicReference`, and supporting indexes.
- `20260817130000_add_waitlist_position_uniqueness` clears stale positions and
  adds unique per-tournament waitlist-position enforcement.

The rollout is additive and preserves legacy null/default behavior. The
tournament relation is nullable with `SetNull`, while the service archive and
delete guards protect children during normal admin operations.

## Deployment boundary

Use generated Prisma output and `prisma migrate deploy` against an isolated
verification database before a shared deployment. Back up PostgreSQL and both
upload roots first; check migration status, schema/security verification, and
event aggregate/route smoke paths. Never reset or edit an applied migration.
Application rollback restores code only because production migrations are not
reversed. A database rollback requires the approved write-free backup/restore
procedure and post-restore validation.
