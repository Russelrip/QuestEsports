# `frontend/components/tournaments/event/`

## Responsibility

Provides the public event presentation layer without owning data fetching or
registration state.

- `EventCard.tsx` is the grid tile linking to `/events/[slug]`, shared by the
  `/events` index and the home page's `FeaturedEvents` section. It renders for
  any published event with at least one published child. `/tournaments` carries
  no event cards and lists every published tournament, children included; the
  home page drops a child only because its own event row already shows it.
- `EventHero.tsx` displays event identity, public media, status, and timing.
- `EventOverview.tsx` displays dates, venue, and the aggregate games/teams/
  players/available-capacity projection.
- `EventTournamentList.tsx` lists published child tournaments and links each
  game to its own public detail or registration route.

All components consume the typed `EventSeries` model from
`frontend/lib/tournaments.ts`. They do not render captain/contact information,
payment evidence, admin notes, or unpublished children. Child registration
availability comes from the backend's per-tournament public projection.
