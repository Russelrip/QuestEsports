# `backend/src/modules/support/`

## Responsibility

Owns the authenticated support-conversation domain. Support conversations are
separate from match-room chat and match-room support requests; later services
and routes will scope user access to the conversation owner and staff access to
the existing admin authorization rules.

## Persistence boundary

Prisma stores conversations, messages, and per-user read cursors. Messages do
not contain message-level read state. The support schema and additive migration
are documented in [`backend/prisma/codemap.md`](../../../prisma/codemap.md).

## Integration flow

The authenticated support routes and controllers delegate all ownership,
validation, persistence, and staff authorization-sensitive operations to the
support service. User routes always pass the authenticated owner ID; admin
queue routes require the existing admin middleware and pass the authenticated
staff ID for read tracking. Public guest contact submissions remain owned by
the contact module and are not converted into support conversations.

The support service persists conversations and messages before invoking the
existing notification and realtime infrastructure.
