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

- Creates a server-side session record.
- Sets an `HttpOnly`, `SameSite=Lax` cookie.
- Uses the remember-me TTL when `remember` is truthy.

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

- `registrationState`
- `isRegistrationOpen`
- `isSlotsFull`
- `isRegistrationClosed`
- `bannerUrl`

### `GET /api/tournaments/:slug`

Returns a single published tournament by slug.

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
