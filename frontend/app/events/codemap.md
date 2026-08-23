# `frontend/app/events/`

## Responsibility

Owns the public event route family. `page.tsx` lists every published event
that has at least one published child tournament, and is the destination of the
header's Events nav item. `[slug]/page.tsx` fetches the public event projection
from `/api/events/:slug`, builds canonical/SEO metadata, renders a 404 for an
API 404, and composes the public event components.

## Flow

`fetchPublicEvents` and `fetchPublicEventBySlug` in
`frontend/lib/tournaments.ts` call the backend; the pages do not access Prisma.
Both public reads return published rows only, so a draft event is absent from
the index and 404s on its detail route. The returned EventSeries projection
contains the event identity, aggregate counts, safe ticket projection, and
published child tournaments. Each child links to its normal tournament
detail or registration page, preserving per-game capacity and payment rules.

Related compatibility pages under `frontend/app/tournaments/series/[slug]`
use the legacy event-series API model; both models are served by the same
EventSeries backend data.
