# API Documentation

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

## Security And Request Rules

- CSRF protection checks `Origin` or `Referer` on non-safe methods.
- Allowed origins come from `CORS_ORIGIN`.
- Rate limiting is applied to login, signup, contact, password reset, invite response, and tournament registration endpoints.
- Uploads accept JPEG, PNG, and WebP only, with a 5 MB file limit.
- Admin tournament asset uploads also accept `.xlsx`, `.xls`, and `.csv` schedule files.

## System Endpoints

### `GET /api/health`

Returns API health plus monitoring metadata.

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
- If SMTP is not configured, the account is still created but the verification email is skipped.

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
- If SMTP is not configured, the request can still succeed without sending mail.

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
- If SMTP is not configured, the request can still succeed without sending mail.

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
- If SMTP is not configured, the request can still succeed without sending mail.

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

### `GET /api/tournaments`

Query params:

- `game`

Returns published tournaments only.

Important response fields:

- `displayPriority`
- `registrationState`
- `isRegistrationOpen`
- `isSlotsFull`
- `isRegistrationClosed`
- `bannerUrl`
- `scheduleData`
- `isCompleted`
- `showcase`

### `GET /api/tournaments/:slug`

Returns a single published tournament by slug.

Additional response fields:

- `registeredTeams`
- `scheduleData`
- `showcase`
- `isCompleted`

## Tournament Registration Endpoints

### `GET /api/tournament-registration/status/:slug`

Protected route.

Returns:

```json
{
  "success": true,
  "isRegistered": false
}
```

The check is based on the logged-in user's email against the captain email of registrations for that tournament.

### `POST /api/tournament-registration`

Protected route.

Requirements:

- Logged in
- Verified email
- Tournament must be open
- Tournament must not be full

Content type:

- `multipart/form-data`

Primary fields:

- `tournamentSlug` or `tournamentId`
- `teamName`
- `teamLogo`
- `captainName`
- `captainPhone`
- `captainDiscord`
- `captainRiotId`
- `contactEmail`
- `player2Name`, `player2Email`, `player2Discord`, `player2RiotId`
- `player3Name`, `player3Email`, `player3Discord`, `player3RiotId`
- `player4Name`, `player4Email`, `player4Discord`, `player4RiotId`
- `player5Name`, `player5Email`, `player5Discord`, `player5RiotId`
- Optional substitutes: `sub1*`, `sub2*`
- Optional coach: `coach*`
- `rulebook`
- `falsityWarning`

Behavior:

- The captain email is taken from the authenticated user session, not the form.
- Registration fails if member emails are invalid or duplicated.
- Team registrations are serialized in a Prisma transaction.
- Successful registration also synchronizes a `SavedTeam` roster and sends invite emails to non-captain members.

## Team Endpoints

### `GET /api/teams/profile`

Protected route.

Returns saved teams for the logged-in captain.

### `GET /api/team-invite?token=...`

Public route.

Returns invite preview details for a saved-team invite token.

### `POST /api/team-invite/respond`

Public route.

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

## Media Endpoints

### Public media

- `GET /api/posters`
- `GET /api/posters/:posterId`
- `GET /api/posters/:posterId/image`
- `GET /api/uploads/tournament-banners/:filename`
- `GET /api/uploads/poster-images/:filename`

### Admin-only media

- `GET /api/images`
- `GET /api/images/:imageId`
- `GET /api/images/:imageId/binary`
- `POST /api/images`
- `POST /api/posters`
- `DELETE /api/posters/:posterId`
- `GET /api/uploads/team-logos/:filename`

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

## Admin Endpoints

All admin routes require a valid session and `role === "admin"`.

### Dashboard

- `GET /api/admin/dashboard`

Returns:

- `totalTournaments`
- `openTournaments`
- `totalRegistrations`
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
- `GET /api/admin/tournaments/:tournamentId/registrations`
- `PATCH /api/admin/team-registrations/:registrationId/status`

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
- `registrationDeadline`
- `format`
- `teamSize`
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
- Team logos are private to admins by design.
