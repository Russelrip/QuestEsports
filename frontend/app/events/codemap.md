# `frontend/app/events/`

## Responsibility

Owns the public event route family. `[slug]/page.tsx` fetches the public event
projection from `/api/events/:slug`, builds canonical/SEO metadata, renders a
404 for an API 404, and composes the public event components.

## Flow

`fetchPublicEventBySlug` in `frontend/lib/tournaments.ts` calls the backend;
the page does not access Prisma. The returned EventSeries projection contains
the event identity, aggregate counts, safe ticket projection, and published
child tournaments. Each child links to its normal tournament detail or
registration page, preserving per-game capacity and payment rules.

Related compatibility pages under `frontend/app/tournaments/series/[slug]`
use the legacy event-series API model; both models are served by the same
EventSeries backend data.
