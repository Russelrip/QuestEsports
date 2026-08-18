# Valorant Support Contact, Messaging, and Account Linking

## Status

Approved design. This document covers the first implementation phase for an
authenticated support inbox and Google/Discord account linking. The existing
public contact form remains available to guests.

## Goals

- Let authenticated users contact SI/admin staff from the website.
- Give staff a queue for replying to, assigning, resolving, and reopening
  support conversations.
- Deliver support messages through the existing persisted notification and
  realtime infrastructure.
- Let users link and unlink their existing Google and Discord OAuth identities
  from account settings.
- Preserve the current public contact-submission flow for unauthenticated
  visitors.

## Non-goals

- Guest-to-inbox conversations or guest conversation claiming.
- External messaging providers such as Discord DMs, email threads, or social
  platform messaging.
- Linking public profile URLs or handles for Twitch, X, YouTube, Instagram,
  or other social platforms.
- Replacing match-room chat or match-room support requests.

## Existing system boundaries

- Authentication and OAuth flows live in `backend/src/modules/auth` and already
  persist provider identities in `OAuthAccount`.
- Public contact submissions live in `backend/src/modules/contact` and are
  managed by existing admin contact-message routes.
- Match-room messaging, support requests, notifications, and realtime delivery
  already exist, but are scoped to match rooms.
- The frontend has authenticated profile settings, an admin area, a contact
  page, a notification bell, and match-room chat components.

The new support domain should reuse authentication, authorization,
notifications, and realtime delivery without making general support a match-room
concept.

## Architecture

Create a dedicated support-conversation subsystem.

### Domain model

Add an additive Prisma migration with the following concepts:

- `SupportConversation`
  - owning user
  - subject
  - status: `OPEN`, `PENDING_USER`, `PENDING_STAFF`, or `RESOLVED`
  - optional assigned admin/staff user
  - created, updated, and resolved timestamps
- `SupportMessage`
  - conversation
  - sender user
  - message body
  - created timestamp
  - no embedded read state; unread state is tracked per user below
- `SupportConversationRead`
  - conversation
  - user
  - `lastReadAt`
  - unique conversation/user pair

Staff access is role-based, so a separate participant table is not required in
v1. The owning user is the only non-staff participant. Store a nullable
`senderUserId` with `onDelete: SetNull`, following the existing
match-room message convention; no sender snapshot is required in v1. The
conversation owner relation should follow the repository's existing user-owned
record deletion convention. `SupportConversationRead` is a read cursor rather
than a participant record, allowing each user to have independent unread state.

### User flow

1. An authenticated user opens the support inbox and creates a conversation
   with a subject and first message.
2. The backend persists the conversation and message in one transaction.
3. Staff see the conversation in the admin support queue and may assign it,
   reply, or change its status.
4. Each new message is persisted before realtime delivery is attempted.
5. The recipient receives a notification record and, where enabled, realtime
   and push updates.
6. Staff resolve the conversation. The user may reopen it by sending a new
   message or using an explicit reopen action.

Realtime delivery is an optimization. Persisted messages and notification
records are the source of truth when a client is offline or delivery fails.

### API boundaries

User-facing endpoints should support:

- list the current user's conversations, including status, preview, and unread
  count
- create a conversation with its initial message
- retrieve a conversation and its messages
- post a message to an owned conversation
- mark messages/conversation read
- resolve or reopen an owned conversation where permitted

Admin endpoints should support:

- list/filter the staff support queue
- retrieve any support conversation
- assign/unassign staff ownership
- post staff replies
- change status and resolve/reopen conversations

Exact route naming should follow the existing versioned route and module
conventions rather than introduce a parallel API style.

## OAuth account linking

Reuse the existing Google and Discord OAuth handlers and `OAuthAccount` model.
Add authenticated link-start and link-callback behavior distinct from login:

- OAuth state and PKCE validation remain mandatory.
- The callback derives the provider identity from the provider response; the
  browser cannot submit a provider ID to link.
- A provider identity already owned by another account is rejected.
- Profile settings display the currently linked providers and expose unlink
  actions.
- Unlinking is rejected when it would leave the user with no verified password
  and no other linked OAuth provider.
- Login behavior remains unchanged for users who do not use the new settings.

The link/unlink operations should use the existing session and auth error
handling conventions and produce security/audit events if the repository's
current audit mechanism supports them.

## Frontend experience

### User support inbox

Add an authenticated support area with:

- conversation list
- unread counts and last-message previews
- status labels
- conversation thread view
- composer with validation, pending, success, and retry/error states
- realtime updates that reconcile against persisted data

The existing contact page should keep its public form and provide an
authenticated-user path into the support inbox.

### Admin support queue

Add an admin route/component set under the existing admin area with:

- unassigned and assigned queue views
- status filters
- assignment control
- conversation thread and reply composer
- resolve/reopen controls

The UI must enforce the same authorization as the backend; hiding controls is
not a security boundary.

### Profile account linking

Add a profile settings section showing Google and Discord link state, link
buttons, unlink buttons, and clear errors for provider conflicts or the
last-login-method constraint.

## Authorization and validation

- Only authenticated users may create or access their support conversations.
- Staff roles may access the staff queue and conversations according to the
  existing admin authorization rules.
- User queries must scope by authenticated user ID; client-supplied owner IDs
  are ignored.
- Subject and body inputs are required, length-limited, and validated using
  existing backend/frontend validation conventions.
- Message creation, notification creation, and status transitions must be
  transactionally consistent where they change persisted state.
- Realtime or push failures must not turn a successfully persisted message into
  a failed request.
- Duplicate-send behavior should be handled by the existing request/retry
  conventions or an idempotency key if the current messaging implementation
  requires one.

## Testing and rollout

Backend tests should cover:

- conversation creation and initial-message transaction behavior
- user ownership and staff authorization
- message validation and status transitions
- read/unread state and notification creation
- assignment and resolve/reopen behavior
- OAuth link, conflict, unlink, and last-login-method rules

Frontend unit tests should cover inbox, thread, composer, admin queue, and
account-linking states. Playwright coverage should exercise the authenticated
user-to-admin conversation flow and mocked OAuth callback/linking behavior.

The Prisma migration must be additive and deploy-safe. Existing contact
submissions, match-room messages, OAuth login, notifications, and profile flows
must continue to work unchanged. Rollout should be staged so the backend schema
and endpoints can deploy before the new frontend routes depend on them.

## Success criteria

- An authenticated user can create, read, reply to, resolve, and reopen a
  support conversation.
- Authorized SI/admin staff can find, assign, reply to, and resolve user
  conversations.
- New messages survive offline/realtime failures and produce correct unread
  notification state.
- Users can safely link/unlink Google and Discord identities without creating
  provider-account collisions or locking themselves out.
- Guests can still submit the existing public contact form.
- Automated tests cover the authorization and account-safety boundaries.
