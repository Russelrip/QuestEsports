# API Documentation

Email-producing endpoints are summarized here as part of their API behavior. For the complete recipient, trigger, subject, token, queue, and delivery reference, see [Email System](./email-system.md).

This document describes the implemented HTTP API in `backend/src`. All routes are served from the backend under the `/api` prefix.

## Base URL

- Local: `http://localhost:5001`
- Production example: `https://api.questesports.lk`

## Authentication Model

- Browser session auth uses an `HttpOnly` cookie.
- The frontend sends cookies with `credentials: "include"`.
- The private Android admin client sends its opaque session token as `Authorization: Bearer <token>`.
- Protected routes accept either a valid browser cookie or a valid mobile bearer session.
- Admin routes require `user.role === "admin"`.
- Tournament registration additionally requires `emailVerified === true`.
- The cookie name comes from the required `SESSION_COOKIE_NAME` environment variable.

Mobile bearer sessions are issued only through the mobile login flow, which requires an admin account. The raw token is returned once, stored by the app in Android Keystore-backed secure storage, and only its SHA-256 hash is stored in PostgreSQL. A request containing a browser session cookie remains subject to browser origin and CSRF checks even if it also contains an Authorization header.

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

New foundation endpoints use a versioned envelope:

```json
{
  "success": true,
  "data": {},
  "meta": { "serverNow": "2026-07-31T12:00:00.000Z" }
}
```

List resources add `meta.pagination`. All timestamps are ISO-8601 UTC. Existing unversioned response shapes remain supported for compatibility.

## Mobile Admin Authentication

- `POST /api/mobile/auth/login` validates the admin username/password and returns the opaque bearer token, expiry, and admin user. Non-admin accounts are rejected.
- `GET /api/mobile/auth/me` rehydrates the current bearer session.
- `POST /api/mobile/auth/logout` revokes the current bearer session.
- `GET /api/mobile/auth/oauth/google/start?code_challenge=...` and the Discord equivalent begin an administrator OAuth flow bound to the app's PKCE challenge.
- `POST /api/mobile/auth/oauth/exchange` requires both the two-minute grant and the original PKCE verifier. A grant intercepted from the verified App Link cannot be exchanged without that verifier.

The mobile bearer token works with the existing protected admin endpoints; it is not a separate authorization model. Sessions can also be inspected and revoked through `GET /api/sessions`, `DELETE /api/sessions/:sessionId`, and `POST /api/sessions/revoke-others`.

## Versioned tournament and match endpoints

- `GET /api/v1/home` returns the 15-second public homepage feed.
- `GET /api/v1/tournaments/:slug`, `/bracket`, and `/matches` return slim tournament data plus the authoritative linked-or-native bracket and normalized schedule.
- `GET /api/v1/matches` supports `page`, `pageSize`, `status`, `from`, and `to` filters.
- `GET /api/v1/matches/next?scope=public|me` returns the next relevant fixture. The `me` scope requires a session.
- `GET /api/v1/events?topics=matches,brackets` is an optional SSE invalidation stream with heartbeat and reconnect guidance. It is disabled by default and enforces total and per-IP connection caps when enabled. Clients refetch JSON rather than treating events as match state.

Tournament administrators and referees can use `/api/v1/admin/tournaments/:id/matches`. Super admins manage `/staff` assignments. Challonge configuration, manual sync, sanitized logs, and confirmed participant mapping are under `/api/v1/admin/tournaments/:id/challonge`. Complete contracts are published by `/api/openapi.json`.

### Valorant veto rooms

- `GET /api/v1/veto-rooms/:code` returns the authorized room snapshot. Private role links send their fragment token through `X-Veto-Token`; signed captains and staff use their normal session.
- `POST /api/v1/veto-rooms/:code/ready`, `/toss`, `/team-a`, and `/actions` require `expectedRevision`. Stale or simultaneous changes return `409` and clients refetch the room.
- Code routes carry route-level defence in depth before the room is loaded: a code outside `[A-Za-z0-9_-]{1,64}` returns the usual `404`, and a `POST` with neither a session nor `X-Veto-Token` returns `401`. `veto.service` access resolution stays authoritative for every credential-bearing caller.
- `GET /api/v1/veto-rooms/mine` lists rooms where the signed-in user is the registered captain.
- `/api/v1/admin/veto/catalog` exposes maps, versioned pools, rule presets, and reusable room templates. Staff room creation and lifecycle controls are under `/api/v1/admin/veto-rooms`.
- `PATCH /api/v1/admin/veto/maps/:id` accepts `{ "isActive": boolean }`, is admin-only, and changes the map pool used for future room setup only. It is the map availability endpoint; disabling a map does not modify an active room.
- Access to an eligible Valorant match room idempotently provisions its linked `open` Premier veto room. The Premier sequence is Team A ban, Team B ban, Team A ban, Team B ban, Team A ban, Team B ban, followed by automatic locking of the sole remaining map. Premier has no Attack/Defense or other side-selection step.
- `VetoMap.artworkUrl` is optional. At room creation, `VetoRoom.configSnapshot.maps` freezes each map's metadata, so later catalog availability changes cannot rewrite an active room snapshot.
- Digital toss results are generated and persisted by the backend. Map availability, turn ownership, automatic deciders, side selection where applicable to legacy formats, rewinds, timers, and completion are server-authoritative.
- Access-link rotation returns the new plaintext token once; only its SHA-256 hash is stored. Veto endpoints are `no-store`, role links expire seven days after completion by default, and realtime events contain only the room code, revision, and status.

#### Map artwork policy

Riot references for policy and VALORANT documentation are [Riot's General Policies](https://developer.riotgames.com/policies/general) and the [VALORANT developer documentation](https://developer.riotgames.com/docs/valorant). The community research reference consulted for map metadata is [valorant-api.com/v1/maps](https://valorant-api.com/v1/maps), not a Riot release catalog. Release-specific and community URLs are research references only and are not production hotlink sources.

Production uses approved, project-hosted map assets only. `artworkUrl` therefore remains optional until an asset has approval and is hosted by the project; when no approved asset exists, the accent-gradient fallback is intentional.

### Match rooms and notifications

- `GET /api/v1/match-rooms/mine` lists profile-linked rooms for accepted roster members, captains, and staff. `GET /api/v1/match-rooms/:code` requires the same account membership; shareable URLs never grant chat access by themselves.
- Room chat uses cursor pagination, a five-message-per-ten-second limit, one read cursor per member, staff announcements, audited hiding, timed mutes, and chat locking. Completed, cancelled, and walkover rooms are read-only.
- Captains control the embedded veto. Other accepted roster members receive viewer access, while assigned tournament staff retain veto and moderation controls.
- Match support is visible to the opener, both captains, and authorized staff. Staff replies and resolution are available from the website and Android admin client.
- `GET /api/v1/notifications` powers the notification bell. Match creation, rescheduling, status changes, veto turns, official messages, and support replies are deduplicated by event key. Routine match events never enqueue email.
- Browser push is opt-in and activates when `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY` are configured. Invalid subscriptions are revoked automatically.
- Private SSE topics are authorized per connection: `user:{userId}` must match the session, and `match-room:{code}` requires room membership.

Database retention can be inspected with `npm run data:hygiene` and applied only after a verified backup with `npm run data:hygiene:apply`. Eligible active rooms can be previewed and backfilled with `data:backfill-match-rooms` and `data:backfill-match-rooms:apply`. Typing, presence, duplicate veto history, and per-message read receipts are never persisted.

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
- A correctly formed native bearer credential without a session cookie bypasses browser-only Origin/CSRF enforcement. Cookie-bearing requests never receive this exemption.
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

- Creates a server-side session record after valid credentials.
- Sets an `HttpOnly`, `SameSite=Lax` cookie after a completed login.
- Uses the remember-me TTL when `remember` is truthy.
- Applies account lockout rules after repeated password failures.

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

### Authenticated OAuth account linking

Account linking is a separate flow from OAuth login and uses the canonical
versioned routes below. Every route requires the current session; the callback
does not create, replace, or refresh a session.

- `GET /api/v1/auth/oauth/providers` requires the current session (cookie or
  mobile bearer) and returns `200 { success: true, providers }`, where each
  provider is explicitly `google` or `discord` and has a `linked` boolean.
- `GET /api/v1/auth/oauth/:provider/link` requires the current session and a
  provider path value of `google` or `discord`. It returns `302` with a
  `Location` header and a link-flow `Set-Cookie` header; it never returns a
  session cookie.
- `GET /api/v1/auth/oauth/:provider/link/callback?code=...&state=...` requires
  a `google` or `discord` provider path value, both required query parameters,
  and the current session. It validates the session-bound OAuth state and PKCE
  verifier, derives the provider identity from the provider response, and returns `302` with `Location` and an
  expired link-flow `Set-Cookie` header to
  `/profile?tab=account&oauth=linked` or `/profile?tab=account&oauth=error`.
  An unsupported provider path returns JSON `400`; provider, state, code,
  token-exchange, and ownership failures are represented by that safe `302`
  error redirect.
  The callback never creates, replaces, or refreshes the session cookie.
- `DELETE /api/v1/auth/oauth/:provider` requires the current session and the
  `google|discord` provider path enum. It returns `200 { success: true,
  providers }` with the refreshed list. It rejects a removal that would leave
  the user without a verified password and without another linked provider.

The browser never submits a provider user ID. Provider identities already owned
by another Quest account are rejected with the OAuth conflict error. OAuth
authorization codes, access tokens, provider user IDs, and link state are not
included in the profile redirect or API response. Link callbacks consume their
state and use a link-specific flow cookie; the existing login routes and login
callbacks remain separate.

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

## Authenticated Support Conversations

Support conversations are separate from guest contact submissions and match-room
support requests. Every route below requires the current browser session; the
owner is always taken from that session rather than from a client-supplied user
ID. Responses use the versioned envelope described above, with all timestamps in
ISO-8601 UTC. Subjects are required and limited to 160 characters; message
bodies are required and limited to 2,000 characters.

`limit` defaults to 25. Values are parsed as integers, invalid/empty values use
the default, and valid values are clamped to 1–100. `cursor` must be an
ISO-8601 `updatedAt` value; malformed cursors return `400`. List results are
ordered newest first and return one `nextCursor` when another page exists.

### User routes

- `GET /api/v1/support/conversations` — lists the current user's conversations.
  Optional query parameters are `limit` (1–100, default 25) and `cursor` (an
  ISO-8601 `updatedAt` cursor). `data` is `{ items, nextCursor }`; each item
  includes `id`, `ownerUserId`, `subject`, `status`, `assignedStaffUserId`,
  `createdAt`, `updatedAt`, `resolvedAt`, owner/assigned-staff summaries,
  `lastMessage`, `preview`, and the viewer-specific `unreadCount`.
- `POST /api/v1/support/conversations` — creates a conversation and its first
  message in one transaction. JSON body: `{ "subject": "...", "body": "..." }`.
  Returns `201` with a full conversation in `data`, initially in `OPEN` status.
- `GET /api/v1/support/conversations/:conversationId` — returns an owned
  conversation and its messages in ascending creation order. Access to another
  user's conversation is rejected.
- `POST /api/v1/support/conversations/:conversationId/messages` — adds a user
  reply. JSON body: `{ "body": "..." }`. Returns `201` with
  `{ message, status }` in `data`; a user reply changes the conversation to
  `PENDING_STAFF` and reopens a resolved conversation.
- `PATCH /api/v1/support/conversations/:conversationId/read` — advances the
  authenticated user's conversation read cursor. The JSON body is empty and the
  response data is `{ lastReadAt, unreadCount: 0 }`. Read state is per user and
  does not modify message rows.
- `POST /api/v1/support/conversations/:conversationId/resolve` — resolves an
  owned conversation and sets `resolvedAt`. The `200` response data is the full
  conversation projection with `status: "RESOLVED"` and the persisted
  `resolvedAt` timestamp.
- `POST /api/v1/support/conversations/:conversationId/reopen` — reopens an
  owned conversation, clears `resolvedAt`, and returns the full conversation.
  Users may only perform the explicit resolve/reopen transitions.

### Staff routes

All staff routes require `user.role === "admin"` in addition to authentication.
Staff reads use the authenticated staff ID for their independent unread cursor.

- `GET /api/v1/admin/support/conversations` — lists the staff queue. Optional
  query parameters are `status` (`OPEN`, `PENDING_USER`, `PENDING_STAFF`, or
  `RESOLVED`), `assigned` (`all`, `unassigned`, `assigned`, `mine`, `true`,
  `false`, or a staff user ID), `search`, `limit` (1–100), and `cursor`.
  `assigned=assigned` means any non-null assignee; `mine` means the
  authenticated admin's ID. `search` is a case-insensitive contains search over
  the subject, owner username, or owner email. `data` is
  `{ items, nextCursor }` using the same summary shape as the user list.
- `GET /api/v1/admin/support/conversations/:conversationId` — returns any
  support conversation and all messages for staff review.
- `PATCH /api/v1/admin/support/conversations/:conversationId/read` — marks the
  conversation read for the authenticated admin only. This is the staff-read
  operation documented in OpenAPI as an authenticated `PATCH` with the
  `conversationId` path parameter. The response data is
  `{ lastReadAt, unreadCount: 0 }`; it does not mark the owner's messages read
  and does not affect another admin's cursor.
- `PATCH /api/v1/admin/support/conversations/:conversationId/assignment` —
  assigns or unassigns staff. JSON body:
  `{ "assignedStaffUserId": "staff-user-id" }` or `{ "assignedStaffUserId": null }`.
  The target must be an existing staff user; returns the full conversation.
- `POST /api/v1/admin/support/conversations/:conversationId/messages` — adds
  a staff reply. JSON body: `{ "body": "..." }`. Returns `201` with
  `{ message, status }`; a staff reply changes status to `PENDING_USER`.
- `PATCH /api/v1/admin/support/conversations/:conversationId/status` — changes
  status using JSON body `{ "status": "OPEN|PENDING_USER|PENDING_STAFF|RESOLVED" }`.
  Resolving sets `resolvedAt`; reopening clears it. Returns the full
  conversation.

Unread counts are calculated per viewer from `SupportConversationRead.lastReadAt`:
only messages from another user whose `createdAt` is later than that cursor are
unread. Opening a thread calls the viewer's read endpoint and advances only that
viewer cursor. Resolving, reopening, assigning, or changing status never advances
the cursor, so resolving a conversation does not clear unread messages.

Messages are committed before notification, realtime, or push delivery is
attempted. A user-created message (including a user reply) notifies the assigned
staff member and all other admin recipients with action URL
`/admin/support?conversationId=:id`; a staff reply notifies the conversation
owner with action URL `/support/:id`. The action URL is persisted in the
`support_message` notification and is also the URL used by optional browser push.
New messages publish private realtime updates to each recipient's `user:{userId}`
topic. Read marking, assignment, resolve, reopen, and status-only updates do not
create support-message notifications or realtime message events. Push is opt-in
when `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY` are configured; push and
realtime failures are best effort and never turn a persisted message into a
failed request. Support messages do not send email.

Validation failures, including invalid status, missing body/subject, malformed
cursor, or invalid assignment, return `400`. Missing authentication returns
`401`; a non-admin attempting a staff route returns `403`; an authenticated user
requesting another owner's conversation returns `403`; and a staff request for a
missing conversation or assignee returns `404`. These authorization rules are
enforced by the backend rather than by frontend controls.

## Public Tournament Endpoints

### Quest Ascension events

Quest Ascension treats an `EventSeries` row as the public event identity. A
`Tournament.seriesId` is nullable, so existing standalone tournaments remain
valid; when present, the relation groups that tournament under the event. The
legacy `/event-series` endpoints and the event aliases below read the same
model and return equivalent public data.

Public event endpoints do not require authentication:

- `GET /api/events` — lists published events and their published child
  tournaments.
- `GET /api/events/:slug` — returns one published event, its ordered published
  child tournaments, aggregate registration data, and a safe public ticket
  event projection when one is linked.
- `GET /api/event-series` and `GET /api/event-series/:slug` — compatibility
  aliases for the same public event-series data.

The event response envelope is `{ success: true, events: [...] }` for the
list and `{ success: true, event: {...} }` for the detail route. A safe detail
response has this shape (fields not shown on a child are available from the
normal public tournament endpoint):

```json
{
  "success": true,
  "event": {
    "id": "event-uuid",
    "slug": "quest-ascension",
    "title": "Quest Ascension",
    "description": "A multi-game event",
    "shortName": "QA",
    "subtitle": "Rise together",
    "shortDescription": "A multi-game esports event",
    "heroUrl": "/api/uploads/tournament-banners/hero.webp",
    "bannerUrl": "/api/uploads/tournament-banners/banner.webp",
    "startDate": "2026-09-01T09:00:00.000Z",
    "endDate": "2026-09-03T18:00:00.000Z",
    "venue": "Colombo",
    "location": "Sri Lanka",
    "eventStatus": "open",
    "aggregate": {
      "games": 2,
      "teamsRegistered": 12,
      "playersRegistered": 60,
      "availableSlots": 20,
      "registrationState": "open"
    },
    "tournaments": [
      {
        "id": "tournament-uuid",
        "slug": "quest-ascension-valorant",
        "title": "Quest Ascension Valorant",
        "game": "valorant",
        "series": { "id": "event-uuid", "slug": "quest-ascension", "title": "Quest Ascension" },
        "status": "registration_open",
        "isPublished": true,
        "startDate": "2026-09-01T09:00:00.000Z",
        "startDateStatus": "scheduled",
        "maxTeams": 16,
        "registrationCount": 8,
        "capacityUsed": 8,
        "registrationState": "registration_open",
        "isRegistrationOpen": true,
        "isSlotsFull": false,
        "bannerUrl": "/api/uploads/tournament-banners/valorant.webp"
      }
    ],
    "ticketEvent": null
  }
}
```

Public event payloads intentionally contain no captain names or contact
details, payment records or provider data, private payment instructions,
admin holds, admin notes, roster members, or unpublished child tournaments.
The event aggregate is a count projection, not a registration export. Public
event requests are cached; do not use the cache as an authorization boundary.
An unknown public slug returns `404` using the common error envelope. Admin
event requests return `401` for a missing/invalid session and `403` for a
non-admin session; validation failures return `400`, missing event/tournament
resources return `404`, and conflicting links, capacity, or waitlist actions
return `409`, all as `{ success: false, message, details? }`.

### Event aggregate definitions

- `games` is the number of visible child tournaments (`isPublished = true` for
  public reads; drafts are included only in admin reads).
- `teamsRegistered` counts active registrations across those children. Active
  means status is not `rejected` or `waitlisted` and payment is `paid`, or is
  `pending` with an unexpired reservation.
- `playersRegistered` counts active `CAPTAIN`, `PLAYER`, and `SUBSTITUTE`
  registration members; coaches are excluded.
- `availableSlots` is the sum of each child's non-negative
  `maxTeams - capacityUsed`. Capacity includes active registrations and admin
  slot holds, less active registrations already covered by a hold.
- `registrationState` is `open` when any child is currently open and has
  capacity, `completed` when every child is completed or past its end date,
  `upcoming` when a child is upcoming or has a future opening/start, and
  `closed` otherwise. An event's `registrationStatusOverride`, when set by an
  admin, is the displayed aggregate state.

These definitions are shared by the public event page and the admin event
dashboard. They deliberately do not count waitlisted rows as teams or used
capacity.

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
- `DELETE /api/images/:imageId`
- `GET /api/admin/media/files`
- `POST /api/posters`
- `DELETE /api/posters/:posterId`

### `POST /api/images`

Admin-only multipart upload.

Fields:

- `title`
- `description`
- `category`
- `images[]`

### `GET /api/admin/media/files`

Admin-only read-only listing of allowlisted public upload folders. Supports `page`, `pageSize`, `search`, and `directory`. The response includes `totalBytes`, the combined size of every file matching the current search and directory filters before pagination. It never traverses arbitrary paths or includes private payment evidence.

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
- `GET /api/orders/status` with `X-Order-Token: <private capability>`

Quotes recompute prices, stock, currency, delivery fee, and total on the server. Orders accept guest or signed-in customer/delivery details, reserve tracked inventory for `SHOP_ORDER_RESERVATION_MINUTES`, reject mixed currencies/non-LKR products, and require the client's expected total/currency to match the server quote. Creating an order requires PayHere configuration.

The public token is an order-access credential and must not be logged or shared. Links keep it in the browser fragment (`/shop/order#token=...`), which is not sent in the HTTP request, and API reads carry it in `X-Order-Token` rather than a path/query. Only the verified provider callback can mark PayHere paid.

### Payment status and callbacks

- `GET /api/payments/:orderId`
- `POST /api/payments/payhere/notify`
- `POST /api/payments/:orderId/bank-transfer-proof`

Payment status requires ownership of the registration/order or the matching merchandise capability in `X-Order-Token`. Order capabilities are never accepted in an API path or query string. The PayHere notification is form-encoded, rate limited, signature/merchant/order/amount/currency validated, idempotent, and authoritative.

Bank-transfer proof upload requires a verified account that owns the registration. Current handling accepts one normalized JPEG, PNG, or WebP image; there is no configuration flag enabling PDF proofs. Proof files are private and are never available through `/api/uploads`.

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

### Events and event-scoped administration

The Quest Ascension event routes are the preferred admin contract. Every route
below requires a valid session with `role === "admin"`:

- `GET /api/admin/events` — lists draft and published events, child tournament
  summaries, and the aggregate projection.
- `GET /api/admin/events/:eventId/registrations` — lists only registrations
  whose tournament has that event's `seriesId`.
- `POST /api/admin/events` — creates an event identity.
- `PATCH /api/admin/events/:eventId` — updates event identity and publication
  fields.
- `POST /api/admin/events/:eventId/archive` — unpublishes the event without
  deleting its child tournaments or registrations.
- `POST /api/admin/events/:eventId/tournaments` — creates a child tournament
  with the event forced as its `seriesId`, or attaches an existing tournament
  when the multipart body contains `tournamentId` (and optionally
  `seriesOrder`).

Create and update event requests are `multipart/form-data`. Required fields are
`title`, `slug`, and `description`; optional fields include `shortName`,
`subtitle`, `shortDescription`, `startDate`, `endDate`, `registrationOpenAt`,
`registrationCloseAt`, `venue`, `location`, `country`, `organizer`,
`websiteUrl`, `discordUrl`, `registrationStatusOverride`, `displayOrder`,
`featured`, and `isPublished`. The file fields are `heroImage` and
`bannerImage`; updates also accept `removeHeroImage` and `removeBannerImage`.
Invalid dates, URLs, duplicate slugs, and missing required identity fields
return the common error envelope.

An event registration list accepts `page`, `pageSize`, `search`, `tournament`,
`game`, `status`, `paymentStatus`, and `verificationStatus`. Its summaries
contain only the event-scoped tournament, team/display name, statuses,
waitlist position, public reference, created time, captain name/email,
optional coach name/Game ID, and member count. Payment evidence, payment
objects, private admin holds/notes, and private upload names are excluded.
The full registration detail remains available through the existing admin
registration endpoint after an administrator selects a row.

The shared registration status endpoint accepts `waitlisted` in addition to
`pending`, `approved`, and `rejected`. A waitlist promotion is serialized: only
the first waitlisted registration may move to `pending` or `approved`, and only
when a real slot is available. Promotion assigns the lowest available slot,
clears the waitlist position, and compacts later positions; a free tournament
can become paid/approved, while paid approval still requires provider-confirmed
payment. Rejecting a waitlisted row removes it and compacts the queue. A full
tournament exposes `waitlist_open` only when `waitlistEnabled` is true.

Registration public references are opaque `QES-...` identifiers. They are
useful for support and exports but do not authorize access to a registration.

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

## VALORANT Admin Endpoints

Quest admin routes for the VALORANT platform integration. Every route lives under `/api/v1/admin/valorant/*`, requires a valid session with `role === "admin"` (`requireAdmin` mounted via `router.use("/admin/valorant", requireAdmin)`), and proxies to the VALORANT FastAPI service over the internal network. Quest never exposes the VALORANT service directly to browsers; FastAPI is authoritative for canonical matches, series correctness/finalization, rating events, and rankings. Spec: `docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` §6.2–§6.5, §8.3, §9.2.

### Route table (spec §6.2)

| Method | Quest route | Backing FastAPI call |
|---|---|---|
| `GET` | `/api/v1/admin/valorant/teams` | `GET /api/v1/teams` + bindings joined |
| `POST` | `/api/v1/admin/valorant/teams/bind` | `POST /api/v1/teams` (create-or-get by `quest_saved_team_id`) |
| `DELETE` | `/api/v1/admin/valorant/teams/{bindingId}/detach` | none (Quest-local status change) |
| `POST` | `/api/v1/admin/valorant/discover` | `POST /api/v1/match-search/two-player` |
| `POST` | `/api/v1/admin/valorant/matches/import` | `POST /api/v1/matches/import` |
| `GET` | `/api/v1/admin/valorant/matches/by-henrik-id/{henrikMatchId}` | `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` |
| `GET` | `/api/v1/admin/valorant/matches` | `GET /api/v1/matches[...]` (list filters) |
| `POST` | `/api/v1/admin/valorant/series` | `POST /api/v1/series` (with `external_quest_series_id` + anchors) |
| `GET` | `/api/v1/admin/valorant/series` | `GET /api/v1/series` |
| `GET` | `/api/v1/admin/valorant/series/{id}` | `GET /api/v1/series/{valorant_series_uuid}` |
| `DELETE` | `/api/v1/admin/valorant/series/{id}` | `DELETE /api/v1/series/{valorant_series_uuid}` (draft only) |
| `POST` | `/api/v1/admin/valorant/series/{id}/games` | `POST /api/v1/series/{valorant_series_uuid}/games` |
| `PUT` | `/api/v1/admin/valorant/series/{id}/games/order` | `PUT /api/v1/series/{valorant_series_uuid}/games/order` (delta D9) |
| `DELETE` | `/api/v1/admin/valorant/series/{id}/games/{gameId}` | `DELETE /api/v1/series/{valorant_series_uuid}/games/{game_id}` |
| `GET` | `/api/v1/admin/valorant/series/{id}/preview` | `GET /api/v1/series/{valorant_series_uuid}/preview` |
| `POST` | `/api/v1/admin/valorant/series/{id}/finalize` | `POST /api/v1/series/{valorant_series_uuid}/finalize` |
| `GET` | `/api/v1/admin/valorant/rankings` | `GET /api/v1/rankings/teams` |
| `GET` | `/api/v1/admin/valorant/teams/{teamId}/rating-history` | `GET /api/v1/teams/{team_id}/rating-history` |
| `GET` | `/api/v1/admin/valorant/teams/{teamId}/series` | `GET /api/v1/teams/{team_id}/series` |
| `GET` | `/api/v1/admin/valorant/reconciliation` | reconciliation queries via FastAPI reads only (§8.3) |

Responses follow the standard envelope `{ success: true, data: <payload>, meta: { serverNow } }`; errors go through `errorHandler` with `body.error.code`.

### Request/response shapes (spec §6.4)

**Discover (`POST /api/v1/admin/valorant/discover`):**

```jsonc
// Request (browser -> Quest)
{
  "playerA": { "name": "TenZ", "tag": "SEN" },
  "playerB": { "name": "Demon1", "tag": "NA" },
  "pageSize": 10,
  "maxPages": 1,
  "map": "Ascent",       // optional, applied locally
  "from": "2026-07-01"   // optional local date filter
}

// Response (Quest -> browser, mapped from FastAPI two-player search; only
// fields the current MatchCandidate actually returns)
{
  "success": true,
  "players": {
    "a": { "id": "...", "puuid": "puuid-a", "name": "TenZ", "tag": "SEN", "affinity": "eu" },
    "b": { "id": "...", "puuid": "puuid-b", "name": "Demon1", "tag": "NA", "affinity": "eu" }
  },
  "candidates": [
    {
      "henrikMatchId": "abcdef0123...",   // text ID; display + import input
      "affinity": "eu",
      "map": "Ascent",
      "startedAt": "2026-08-01T14:30:00Z",
      "mode": "Standard",
      "queue": "unrated",
      "isCompleted": true,
      "redScore": 13, "blueScore": 8,
      "alreadyImported": false,
      "matchId": null          // VAL matches.id UUID when already imported (direct attach); null otherwise
      // NOTE: no winningSide, no roster here — see detail stage
    }
  ],
  "search": { "pagesExamined": 1, "pageSize": 10 }
}
```

**Candidate detail (detail stage; reuses existing FastAPI endpoints):**

```jsonc
// Not imported: POST /api/v1/matches/import
{ "match_id": "abcdef0123...", "affinity": "eu" }          // 201 created=true
// Already imported: GET /api/v1/matches/by-henrik-id/abcdef0123...
// Both return MatchDetailResponse:
{
  "id": "<val-match-uuid>",            // internal VAL match UUID -> "match_id" for attach
  "henrik_match_id": "abcdef0123...",
  "affinity": "eu", "platform": "pc",
  "map_name": "Ascent", "mode": "Standard", "queue": "unrated",
  "started_at": "2026-08-01T14:30:00Z",
  "is_completed": true, "red_score": 13, "blue_score": 8, "winning_side": "red",
  "players": [ { "puuid": "puuid-a", "name": "TenZ", "tag": "SEN", "side": "red",
                 "agent_name": "Jett", "kills": 22, "deaths": 15 }, ... ],
  "raw_payload_available": true
}
```

**Create series (`POST /api/v1/admin/valorant/series`):**

```jsonc
// Request (browser -> Quest)
{
  "bindingTeamAId": "...", "bindingTeamBId": "...",
  "format": "bo3",
  "playedAt": "2026-08-02T18:00:00Z",
  "ratingModePreference": "normal",       // draft preference only; decided at finalize
  "anchorPlayerA": { "name": "TenZ", "tag": "SEN" },   // from discovery inputs
  "anchorPlayerB": { "name": "Demon1", "tag": "NA" }
}
// Quest -> FastAPI POST /api/v1/series
{
  "team_a_id": "<valorant team uuid from binding>",
  "team_b_id": "<valorant team uuid from binding>",
  "format": "bo3",
  "importance": "regular",
  "played_at": "2026-08-02T18:00:00Z",
  "external_quest_series_id": "quest-0000-...",   // == Idempotency-Key
  "anchor_player_a": { "name": "TenZ", "tag": "SEN" },
  "anchor_player_b": { "name": "Demon1", "tag": "NA" }
}
// Response (FastAPI -> Quest, then Quest -> browser with projection)
{ "id": "<valorant-series-uuid>", "status": "draft", "...": "..." }
```

**Attach game (`POST /api/v1/admin/valorant/series/{id}/games`):**

```jsonc
// Request (browser -> Quest)  /  (Quest -> FastAPI POST /series/{uuid}/games)
{
  "gameNumber": 1, "matchId": "<val-match-uuid>", "teamASide": "red"
}
// Response (FastAPI -> Quest, GameView)
{ "id": "<game-id>", "game_number": 1, "match_id": "<val-match-uuid>",
  "map_name": "Ascent", "team_a_side": "red", "team_b_side": "blue",
  "team_a_rounds": 13, "team_b_rounds": 8, "winner_team_id": "<team-uuid>" }
```

**Set game order (`PUT /api/v1/admin/valorant/series/{id}/games/order`) — absolute desired order (delta D9):**

```jsonc
// Request (Quest -> FastAPI PUT /series/{uuid}/games/order)
{ "games": [ { "game_id": "g2-uuid", "game_number": 1 },
             { "game_id": "g1-uuid", "game_number": 2 } ] }
// Response: list of GameView in the new order (204/200)
```

**Finalize (`POST /api/v1/admin/valorant/series/{id}/finalize`):**

```jsonc
// Request (browser -> Quest)
{ "ratingMode": "normal", "officialWinnerTeamId": null, "overrideReason": null }
// Request (Quest -> FastAPI POST /series/{uuid}/finalize)
{ "official_winner_id": null, "override_reason": null, "rating_mode": "normal" }
// Response (FastAPI -> Quest, FinalizeResult; surfaced first-class under `data`)
{ "series_id": "...", "status": "finalized",
  "calculated_winner_id": "...", "official_winner_id": "...",
  "winner_override_reason": null, "rating_mode": "normal",
  "events": [ { "team_id": "...", "elo_before": 1200, "elo_after": 1218,
                "result": "win", "sequence": 1, "calculation_details": { } } ],
  "team_a_current_elo": 1218, "team_b_current_elo": 1180 }
```

### Error mapping (Quest surface → observed FastAPI codes, spec §6.5)

Quest maps FastAPI's actual error codes to admin-friendly messages; "no overlap" is **not** an error — the search returns `candidates: []` with 200.

| FastAPI code (observed) | HTTP | Quest surface |
|---|---|---|
| `ADMIN_AUTH_REQUIRED` | 401 | "VALORANT platform rejected the request (service auth)" |
| `INVALID_REQUEST` | 422 | "Invalid request — check the form values" |
| `INVALID_RIOT_ID` | 422 | "Invalid Riot ID or player identifier" |
| `PLAYER_NOT_FOUND` / `PLAYER_REGION_UNKNOWN` | 404 | "Riot ID could not be resolved" |
| `HENRIK_AUTH_FAILED` | 502 | "VALORANT provider auth failed — contact admin" |
| `HENRIK_RATE_LIMITED` | 429 | "VALORANT provider is rate limited — retry shortly" |
| `HENRIK_UNAVAILABLE` | 503 | "VALORANT platform unavailable — contact admin" |
| `HENRIK_VALIDATION_ERROR` | 422 | "VALORANT provider rejected the search filters" |
| `MATCH_NOT_FOUND` | 404 | "Match not found" |
| `MATCH_NOT_COMPLETED` | 422 | "Match is not completed" |
| `MATCH_ALREADY_ASSIGNED_TO_SERIES` | 409 | "This match is already used in another series" |
| `MATCH_REFRESH_REJECTED` | 409 | "This match cannot be refreshed (finalized series)" |
| `TEAM_NOT_FOUND` | 404 | "VALORANT team not found" (bind/series-create with unknown team) |
| `TEAM_SLUG_TAKEN` | 409 | "Team slug already taken" |
| `SERIES_NOT_FOUND` | 404 | "Series not found" |
| `SERIES_INVALID` | 409/422 | "Series shape is invalid" (409 draft mutations, 422 finalize re-validation) |
| `SERIES_ALREADY_FINALIZED` | 409 | "Series already finalized" (show committed result) |
| `RATING_POLICY_REQUIRED` | 409 | "Choose an explicit rating policy and reason" |
| `INVALID_SIDE_MAPPING` | 400 | "Invalid side mapping" |
| `ANCHOR_MISMATCH` (delta D6) | 409 | "Anchor player not verified on one side of a map — override required" |
| `BACKDATED_SERIES_REJECTED` (delta D8) | 409 | "Cannot rate a series older than the latest rated series" |

Transport-level failures (timeout, connection) are **not** mapped to FastAPI codes — they enter the operation-record reconciliation path (§8).

### Reconciliation (spec §8.3)

`GET /api/v1/admin/valorant/reconciliation` surfaces, via FastAPI reads only (Quest has no direct VALORANT access):

- Quest series with no matching FastAPI series (by `external_quest_series_id` or `valorantSeriesUuid`);
- FastAPI series with no Quest projection (created out-of-band);
- bindings whose VAL team no longer resolves (FastAPI 404);
- match projections whose VAL match no longer exists;
- operations stuck in `in_flight`/`reconciliation_required`.

`quest_valorant_series.status` values: `draft | finalized | orphaned | reconciliation_required`. `finalizing` is a Quest-local transport attempt state on the operation record, not a series status. Admin-triggered actions: re-sync a projection from FastAPI or adopt a FastAPI series into a Quest projection. No destructive cleanup in MVP.

### Audit (spec §9.2)

Every admin VALORANT action writes an `AuditLog` row (`action: valorant.<targetType>`) plus a `QuestValorantOperation` row. The Quest `operationId` is the durable cross-service correlation key; FastAPI's echoed `X-Request-ID` is stored on the operation row as `fastapiRequestId` — never confused with the Quest operation ID. `finalizeSeries` carries `operationId` in the audit `afterData`.

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

### Quest Ascension migration deployment and rollback

The event schema change is additive and is deployed through the committed
Prisma history. Apply `20260817120000_extend_event_series_quest_ascension`
followed by `20260817130000_add_waitlist_position_uniqueness` with the normal
`prisma generate` and `prisma migrate deploy` commands in `backend/`. The first
migration adds nullable event presentation fields, the nullable tournament
relation remains intact, adds `waitlisted`, waitlist metadata, and public
references, and creates the supporting indexes. The second normalizes stale
waitlist positions and enforces per-tournament uniqueness.

Before a shared deployment, take the approved isolated database/upload backup;
verify migration status, generated Prisma output, the event schema checks, and
the public/admin event smoke paths against a dedicated database. Do not run a
reset or edit an applied migration. No new environment configuration is
required by this feature.

Application rollback may restore the previous code commit and restart the API,
but production migrations are not reversed. Keep the new columns and enum
values backward-compatible with the previous release. If the database itself
must be reverted, stop writes, use the verified isolated backup/restore
procedure, and validate the restored database and both upload roots before
returning traffic; never attempt an ad-hoc `DROP`/down migration in production.

### Manual Quest Ascension documentation checklist

- [ ] Confirm every public and admin event endpoint in `series.routes.js` is
  listed above, including the event-series compatibility aliases.
- [ ] Confirm the admin workflow covers Save Draft → Add Tournament →
  Configure → Publish, existing-tournament linking, archive, and event-scoped
  registration review.
- [ ] Confirm aggregate definitions, nullable `seriesId`/`SetNull`, capacity,
  waitlist promotion, opaque references, privacy exclusions, migration
  deployment, isolated verification, and rollback behavior match the code.
- [ ] Confirm the safe public JSON example contains child summaries and no
  captain, payment, or admin-note fields.
- [ ] Confirm this feature introduces no environment-variable documentation or
  configuration requirement.

## VALORANT Leaderboard (public)

Public, unauthenticated read-only player leaderboard sourced from `valorantsl-new` (the Sri Lankan player leaderboard service). Routes live under `/api/v1/valorant/*`, are cached for 60 seconds, and proxy the `valorantsl-new` anonymous leaderboard API server-to-server. Registration remains in `valorantsl-new` — Quest does not host it. Spec: `docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md` §4.

| Method | Quest route | Backing upstream call |
|---|---|---|
| `GET` | `/api/v1/valorant/leaderboard?page=&per_page=` | `GET /api/v1/leaderboard?page=&per_page=` |
| `GET` | `/api/v1/valorant/leaderboard/search?q=` | `GET /api/v1/leaderboard/search/{discord_username}` |

Responses follow the standard envelope `{ success: true, data: <payload>, meta: { serverNow } }`. The list payload is `{ entries, total, page, perPage, totalPages }`; each entry is `{ puuid, name, tag, discordUsername, currentTier, elo, rankInTier, peakRank, peakSeason, lastPlayed }`. The search payload is `{ entry: <entry | null> }`. When `VALORANT_SL_API_URL` is unset or upstream is unreachable, both routes return `503`.
