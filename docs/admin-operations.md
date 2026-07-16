# Admin Operations

## Game, Sponsor, and Organization Content

- Populate `/admin/games` with approved 4:3 category artwork and transparent game logos. The migration creates published artwork-free records for Valorant, PUBG Mobile, MLBB, and CODM.
- Set organizer, country, location, category, hero, and an HTTPS Challonge tournament link in the tournament editor. Use 1600×1200 card artwork.
- Add ordered sponsor logos after saving the tournament. Sponsor websites must use HTTPS.
- Use `/admin/teams` to verify organization labels or delete saved teams. Captains cannot self-assign labels; blank labels display as `Independent`.
- Review every live gallery description after deployment because production poster descriptions are not stored in this repository.

This document covers the admin UI and API workflows for tournament/event configuration, registrations, payments, merchandise, recruitment, exports, deletion, and bracket effects.

All admin routes require a valid session and `user.role === "admin"`.

## Admin UI Routes

- `/admin` for overview metrics
- `/admin/users` for account management
- `/admin/tournaments` for tournament setup and asset management
- `/admin/tournaments/new` for creating tournaments
- `/admin/tournaments/[id]/edit` for tournament editing and bracket management
- `/admin/event-series` for published event groupings and hero images
- `/admin/registrations` for tournament registration review
- `/admin/payments` for bank-transfer review and PayHere reconciliation
- `/admin/products` for products, variants, images, prices, and stock
- `/admin/orders` for paid-order fulfilment
- `/admin/recruitment` for Join Quest recruitment review
- `/admin/rulebooks` for rulebook management
- `/admin/contact-messages` for the contact inbox
- `/admin/teams` for saved-team organization labels and deletion

## Saved Team Deletion

Admins can delete a saved team from `/admin/teams`:

```text
DELETE /api/admin/teams/:teamId
```

Deletion removes the reusable `SavedTeam` and cascades its saved roster members and pending invites. Existing tournament registrations remain and are detached from the deleted saved team.

## Tournament Registration Review

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

Filters include `page`, `pageSize`, `status`, and `purpose`. Payment statuses include `created`, `pending`, `paid`, `failed`, `cancelled`, `charged_back`, `expired`, `review_required`, and `refunded`. Purposes are `tournament_registration` and `merchandise_order`.

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
- `Team Members`: application ID, application type, applicant name, team name, member contact fields, IGN, player ID, role, and NIC

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
