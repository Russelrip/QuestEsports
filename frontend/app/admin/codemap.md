# `frontend/app/admin/`

## Responsibility

Owns the no-index web-admin route tree. Admin layout/guard boundaries protect
the dashboard; pages delegate data and mutations to client components and the
backend admin API.

All pages render inside the shared responsive `AdminShell`; public site chrome
is intentionally not shown on this route tree.

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

Saved-team-backed registration flows carry a persisted `COACH` member into the
coach draft separately from the player roster. The registration boundary
surfaces the backend conflict response when one person is submitted as both a
coach and player in the same tournament; the role check is enforced
transactionally by the backend rather than by route UI alone.

## Support route

- `support/page.tsx` renders the authenticated staff support queue at
  `/admin/support`; filtering and thread mutations are delegated to the admin
  support manager and versioned support API.
