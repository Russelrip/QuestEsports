# `frontend/components/admin/`

## Responsibility

Contains authenticated web-admin UI and shared admin controls. Event-specific
flow is split between the event dashboard and the existing tournament/
registration managers.

`AdminShell` is the authenticated visual boundary for admin routes: it provides
the grouped responsive sidebar/top-bar navigation, active route state, and
account/sign-out controls. The root layout suppresses public header/footer
chrome whenever this boundary is present. Navigation glyphs come from the
shared `lib/icons.ts` path table rendered through `components/ui/icon.tsx`,
which the public navbar also uses; add a key there rather than inlining SVG
paths in a shell.

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
  A blank max teams is the form's way of saying "unlimited", so it is the one
  blank value the multipart body still sends; the waitlist toggle is disabled
  alongside it because an uncapped tournament never fills. Choosing a
  registration mode sets the automatic-approval toggle — open entry approves on
  submission, slot based reviews — and the admin can still override it.
  A free tournament reports no payment state on its registrations, because
  nothing was ever owed.
- Saved-team administration preserves persisted `COACH` members and nullable
  coach phone data. Registration-facing saved-team selection hydrates a coach
  draft separately from player/substitute roster drafts, while the backend
  enforces the same-tournament coach/player conflict boundary.

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
  self-assigning or unassigning a conversation. Staff replies use the shared
  private screenshot attachment picker and renderer.
