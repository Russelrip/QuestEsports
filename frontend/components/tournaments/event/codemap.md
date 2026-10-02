# `frontend/components/tournaments/event/`

## Responsibility

Provides the public event presentation layer without owning data fetching or
registration state.

- `EventCard.tsx` is the grid tile linking to `/tournaments/events/[slug]`,
  shared by the `/tournaments` listing and the home page's `FeaturedEvents`
  section. It renders through the shared `TournamentGridCard` chrome, so an
  event and a tournament are the same tile with no marker separating them;
  only the title and its `/tournaments/events/` destination say which is
  which. It renders for any published event with at least one published
  child. On `/tournaments` an event card
  replaces its children rather than sitting beside them — see
  `frontend/app/tournaments/codemap.md`.
- `EventHero.tsx` displays event identity, public media, status, and timing.
  It is the only place the event's own dates and aggregate counts surface; the
  separate overview section that repeated them was removed, so the event page
  goes straight from the hero to the game lineup.
- `EventSponsorBelt.tsx` is the scrolling sponsor strip under the hero. It
  collects the event's own sponsors first, then each child tournament's,
  collapsed to one logo per brand by case-insensitive name — the same rule the
  backend applies when a child tournament inherits its event's sponsors, so a
  brand set in both places shows once. The loop is two identical copies slid by
  one copy's width, which only reads as seamless while a copy is at least as
  wide as the belt; `.sponsor-belt-track` in `app/globals.css` guarantees that
  by flooring the track at twice the belt's width and letting the logos stretch
  into whatever is left. It is deliberately not a count of logos: padding a
  short lineup out with repeats showed the same brand twice at once on a wide
  screen.
- `EventTournamentList.tsx` lists published child tournaments as the same
  `TournamentCard` grid used by `/tournaments`, behind per-game filter chips.
  Each card links to the tournament detail route; registration is reached from
  there rather than from a per-row CTA.

All components consume the typed `EventSeries` model from
`frontend/lib/tournaments.ts`. They do not render captain/contact information,
payment evidence, admin notes, or unpublished children. Child registration
availability comes from the backend's per-tournament public projection.
