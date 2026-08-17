# `backend/src/modules/series/`

## Responsibility

Owns the EventSeries-as-Event API. `series.service.js` maps one event identity
and its ordered child tournaments, while preserving compatibility with the
older `/event-series` contract. Public reads include published rows only;
admin reads include drafts.

## Routes and flow

- `GET /events` and `GET /events/:slug` call the public event aliases.
- `GET /admin/events` lists event identities and child summaries.
- `GET /admin/events/:eventId/registrations` delegates event-scoped filtering
  to the admin registration service and enforces the event through child
  `seriesId`.
- `POST`/`PATCH /admin/events` save the event identity and optional hero/banner
  media.
- `POST /admin/events/:eventId/archive` unpublishes without deleting children.
- `POST /admin/events/:eventId/tournaments` creates a child with the event
  forced as `seriesId`, or attaches an existing tournament.

`series.controller.js` owns envelopes and `series.routes.js` owns auth, cache,
uploads, and invalidation. `series.service.js` owns parsing, mapping, media
cleanup, archive/delete guards, and child creation/linking.

## Aggregation

`event-aggregation.js` counts visible child games, active team registrations,
active captain/player/substitute members, and remaining child capacity. Active
capacity is paid or unexpired pending registrations plus admin holds, less an
active registration covered by its hold. Rejected and waitlisted rows do not
count. `registrationState` is derived from child timing/capacity; an open child
waitlist keeps the event aggregate open even when that child has no slots, and
the state can be replaced for display by `registrationStatusOverride`. Event
lists use the batched aggregate export when available and fall back to parallel single-event
aggregation for legacy consumers/mocks. Parent registration windows constrain
mapped child CTA/state without changing child storage.

## Integration boundaries

- [`../tournaments/codemap.md`](../tournaments/codemap.md) supplies public
  child mapping, nullable series linking, capacity, and waitlist behavior.
- The ticket service supplies the safe ticket projection for an event detail.
- Admin registration summaries are deliberately separate from public event
  projections and exclude payment evidence, holds, and admin notes.
