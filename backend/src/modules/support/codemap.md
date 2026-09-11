# `backend/src/modules/support/`

## Responsibility

Owns the authenticated support-conversation domain. Support conversations are
separate from match-room chat and match-room support requests; later services
and routes will scope user access to the conversation owner and staff access to
the existing admin authorization rules.

## Persistence boundary

Prisma stores conversations, messages, per-user read cursors, and optional
message attachments. Attachment metadata is safe API projection only; stored
filenames remain private to the service. The support schema and additive
migrations are documented in [`backend/prisma/codemap.md`](../../../prisma/codemap.md).

## Integration flow

The authenticated support routes and controllers delegate all ownership,
validation, persistence, and staff authorization-sensitive operations to the
support service. User routes always pass the authenticated owner ID; admin
queue routes require the existing admin middleware and pass the authenticated
staff ID for read tracking. Public guest contact submissions remain owned by
the contact module and are not converted into support conversations.

The support service persists conversations and messages before invoking the
existing notification and realtime infrastructure.

Screenshot uploads are memory-parsed, fully decoded/normalized by Sharp, and
written with server-generated names below the private support upload directory.
Files are compensated on definite pre-commit failures; post-commit notification
or realtime failures never remove committed attachment files. Content downloads
are authenticated and owner-or-admin scoped and are not included in public
upload routes.

`GET /support/unread` returns the authenticated owner's count of conversations
with unread messages across the complete inbox. A parameterized EXISTS query
compares message timestamps to per-user read cursors; it does not use alert
counts, pagination, or workflow status. Deleted senders still count as unread.

User-list cursors include timestamp and ID to avoid dropping conversations
sharing an update timestamp; legacy timestamp-only cursors remain accepted.
The user read endpoint accepts an optional `throughMessageId`, validates that
message in the owned conversation, and monotonically advances the read cursor
to its persisted timestamp. Older clients default to the latest persisted
message. Read responses report remaining unread messages, and the transaction
marks only the authenticated recipient's corresponding displayed-message
notifications read. General notification dismissal does not change support
read cursors. The existing timestamp precision is retained; no schema migration
is introduced by this UX change.

Support alerts use generic reply notices and retain their user/admin deep
links; private message bodies are not copied into new notification/push payloads.
