# Admin Operations

This document covers the admin UI and admin API workflows that operators use most often: tournament registrations, recruitment applications, Excel downloads, deletion, and related bracket effects.

All admin routes require a valid session and `user.role === "admin"`.

## Admin UI Routes

- `/admin` for overview metrics
- `/admin/users` for account management
- `/admin/tournaments` for tournament setup and asset management
- `/admin/tournaments/new` for creating tournaments
- `/admin/tournaments/[id]/edit` for tournament editing and bracket management
- `/admin/registrations` for tournament registration review
- `/admin/recruitment` for Join Quest recruitment review
- `/admin/rulebooks` for rulebook management
- `/admin/contact-messages` for the contact inbox

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
- Back up PostgreSQL and `backend/uploads/` together; admin exports are recreated from database and upload metadata when needed.
