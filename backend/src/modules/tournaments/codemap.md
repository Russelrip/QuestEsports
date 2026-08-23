# `backend/src/modules/tournaments/`

## Responsibility

Owns tournament identity, public/admin mapping, child configuration, team
registration, capacity, payment reservations, roster rules, and brackets.
Each tournament remains independently operable when linked to an event.

## Event boundary

`Tournament.seriesId` is nullable and `Tournament.series` uses `SetNull` on
event deletion. `createAdminTournament` can create a child with a forced
series ID; `attachTournamentToSeries` links an existing tournament without
copying or deleting its registrations. The projected `series` carries the
parent's `isPublished` so a public listing can tell whether an event card
already stands in for the child; a child of a draft event stays listed on its
own. `mapTournament` is the public-safe child projection used inside event
responses; `mapAdminTournament` adds only admin configuration fields needed
by the editor. `showBracketPublicly` is
persisted per tournament and exposed by both mappings with a legacy `true`
fallback; public bracket consumers require that setting plus a published,
non-empty native or Challonge source.

## Capacity and waitlist flow

`registration-eligibility.js` is the capacity source of truth. Active rows are
paid or pending with an unexpired reservation; rejected and waitlisted rows do
not consume capacity. Admin holds are counted separately and can be consumed
atomically. `registration-state.js` exposes register, full, closed, and
waitlist-open actions. `registration.service.js` assigns monotonically
increasing per-tournament waitlist positions and no slot/payment reservation
to waitlisted submissions. Registration writes reload the child and related
EventSeries window inside the transaction so parent open/close boundaries are
authoritative; only an active payment reservation keeps the existing retry
exception.

Admin status changes run serializably. Only the first waitlisted row may be
promoted when a slot is available; promotion assigns the lowest free slot,
clears the position, and compacts later rows. Rejection also compacts the
queue. Approval, including waitlist promotion and admin payment override,
atomically consumes every pending registration invite into the active roster
by accepting it and clearing its invite token metadata; that accepted invite
state is mirrored to the matching pending saved-team roster row when linked,
without setting its user link. It is carried into paid profile synchronization
without forcing an account link, and an explicit accepted source state takes
precedence over a conflicting saved-member link. An explicit declined state is
carried through as consumed without re-inviting, preserving its response
timestamp and clearing token metadata.
Verification is recalculated from any remaining non-captain invite states.
Payment status remains provider-controlled except for the deliberate
free-registration/admin-waiver paths.

## Saved-team registration flow

Team registration may hydrate player/substitute drafts and a saved `COACH`
member into the separate registration coach draft. The saved coach is not
re-created as a player, and its nullable phone value is preserved when the
registration payload is built. The shared `role-conflict.service.js` compares
normalized email and nonblank case-insensitive Riot ID identities only within
the same tournament, using the active-registration predicate and excluding the
registration being retried. It is called transactionally by public create,
retry, and payment-continuation flows; admin Game ID and roster/coach
corrections; waitlist promotion and payment override; and payment reopening or
late PayHere acceptance. Coaches remain outside active-player and substitute
counts.

## Public privacy

Published tournament/event projections include display metadata, registration
state/capacity, public media, and approved participant cards. Captain contact
details, roster member data, payment evidence, provider data, admin notes, and
private holds remain behind admin/ownership checks.
