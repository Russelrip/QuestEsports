# `frontend/components/tournaments/event/`

## Responsibility

Provides the public event presentation layer without owning data fetching or
registration state.

- `EventCard.tsx` is the grid tile linking to `/tournaments/events/[slug]`,
  shared by the `/tournaments` listing and the home page's `FeaturedEvents`
  section. It renders through the shared `TournamentGridCard` chrome, so an
  event and a tournament read as the same kind of tile; an `Event · N games`
  badge is the only thing that separates them. It renders for any published
  event with at least one published child. On `/tournaments` an event card
  replaces its children rather than sitting beside them — see
  `frontend/app/tournaments/codemap.md`.
- `EventHero.tsx` displays event identity, public media, status, and timing.
- `EventOverview.tsx` displays dates, venue, and the aggregate games/teams/
  players/available-capacity projection.
- `EventTournamentList.tsx` lists published child tournaments as the same
  `TournamentCard` grid used by `/tournaments`, behind per-game filter chips.
  Each card links to the tournament detail route; registration is reached from
  there rather than from a per-row CTA.

All components consume the typed `EventSeries` model from
`frontend/lib/tournaments.ts`. They do not render captain/contact information,
payment evidence, admin notes, or unpublished children. Child registration
availability comes from the backend's per-tournament public projection.
