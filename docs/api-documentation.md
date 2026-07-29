# API Documentation

Email-producing endpoints are summarized here as part of their API behavior. For the complete recipient, trigger, subject, token, queue, and delivery reference, see [Email System](./email-system.md).

This document describes the implemented HTTP API in `backend/src`. All routes are served from the backend under the `/api` prefix.

## Base URL

- Local: `http://localhost:5001`
- Production example: `https://api.questesports.lk`

## Authentication Model

- Session auth uses an `HttpOnly` cookie.
- The frontend sends cookies with `credentials: "include"`.
- Protected routes require the session cookie to be present and valid.
- Admin routes require `user.role === "admin"`.
- Tournament registration additionally requires `emailVerified === true`.
- The cookie name comes from the required `SESSION_COOKIE_NAME` environment variable.

See [Authentication Flow](./authentication-flow.md) for the full flow.

## Common Response Shapes

### Success

Most endpoints return:

```json
{
  "success": true,
  "message": "Optional message"
}
```

### Error

Typical error shape:

```json
{
  "success": false,
  "message": "Human-readable error",
  "details": {}
}
```

Field-level validation errors are returned in `details.fieldErrors` on validation failures.

### Maintenance

When site maintenance is enabled, normal API routes return `503 Service Unavailable` with `Retry-After`, `Cache-Control: no-store`, and `X-Maintenance-Mode: active` headers:

```json
{
  "success": false,
  "code": "SITE_MAINTENANCE",
  "message": "We’re carrying out scheduled maintenance. Please try again shortly.",
  "retryAfterSeconds": 900,
  "requestId": "request-id"
}
```

`GET /api/health/live` remains `200`. `GET /api/health` and `GET /api/health/ready` return the intentional maintenance `503`. The exact `POST /api/payments/payhere/notify` route remains available for already-started payment notifications; other API routes, including the OpenAPI document, are protected.

## Security And Request Rules

- CSRF protection checks `Origin` or `Referer` on non-safe methods.
- Allowed origins come from `CORS_ORIGIN`.
- Rate limiting is applied to login, signup, contact, password reset, invite response, and tournament registration endpoints.
- Team-logo uploads accept JPEG, PNG, and WebP with a 5 MB per-file limit.
- Admin poster and tournament asset uploads have a 10 MB per-file limit. Tournament assets also accept `.xlsx` and `.csv` schedule files.

## System Endpoints

### `GET /api/health`

Returns a minimal public health response. The readiness variants additionally report only whether required dependency classes are ready; detailed operational metrics remain in structured logs and monitoring systems.

`GET /api/health/live` reports process liveness and includes `maintenance.enabled`. During maintenance, readiness returns `503` with the maintenance response described above.

### `GET /api/openapi.json`

Returns the lightweight OpenAPI contract maintained in `backend/src/lib/openapi.js`.

## Auth Endpoints

### `POST /api/signup`

Creates a new user and attempts to send a verification email.

Body:

```json
{
  "firstName": "Jane",
  "lastName": "Player",
  "email": "jane@example.com",
  "username": "janeplayer",
  "password": "secret123",
  "confirmPassword": "secret123",
  "terms": true,
  "phone": "0771234567",
  "discordTag": "jane#1234"
}
```

Behavior:

- Requires unique email and username.
- Stores password as a bcrypt hash.
- Creates a 24-hour email verification token.
- If mail delivery is not configured, the account is still created but the verification email is skipped.

### `POST /api/login`

Authenticates by email or username and sets the session cookie.

Body:

```json
{
  "emailOrUsername": "jane@example.com",
  "password": "secret123",
  "remember": true
}
```

Behavior:

- Creates a server-side session record when MFA is not enabled.
- Sets an `HttpOnly`, `SameSite=Lax` cookie after a completed login.
- Uses the remember-me TTL when `remember` is truthy.
- Applies account lockout rules after repeated password failures.

Possible MFA response:

```json
{
  "success": true,
  "message": "Verification code required.",
  "requiresMfa": true,
  "challengeToken": "raw-login-challenge-token",
  "challengeExpiresAt": "2026-05-25T12:00:00.000Z",
  "user": {
    "id": "uuid",
    "email": "jane@example.com",
    "username": "janeplayer",
    "firstName": "Jane",
    "lastName": "Player",
    "role": "user",
    "mfaEnabled": true
  }
}
```

### `POST /api/login/mfa`

Completes an MFA login challenge and sets the session cookie.

Body:

```json
{
  "challengeToken": "raw-login-challenge-token",
  "code": "123456",
  "backupCode": "AB12CD34"
}
```

Behavior:

- Requires either `code` or `backupCode`.
- Authenticator codes are checked against the encrypted TOTP secret.
- Backup codes are single-use.

### `GET /api/auth/google/start`

Starts Google OAuth and redirects to Google.

Optional query params:

- `redirect`: relative frontend path to return to after login

### `GET /api/auth/discord/start`

Starts Discord OAuth and redirects to Discord.

Optional query params:

- `redirect`: relative frontend path to return to after login

### `GET /api/auth/google/callback`

Completes Google OAuth, creates a local session, and redirects to the frontend.

### `GET /api/auth/discord/callback`

Completes Discord OAuth, creates a local session, and redirects to the frontend.

### `POST /api/logout`

Deletes the current session if present and clears the session cookie.

### `GET /api/me`

Returns the current authenticated user or `null`.

### `GET /api/users/:userId`

Protected route.

Access rules:

- Allowed for the same user
- Allowed for admins

### `PATCH /api/users/:userId`

Protected route.

Updates:

- `firstName`
- `lastName`
- `username`
- `phone`
- `discordTag`

Access rules:

- Allowed for the same user
- Allowed for admins

### `GET /api/email-verification/verify?token=...`

Consumes a 24-hour verification token and marks the user as verified.

### `POST /api/email-verification/resend`

Body:

```json
{
  "email": "jane@example.com"
}
```

Behavior:

- Quietly succeeds even if the account does not exist.
- Sends a new verification email only for existing unverified accounts.
- If mail delivery is not configured, the request can still succeed without sending mail.

### `POST /api/email-change/request`

Protected route.

Body:

```json
{
  "newEmail": "new@example.com",
  "currentPassword": "secret123"
}
```

Behavior:

- Verifies the current password.
- Reserves `pendingEmail` on the user record.
- Creates a 24-hour email change token.
- If mail delivery is not configured, the request can still succeed without sending mail.

### `GET /api/email-change/confirm?token=...`

Consumes the email-change token and promotes `pendingEmail` to the primary email.

### `POST /api/forgot-password`

Body:

```json
{
  "email": "jane@example.com"
}
```

Behavior:

- Quietly succeeds even if the email does not exist.
- Creates a 20-minute password reset token for existing accounts.
- If mail delivery is not configured, the request can still succeed without sending mail.

### `POST /api/reset-password`

Body:

```json
{
  "token": "raw-token-from-email",
  "newPassword": "newsecret123"
}
```

Behavior:

- Resets the password
- Consumes the token
- Deletes all existing sessions for that user

### `GET /api/mfa/setup`

Protected route.

Creates or refreshes the pending MFA secret for the current user.

Returns:

- `secret`
- `otpauthUrl`

### `POST /api/mfa/verify-setup`

Protected route.

Body:

```json
{
  "code": "123456"
}
```

Behavior:

- Enables MFA
- Returns a new backup-code set
- Revokes other active sessions

### `POST /api/mfa/disable`

Protected route.

Body:

```json
{
  "currentPassword": "secret123",
  "code": "123456",
  "backupCode": "AB12CD34"
}
```

Behavior:

- Verifies the current password
- Requires an authenticator code or backup code when MFA is enabled
- Deletes MFA credentials, login challenges, and backup codes
- Revokes other active sessions

### `POST /api/mfa/backup-codes/regenerate`

Protected route.

Uses the same request body as MFA disable.

Behavior:

- Verifies the current password plus a second factor
- Replaces all existing backup codes
- Revokes other active sessions

### `GET /api/sessions`

Protected route.

Returns a list of active sessions for the current user.

### `DELETE /api/sessions/:sessionId`

Protected route.

Revokes one session owned by the current user.

### `POST /api/sessions/revoke-others`

Protected route.

Revokes all other sessions while keeping the current session active.

## Contact Endpoint

### `POST /api/contact`

Creates a contact submission.

Body:

```json
{
  "name": "Jane Player",
  "email": "jane@example.com",
  "subject": "Tournament question",
  "message": "Can we update our roster?"
}
```

## Public Tournament Endpoints

### `GET /api/event-series`

Returns published event series ordered for public tournament navigation.

### `GET /api/event-series/:slug`

Returns one published series with its ordered published child tournaments.

### `GET /api/tournaments`

Query params:

- `game`

Returns published tournaments only.

Important response fields:

- `displayPriority`
- `registrationOpenAt`
- `registrationState`
- `isRegistrationOpen`
- `isSlotsFull`
- `isRegistrationClosed`
- `bannerUrl`
- `scheduleData`
- `isCompleted`
- `showcase`
- `startDateStatus`, `endDateStatus`, `registrationDeadlineStatus`
- `entryType`, roster limits, configured registration fields, and payment capability/instructions safe for public display

### `GET /api/tournaments/:slug`

Returns a single published tournament by slug.

Additional response fields:

- `registeredTeams`
- `bracketSummary`
- `bracketData`
- `scheduleData`
- `showcase`
- `isCompleted`
- approved team or solo participant cards

`registeredTeams` includes approved team names, public team-logo URLs, derived short codes, member counts, and statuses.

`bracketSummary` and `bracketData` are returned only when a native bracket exists and has been published by an admin. Draft brackets are hidden from public tournament responses.

## Tournament Registration Endpoints

### `GET /api/tournaments/:slug/registration-status`

Protected route.

Returns:

```json
{
  "success": true,
  "isRegistered": false
}
```

The check is based on the authenticated user ID or matching legacy captain email.

### `POST /api/tournaments/:slug/registrations`

Protected route.

Requirements:

- Logged in
- Verified email
- Tournament must be open
- Tournament must not be full

Content type:

- `multipart/form-data`

Primary fields:

- The tournament slug is taken only from the URL; request-body tournament identifiers are ignored.
- `teamName`
- `teamLogo`
- `captainName`
- `captainPhone`
- `captainDiscord`
- `captainRiotId`
- `contactEmail`
- `members` JSON generated from the tournament's roster configuration
- `additionalData` and member-level additional data generated from configured fields
- `rulebook`
- `falsityWarning`

Behavior:

- The captain email is taken from the authenticated user session, not the form.
- Registration fails if member emails are invalid or duplicated.
- Registration and slot allocation are serialized in a Prisma transaction.
- Successful registration also synchronizes a `SavedTeam` roster and sends invite emails to non-captain members.
- The captain is linked and accepted automatically. Other members remain pending until they respond using a verified account with the invited email address.
- Solo events omit team roster requirements and render player entries publicly after approval.
- Free registration confirms immediately.
- PayHere registration returns a signed checkout only when all provider values are configured.
- Bank-transfer registration assigns a slot and quoted fee tier, returns bank instructions, and waits for a private receipt plus admin approval.
- Capacity counts paid/confirmed registrations and unexpired reservations; expired reservations release their slot.
- Payment and registration-status reads enforce an elapsed reservation immediately instead of waiting for the maintenance worker. Expired registrations require an administrator to reopen payment.

## Account Endpoints

### `GET /api/me/dashboard`

Protected route returning current/past tournament registrations, latest payment state, captain/member teams, recent account-linked merchandise orders, and a truncation flag when registration history exceeds the response limit.

### `POST /api/me/avatar`

Protected `multipart/form-data` upload using field `avatar`. Accepts validated JPEG, PNG, or WebP up to 5 MB, normalizes the image, replaces the previous file, and returns the updated user.

### `DELETE /api/me/avatar`

Protected route clearing the avatar reference and removing the previous file when possible.

## Recruitment Application Endpoints

### `POST /api/recruitment-applications`

Protected route requiring a verified account.

Supported application types:

- `solo_player`
- `existing_team`
- `incomplete_team`

Body is JSON. Primary fields:

- `applicationType`
- `fullName`
- `phone`
- `discord`
- `games`
- `ign`
- `birthday`
- `gender`
- `peakAndCurrentRank`
- `tournamentExperience`
- `previouslyInOrganization`
- `previousOrganization`
- `canAttendLan`
- `teamLogoUrl`
- `additionalMembers`
- `declarationAccepted`
- `nic`
- `notes`
- Team applications only: `teamName`, `currentRosterSize`, `members`
- Every team member object must include `privacyAccepted: true` after the applicant confirms that member gave permission to submit their contact details and NIC.

Behavior:

- The applicant email is taken from the authenticated user session.
- `games` must contain at least one selected game.
- `gender` must be `male`, `female`, or `other`.
- NIC values are encrypted before storage.
- Each submitted team member stores a `privacyAcceptedAt` timestamp in the application JSON. Older records may not contain it.
- Existing-team applications require a roster size from 5 to 20 and at least four additional members.
- Incomplete-team applications require a roster size from 2 to 4 and between one and three additional members.

## Team Endpoints

### `GET /api/teams/profile`

Protected route.

Returns teams the logged-in user captains or has accepted an invitation to join.

### `POST /api/teams`

Protected route requiring a verified account. Creates a reusable profile team from multipart team/roster fields and an optional `teamLogo`; it does not register the team for a tournament.

### `PATCH /api/teams/:teamId`

Protected multipart route requiring a verified account and team captain ownership. Updates the reusable team's name, country, tag, organization request, logo, and roster. Accepted members with unchanged email addresses remain linked; new or changed members receive fresh invitations. Tournament-registration history is not rewritten.

### `DELETE /api/teams/:teamId`

Protected route requiring a verified account and team captain ownership. Deletes the reusable team and roster only when the team has no tournament registrations. Registered teams must be retained.

### `GET /api/team-invite?token=...`

Public route.

Returns invite preview details for a tournament-registration member invite token.

### `POST /api/team-invite/respond`

Protected route requiring a verified account. The account email must match the invited email address.

Body:

```json
{
  "token": "invite-token",
  "decision": "accept"
}
```

Accepted values:

- `accept`
- `decline`

Accepting links both the tournament-registration member and saved-team member to the account. The registration verification status becomes `verified` when every member has accepted, `flagged` when any member declines, and otherwise remains `pending`.

## Rulebook Endpoints

### `GET /api/rulebooks`

Returns published rulebooks for public display and tournament form choices.

### `GET /api/rulebooks/:slug`

Returns one public rulebook by slug.

## Media Endpoints

### Public media

- `GET /api/posters`
- `GET /api/posters/:posterId`
- `GET /api/posters/:posterId/image`
- `GET /api/uploads/tournament-banners/:filename`
- `GET /api/uploads/poster-images/:filename`
- `GET /api/uploads/team-logos/:filename`
- `GET /api/uploads/avatars/:filename`

### Admin-only media

- `GET /api/images`
- `GET /api/images/:imageId`
- `GET /api/images/:imageId/binary`
- `POST /api/images`
- `POST /api/posters`
- `DELETE /api/posters/:posterId`

### `POST /api/images`

Admin-only multipart upload.

Fields:

- `title`
- `description`
- `category`
- `images[]`

### `POST /api/posters`

Admin-only JSON payload.

Fields:

- `imageAssetId`
- `title`
- `description`
- `category`
- `headline`
- `subheadline`
- `accentColor`
- `textColor`
- `overlayAlign`
- `tournamentId`

## Shop And Payment Endpoints

### Public products and capabilities

- `GET /api/products`
- `GET /api/products/:slug`
- `GET /api/products/:productId/images/:imageId`
- `GET /api/commerce/capabilities`

Only active products/variants are public. Capabilities report whether PayHere and merchandise checkout are currently available.

### Order quote and checkout

- `POST /api/orders/quote`
- `POST /api/orders`
- `GET /api/orders/:publicToken`

Quotes recompute prices, stock, currency, delivery fee, and total on the server. Orders accept guest or signed-in customer/delivery details, reserve tracked inventory for `SHOP_ORDER_RESERVATION_MINUTES`, reject mixed currencies/non-LKR products, and require the client's expected total/currency to match the server quote. Creating an order requires PayHere configuration.

The public token is an order-access credential and must not be logged or shared. Browser return pages read local order/payment status; only the verified provider callback can mark PayHere paid.

### Payment status and callbacks

- `GET /api/payments/:orderId`
- `POST /api/payments/payhere/notify`
- `POST /api/payments/:orderId/bank-transfer-proof`

Payment status requires ownership of the registration/order or the matching merchandise public token. The PayHere notification is form-encoded, rate limited, signature/merchant/order/amount/currency validated, idempotent, and authoritative.

Bank-transfer proof upload requires a verified account that owns the registration. It accepts one normalized image by default; PDF is accepted only when explicitly enabled. Proof files are private and are never available through `/api/uploads`.

## Admin Endpoints

All admin routes require a valid session and `role === "admin"`.

### Dashboard

- `GET /api/admin/dashboard`

Returns:

- `totalTournaments`
- `openTournaments`
- `totalRegistrations`
- `pendingRecruitmentApplications`
- `unreadContactMessages`

### Users

- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/users/:userId`
- `PATCH /api/admin/users/:userId`
- `DELETE /api/admin/users/:userId`

Supported filters on list:

- `page`
- `pageSize`
- `search`
- `role`

Notes:

- Admins cannot remove their own admin role.
- Admins cannot delete their own account.
- Updating a user's password clears that user's active sessions.

### Contact messages

- `GET /api/admin/contact-messages`
- `PATCH /api/admin/contact-messages/:messageId`
- `DELETE /api/admin/contact-messages/:messageId`

Supported filters on list:

- `page`
- `pageSize`
- `search`
- `isRead`

### Tournament registrations

- `GET /api/admin/team-registrations`
- `GET /api/admin/team-registrations/export`
- `GET /api/admin/tournaments/:tournamentId/registrations`
- `PATCH /api/admin/team-registrations/:registrationId/status`
- `DELETE /api/admin/team-registrations/:registrationId`

Supported list filters:

- `page`
- `pageSize`
- `search`
- `tournament`
- `status`
- `paymentStatus`
- `verificationStatus`

Allowed status values:

- Registration status: `pending`, `approved`, `rejected`
- Payment status: `unpaid`, `pending`, `paid`
- Verification status: `pending`, `verified`, `flagged`

Excel export:

- Accepts the same filters as the list endpoint.
- Returns an `.xlsx` attachment with `Registrations` and `Roster Members` sheets.
- Filenames follow `team-registrations-YYYY-MM-DD.xlsx`.

Deletion removes the registration and cascades its registration-member rows. It does not delete the reusable saved team roster.

See [Admin Operations](./admin-operations.md) for export columns and deletion behavior.

### Recruitment applications

- `GET /api/admin/recruitment-applications`
- `GET /api/admin/recruitment-applications/export`
- `PATCH /api/admin/recruitment-applications/:applicationId/status`
- `DELETE /api/admin/recruitment-applications/:applicationId`

Supported list/export filters:

- `page`
- `pageSize`
- `search`
- `status`
- `applicationType`

Allowed status values:

- `pending`
- `reviewed`
- `accepted`
- `rejected`

Allowed application types:

- `solo_player`
- `existing_team`
- `incomplete_team`

Excel export:

- Accepts the same filters as the list endpoint.
- Returns an `.xlsx` attachment with `Applications` and `Team Members` sheets.
- Filenames follow `recruitment-applications-YYYY-MM-DD.xlsx`.
- Includes sensitive applicant data such as NIC values for admin review.

Deletion removes the recruitment application record and does not send email.

### Tournaments

- `GET /api/admin/tournaments`
- `GET /api/admin/tournaments/:tournamentId`
- `POST /api/admin/tournaments`
- `PATCH /api/admin/tournaments/:tournamentId`
- `DELETE /api/admin/tournaments/:tournamentId`

Create/update uses `multipart/form-data` because `bannerImage` can be uploaded.

Main fields:

- `title`
- `slug`
- `game`
- `displayPriority`
- `shortDescription`
- `fullDescription`
- `rules`
- `startDate`
- `endDate`
- `registrationOpenAt`
- `registrationDeadline`
- `startDateStatus`, `endDateStatus`, `registrationDeadlineStatus` (`scheduled`, `tba`, or `tbd`)
- `format`
- `teamSize`
- `entryType`
- `minRosterSize`, `maxRosterSize`, `maxSubstitutes`
- `registrationFields`
- `paymentMethod` (`free`, `payhere`, or `bank_transfer`)
- `registrationFeeAmount`, `registrationFeeCurrency`, `registrationFeeTiers`
- `reservationMinutes`, `bankTransferReviewMinutes`
- bank name/branch/account fields for bank-transfer events
- `seriesId`, `seriesOrder`, `rulebookId`
- `maxTeams`
- `prizePool`
- `status`
- `isPublished`
- `isFeatured`
- `bracketLink`
- `contactLink`
- `bannerImage`
- `scheduleFile`
- `completedPosterImage`
- `firstPlaceImage`
- `secondPlaceImage`
- `thirdPlaceImage`

Optional remove flags during update:

- `removeBannerImage`
- `removeScheduleFile`
- `removeCompletedPosterImage`
- `removeFirstPlaceImage`
- `removeSecondPlaceImage`
- `removeThirdPlaceImage`

### Event series

- `GET /api/admin/event-series`
- `POST /api/admin/event-series`
- `PATCH /api/admin/event-series/:seriesId`
- `DELETE /api/admin/event-series/:seriesId`

### Products and orders

- `GET /api/admin/products`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:productId`
- `DELETE /api/admin/products/:productId`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:orderId`

Product writes include variants and references to existing uploaded image assets. Product delete archives rather than erasing order history. Only paid orders can progress through processing/fulfilment.

### Payment operations

- `GET /api/admin/payments`
- `GET /api/admin/payments/:transactionId/bank-transfer-proof`
- `PATCH /api/admin/payments/:transactionId/bank-transfer-review`
- `POST /api/admin/payments/:transactionId/reopen`
- `PATCH /api/admin/payments/:transactionId/payhere-reconciliation`

Private bank evidence is returned with `Cache-Control: private, no-store` and attachment headers. The reopen endpoint supports expired bank-transfer and PayHere tournament payments, rechecks capacity, and starts a fresh reservation deadline. PayHere reconciliation records an externally verified late payment or completed refund; it does not call a PayHere refund API.

### Rulebooks

- `POST /api/admin/rulebooks`
- `PATCH /api/admin/rulebooks/:rulebookId`
- `DELETE /api/admin/rulebooks/:rulebookId`

Admin rulebook writes accept JSON fields used by the rulebook editor: `title`, `slug`, `game`, `variant`, and `content`.

### Native tournament brackets

- `GET /api/admin/tournaments/:tournamentId/bracket`
- `POST /api/admin/tournaments/:tournamentId/bracket/generate`
- `PATCH /api/admin/tournaments/:tournamentId/bracket/matches/:matchId`
- `PATCH /api/admin/tournaments/:tournamentId/bracket/publish`

Native brackets are admin-only to create and edit. Generation uses approved team registrations only and creates a double-elimination bracket with BYEs as needed.

`GET /api/admin/tournaments/:tournamentId/bracket` returns the current bracket or `null`.

`POST /api/admin/tournaments/:tournamentId/bracket/generate` regenerates the draft bracket from approved teams. At least two approved teams are required. Regeneration resets publication state to draft.

`PATCH /api/admin/tournaments/:tournamentId/bracket/matches/:matchId` updates a match result and advances bracket state.

Body:

```json
{
  "opponent1Score": 13,
  "opponent2Score": 7,
  "winner": "opponent1"
}
```

Allowed `winner` values:

- `opponent1`
- `opponent2`

`PATCH /api/admin/tournaments/:tournamentId/bracket/publish` toggles public visibility.

Body:

```json
{
  "isPublished": true
}
```

### Admin media jobs

- `POST /api/admin/media/import-legacy-posters`
- `POST /api/admin/media/migrate-image-assets`

These are maintenance operations intended for controlled admin use.

## Pagination

Paginated admin/media endpoints return:

```json
{
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 42,
    "totalPages": 5
  }
}
```

## Operational Notes

- `/api/openapi.json` is useful for quick inspection but does not fully describe every route and payload in the codebase.
- The backend is source-of-truth for registration availability and duplicate checks.
- Admin Excel exports are generated on demand and are not written to `backend/uploads/`.
- Approved tournament team logos are exposed on public tournament detail responses and served through upload URLs.
- Native brackets are public only after admin publication.
