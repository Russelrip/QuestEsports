# `frontend/app/tournaments/`

## Responsibility

Owns the public tournament route family, which since the `/events` merge is
also the only public home for events.

- `page.tsx` is the single public listing. It fetches tournaments, events, and
  game categories together and hands all three to `TournamentsContent`, which
  renders one grid: event cards first, then tournament cards. Any of the three
  fetches failing renders the shared unavailable state.
- `events/[slug]/page.tsx` is the event detail route, moved here from
  `/events/[slug]`. It fetches the public event projection from
  `/api/events/:slug`, builds canonical/SEO metadata, renders a 404 for an API
  404, and composes the public event components.
- `[slug]/` holds the tournament detail, registration, payment, and results
  routes. `events` is a static segment, so it never collides with `[slug]`
  unless a tournament is literally slugged `events`.
- `series/[slug]/page.tsx` is a legacy compatibility route on the older
  event-series API model. Nothing public links to it; it stays alive for old
  links and canonicalises to `/tournaments/events/:slug`.

## Flow

`fetchPublicTournaments`, `fetchPublicEvents`, and `fetchPublicEventBySlug` in
`frontend/lib/tournaments.ts` call the backend; the pages do not access Prisma.
Public reads return published rows only, so a draft event is absent from the
listing and 404s on its detail route.

`frontend/lib/tournament-listing.ts` owns the grid's composition: game-slug
normalisation, event/tournament filtering, and ordering. A tournament whose
published event already carries a card is dropped from the grid, so one game is
never offered twice under two destinations — the child is reached through its
event. A child under a draft parent stays listed, because no event card covers
it. An event answers to any game one of its children plays, so a game filter
never hides the only route to a bracket.

`/events` and `/events/:slug` permanently redirect here from
`frontend/next.config.ts`.
