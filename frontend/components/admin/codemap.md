# `frontend/components/admin/`

## Responsibility

Contains authenticated web-admin UI and shared admin controls. Event-specific
flow is split between the event dashboard and the existing tournament/
registration managers.

`AdminShell` is the authenticated visual boundary for admin routes: it provides
the grouped responsive sidebar/top-bar navigation, active route state, and
account/sign-out controls. The root layout suppresses public header/footer
chrome whenever this boundary is present.

## Event integration

- `AdminEventsManager.tsx` lists admin event projections and links to the
  dashboard/public page.
- `AdminEventDashboard.tsx` implements Settings, Overview, Tournaments, and
  Registrations tabs; it saves event media/identity, archives, creates or
  attaches child tournaments, and displays aggregate counts.
- `AdminRegistrationsManager.tsx` accepts an optional event ID and uses the
  event-scoped API with search, tournament, game, and status filters while
  reusing full registration detail/correction controls.
- `TournamentEditor.tsx` remains the source of truth for child game,
  capacity, waitlist, roster, payment, schedule, and publication settings.

Admin requests use the authenticated browser session and never expose the
private registration fields to public components. Event summary responses omit
payment evidence, admin holds/notes, and private upload names; full sensitive
records are loaded only in the existing admin detail workflow.

## Support queue

- `AdminSupportManager.tsx` owns queue loading, responsive selection, filters,
  retry/empty states, and refresh-after-mutation behavior.
- `support/AdminSupportThread.tsx` renders the staff conversation, reply,
  resolve/reopen, and assignment controls; `SupportQueueFilters.tsx` keeps the
  queue contract explicit and `SupportAssignmentControl.tsx` supports
  self-assigning or unassigning a conversation.
