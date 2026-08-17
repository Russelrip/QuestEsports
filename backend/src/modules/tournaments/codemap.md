# `backend/src/modules/tournaments/`

## Responsibility

Owns tournament identity, public/admin mapping, child configuration, team
registration, capacity, payment reservations, roster rules, and brackets.
Each tournament remains independently operable when linked to an event.

## Event boundary

`Tournament.seriesId` is nullable and `Tournament.series` uses `SetNull` on
event deletion. `createAdminTournament` can create a child with a forced
series ID; `attachTournamentToSeries` links an existing tournament without
copying or deleting its registrations. `mapTournament` is the public-safe
child projection used inside event responses; `mapAdminTournament` adds only
admin configuration fields needed by the editor.

## Capacity and waitlist flow

`registration-eligibility.js` is the capacity source of truth. Active rows are
paid or pending with an unexpired reservation; rejected and waitlisted rows do
not consume capacity. Admin holds are counted separately and can be consumed
atomically. `registration-state.js` exposes register, full, closed, and
waitlist-open actions. `registration.service.js` assigns monotonically
increasing per-tournament waitlist positions and no slot/payment reservation
to waitlisted submissions.

Admin status changes run serializably. Only the first waitlisted row may be
promoted when a slot is available; promotion assigns the lowest free slot,
clears the position, and compacts later rows. Rejection also compacts the
queue. Payment status remains provider-controlled except for the deliberate
free-registration/admin-waiver paths.

## Public privacy

Published tournament/event projections include display metadata, registration
state/capacity, public media, and approved participant cards. Captain contact
details, roster member data, payment evidence, provider data, admin notes, and
private holds remain behind admin/ownership checks.
