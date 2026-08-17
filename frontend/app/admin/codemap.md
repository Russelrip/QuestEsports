# `frontend/app/admin/`

## Responsibility

Owns the no-index web-admin route tree. Admin layout/guard boundaries protect
the dashboard; pages delegate data and mutations to client components and the
backend admin API.

## Event routes

- `events/page.tsx` renders the event library at `/admin/events`.
- `events/[id]/page.tsx` renders one event workspace at `/admin/events/:id`.
- `event-series/page.tsx` preserves the older `/admin/event-series` tool for
  compatibility with existing series management.

The event workspace follows Save Draft → Add Tournament → Configure → Publish.
Adding a tournament hands off to the normal tournament editor with a prefilled
series ID; attaching an existing tournament uses the event dashboard action.
Event-scoped registration review stays isolated by event ID and child
`seriesId`, while all sensitive roster/payment actions remain in the existing
admin managers.
