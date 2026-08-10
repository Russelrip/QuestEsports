# Admin Operations

## Game, Sponsor, and Organization Content

- Populate `/admin/games` with approved 4:3 category artwork and transparent game logos. The migration creates published artwork-free records for Valorant, PUBG Mobile, MLBB, and CODM.
- Set organizer, country, location, category, hero, and an HTTPS Challonge tournament link in the tournament editor. Use 1600×1200 card artwork.
- Add ordered sponsor logos after saving the tournament. Sponsor websites must use HTTPS.
- Use `/admin/teams` to review rosters, verify organization labels, and replace or remove team logos. Captains cannot self-assign labels; blank labels display as `Independent`.
- Review every live gallery description after deployment because production poster descriptions are not stored in this repository.

This document covers the admin UI and API workflows for tournament/event configuration, entrance tickets, registrations, payments, merchandise, recruitment, exports, deletion, and bracket effects.

All admin routes require a valid session and `user.role === "admin"`.

## Admin UI Routes

- `/admin` for overview metrics
- `/admin/media` for the managed image library and read-only public upload-folder browser
- `/admin/users` for account management
- `/admin/tournaments` for tournament setup and asset management
- `/admin/tournaments/new` for creating tournaments
- `/admin/tournaments/[id]/edit` for tournament editing and bracket management
- `/admin/event-series` for published event groupings and hero images
- `/admin/registrations` for tournament registration review
- `/admin/payments` for bank-transfer review and PayHere reconciliation
- `/admin/tickets` for ticket events, paid orders, attendee QR codes, scanning, and check-in reports
- `/admin/products` for products, variants, images, prices, and stock
- `/admin/orders` for paid-order fulfilment
- `/admin/recruitment` for Join Quest recruitment review
- `/admin/rulebooks` for rulebook management
- `/admin/contact-messages` for the contact inbox
- `/admin/teams` for saved-team details, logos, organization labels, and deletion

## Media Library

`/admin/media` provides two related views:

- The managed library contains poster and product image assets. Admins can upload, search, filter, preview, download, and copy image URLs. An unused asset can be deleted; assets referenced by a gallery entry or product are locked until the owning reference is removed.
- Public Storage lists the allowlisted filesystem folders for tournament artwork, poster images, team logos, avatars, game assets, and sponsor logos. Files can be previewed, downloaded, and linked. Deletion remains in the tournament, team, game, sponsor, product, or gallery workflow that owns the reference.

The browser never lists `PRIVATE_UPLOAD_ROOT`, bank-transfer evidence, recovery packages, environment files, credentials, or arbitrary server paths. A missing public folder is treated as empty, which is normal in a new staging environment.

## Saved Team Details and Logos

Admins can edit the team name, tag, country, organization label, roster details, and logo from the `/admin/teams` directory. The team update endpoint accepts an optional multipart `teamLogo` (JPEG, PNG, or WebP, up to 5 MB) and a `removeLogo` flag.

Logo replacements and removals are copied to every tournament registration linked to the saved team. Public participant lists and published native brackets therefore use the current logo without requiring bracket regeneration.

Team-name changes are copied to every linked tournament registration, native bracket seed and participant, and exact team-name cells in saved tournament schedules. Registration-backed account, payment, export, admin, and public tournament views therefore show the current saved-team name.

## Captain Transfers

Admins can transfer captain ownership to an accepted roster member from the team detail view at `/admin/teams`. The action is intentionally separate from ordinary roster editing and always removes the former captain.

The new captain must have an accepted roster place linked to a verified Quest account. If the team has linked tournament registrations, the account must also have a phone number and the member must have an accepted place, Discord handle, and Game ID in every linked registration.

The transfer runs as one serializable database transaction. It changes saved-team ownership, promotes the selected member, removes the former captain, transfers each linked registration and registration roster, and updates registration contact and game-identity data. Conflicting team ownership or a second registration for the new captain in the same tournament blocks the entire operation. Successful transfers are written to the audit log as `saved_team.captain_transferred`.

## Saved Team Deletion

Admins can delete a saved team from `/admin/teams`:

```text
DELETE /api/admin/teams/:teamId
```

Deletion removes the reusable `SavedTeam` and cascades its saved roster members and pending invites. Existing tournament registrations remain and are detached from the deleted saved team.

## Tournament Registration Review

The registration page groups results under tournament headings so records from different tournaments are not mixed together. Search and status filters still apply to the complete result set.

The registration admin page reads from:

```text
GET /api/admin/team-registrations
```

Supported filters:

- `page`
- `pageSize`
- `search`
- `tournament`
- `status`
- `paymentStatus`
- `verificationStatus`

Admins can update any combination of:

- registration status: `pending`, `approved`, `rejected`
- payment status: `unpaid`, `pending`, `paid`
- verification status: `pending`, `verified`, `flagged`

Status updates use:

```text
PATCH /api/admin/team-registrations/:registrationId/status
```

Only approved registrations appear in public tournament team lists and are used when generating native brackets.

Registration rows may also expose entry type, assigned slot, quoted tier fee/currency, payment provider/order state, and reservation expiry. Payment state should normally be driven by verified PayHere callbacks or bank-transfer review rather than manually changed in the general registration table.

Paid registrations show the participant a live server-backed countdown. When it reaches zero, the reservation is expired atomically, its slot is released, and self-service payment restart/cancellation is disabled. The participant is directed to the tournament contact link (or the site contact page). From `/admin/payments`, an administrator can reopen an expired bank-transfer or PayHere registration when capacity remains; this creates a fresh payment window and bank transfers receive the lowest currently available numbered slot.

Admins can use **Approve without payment** for a deliberate fee waiver. This confirms the registration, assigns the lowest available slot (or consumes its private hold), cancels unfinished payment transactions, and records the administrator on the reconciliation. It cannot bypass tournament capacity.

A private admin hold assigns the lowest available numbered tournament slot and
snapshots its fee and currency immediately. The admin registration card displays
that locked slot and price. When the roster becomes eligible and starts payment,
the hold is consumed atomically and the same slot, amount, and currency are copied
to the registration and payment transaction. Releasing the hold makes that slot
available again.

## Paid Roster Corrections

Admins can replace the full roster from a registration detail view, including registrations that are already approved and paid. The corrected roster must contain exactly one captain. Every member must provide a name, verified Quest account email, Discord username, and Game ID, and cannot already belong to another non-rejected registration in the same tournament.

The correction is validated against the tournament's active-player and substitute limits. Admins may also replace the linked reusable saved-team roster in the same database transaction. Approval and payment state are preserved, accepted account links are rebuilt, verification is marked verified, and the action is recorded as `team_registration.roster_corrected`.

```text
PATCH /api/admin/team-registrations/:registrationId/roster
```

Use the saved-team option only when players are joining or leaving the reusable team, not for a tournament-only exception. Changing the captain of a linked saved team requires this option, transfers registration and saved-team ownership, and requires a phone number on the new captain's account. A roster correction cannot change the captain when that saved team has other linked registrations; use the separate full captain-transfer action in that case. Historical registrations other than the selected registration are not rewritten.

## Registration Deletion

Admins can delete a tournament registration from `/admin/registrations`.

The API endpoint is:

```text
DELETE /api/admin/team-registrations/:registrationId
```

Deletion removes the `TeamRegistration` row and cascades its `RegistrationMember` rows. It does not delete the captain's reusable `SavedTeam`; saved teams are profile rosters and can remain available for future registrations.

The duplicate-registration check and registration-status endpoint use `TeamRegistration` as the source of truth. After an admin deletes a registration, the same captain email can register for that tournament again. The frontend registration UI also rechecks the backend and clears stale local browser registration markers when the backend says the user is not registered.

If a bracket has already been generated, deleting or rejecting a registration does not automatically rewrite existing bracket data. Regenerate the draft bracket before publishing if seeds changed.

## Registration Excel Export

Admins can download the currently filtered registration set from `/admin/registrations`.

The API endpoint is:

```text
GET /api/admin/team-registrations/export
```

It accepts the same filters as the registration list. The response is an `.xlsx` attachment named like:

```text
team-registrations-YYYY-MM-DD.xlsx
```

Workbook sheets:

- `Registrations`: tournament, team, approval/payment/verification statuses, captain contact fields, roster count, accepted-member count, submission time, and logo URL
- `Roster Members`: tournament, team, registration ID, member role/order, member contact fields, Riot ID, invite status, invite response time, and linked account fields

The export is generated in memory and is not stored by the backend.

## Payment Review And Reconciliation

The payments page reads:

```text
GET /api/admin/payments
```

Filters include `page`, `pageSize`, `status`, and `purpose`. Payment statuses include `created`, `pending`, `paid`, `failed`, `cancelled`, `charged_back`, `expired`, `review_required`, and `refunded`. Purposes are `tournament_registration`, `merchandise_order`, and `ticket_order`.

The page groups filtered results by tournament, ticket event, or merchandise order so unrelated payment workflows remain visually separate.

## Event Ticketing and Check-in

Create and manage entrance fees from `/admin/tickets`. Each fee must be linked to one Event Series representing the LAN event, and an Event Series can have at most one entrance-fee setup. The purchase area appears only on that event's public page; there is no general public ticket catalog. The setup controls its venue and start time, sales window, capacity, currency, single-ticket price, pair-bundle price, and lifecycle status. For the standard offer, set the single price to LKR 500 and the pair price to LKR 800. The server always calculates totals as complete pairs plus an optional single: one ticket is LKR 500, two are LKR 800, and three are LKR 1,300.

Paid orders issue one independently signed QR code per attendee. The QR contains an opaque ticket identifier, version, and signature; it contains no buyer contact details. Reissuing a ticket increments its version and invalidates the previous QR.

Use either the browser camera scanner on `/admin/tickets` or the Tickets tab in the private Android admin app. Select the correct event before scanning. Verification is atomic and records accepted and rejected attempts, preventing two gates from admitting the same ticket at the same time. The result shows attendee/order details and clearly distinguishes accepted, already used, cancelled, unpaid, invalid, and wrong-event codes. Manual check-in is available from the attendee list when a camera cannot be used.

Relevant endpoints include:

```text
GET|POST /api/admin/ticket-events
GET|PATCH /api/admin/ticket-events/:eventId
GET /api/admin/ticket-events/:eventId/orders
GET /api/admin/ticket-events/:eventId/tickets
GET /api/admin/ticket-events/:eventId/report
POST /api/admin/ticket-events/:eventId/scan
POST /api/admin/ticket-events/:eventId/tickets/:ticketId/check-in
POST /api/admin/tickets/:ticketId/reissue
PATCH /api/admin/tickets/:ticketId
```

Ticket reservations expire after `TICKET_ORDER_RESERVATION_MINUTES` (30 minutes by default), releasing capacity. Payment callbacks are authoritative. Cancelling an event blocks new sales and check-ins; cancelling an individual ticket blocks that code. Download the event CSV report before and after doors close for an operational record.

### Bank transfers

- Download private evidence: `GET /api/admin/payments/:transactionId/bank-transfer-proof`
- Review: `PATCH /api/admin/payments/:transactionId/bank-transfer-review`

Review body:

```json
{
  "decision": "approve",
  "reason": "Bank reference verified"
}
```

Use the UI's allowed decision values. Approval marks the payment paid and confirms the registration. Rejection records the reason and releases the reserved slot. Verify the receipt against the bank account before approving; the uploaded image alone is not proof that funds settled.

### PayHere late-payment reconciliation

```text
PATCH /api/admin/payments/:transactionId/payhere-reconciliation
```

This endpoint applies only to `review_required` PayHere transactions. `accept` requires capacity/inventory to remain available. `mark_refunded` requires an operator note and the external PayHere refund reference. Complete refunds in PayHere first; this endpoint records the already-completed external action.

## Event Series

Admin event-series endpoints:

- `GET /api/admin/event-series`
- `POST /api/admin/event-series`
- `PATCH /api/admin/event-series/:seriesId`
- `DELETE /api/admin/event-series/:seriesId`

Create/update supports a hero image plus slug, title, description, display order, and publication state. Tournaments link to a series and use `seriesOrder`. Deleting a series detaches child tournaments rather than deleting them.

## Products And Orders

Product endpoints:

- `GET /api/admin/products`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:productId`
- `DELETE /api/admin/products/:productId`

Products contain one to 100 variants with unique SKUs, prices, optional size/color, optional inventory, and active state. Product deletion archives the product and deactivates its variants; it does not erase historical order-item snapshots.

Order endpoints:

- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:orderId`

Only provider-confirmed paid orders can move to `processing` or `fulfilled`. A pending-payment order may be cancelled and its reserved stock released. Paid-order cancellation requires the verified refund/reconciliation workflow rather than a direct status edit.

## Recruitment Application Review

Public recruitment submissions come from verified users through:

```text
POST /api/recruitment-applications
```

Supported application types:

- `solo_player`
- `existing_team`
- `incomplete_team`

Every newly submitted team member must have a checked permission declaration from the applicant before that member's contact or identity details are accepted. The backend records `privacyAcceptedAt` for each member. The admin UI shows that timestamp; older records created before July 29, 2026 are labeled as legacy records where permission was not captured.

The recruitment admin page reads from:

```text
GET /api/admin/recruitment-applications
```

Supported filters:

- `page`
- `pageSize`
- `search`
- `status`
- `applicationType`

Allowed statuses:

- `pending`
- `reviewed`
- `accepted`
- `rejected`

Status updates use:

```text
PATCH /api/admin/recruitment-applications/:applicationId/status
```

## Recruitment Deletion

Admins can delete a recruitment application from `/admin/recruitment`.

The API endpoint is:

```text
DELETE /api/admin/recruitment-applications/:applicationId
```

Deletion removes the `RecruitmentApplication` record. It does not send an email notification and it does not affect tournament registrations or saved teams.

## Recruitment Excel Export

Admins can download the currently filtered recruitment set from `/admin/recruitment`.

The API endpoint is:

```text
GET /api/admin/recruitment-applications/export
```

It accepts the same filters as the recruitment list. The response is an `.xlsx` attachment named like:

```text
recruitment-applications-YYYY-MM-DD.xlsx
```

Workbook sheets:

- `Applications`: application type, status, applicant contact fields, game fields, NIC, team fields, Women's League interest, detailed answers, notes, submitted time, and updated time
- `Team Members`: application ID, application type, applicant name, team name, member contact fields, IGN, player ID, role, NIC, and the member privacy-permission timestamp

Recruitment exports include sensitive applicant data such as NIC values. Treat downloaded files as private admin records.

## Email Behavior

Admin status changes, deletion, and Excel downloads do not send transactional email.

Current email-producing workflows are documented in [Email System](./email-system.md).

## Data Handling Notes

- Excel exports are generated on demand and not persisted in `backend/uploads/`.
- Admin export files can contain player contact data, account links, Discord handles, Riot IDs, and NIC values.
- Store exported files only where trusted operators can access them.
- Back up PostgreSQL, `UPLOAD_ROOT`, and `PRIVATE_UPLOAD_ROOT` together; admin exports are recreated from database and upload metadata when needed.
- Bank-transfer downloads and recruitment exports contain sensitive personal/payment evidence; do not keep them in shared download folders.
