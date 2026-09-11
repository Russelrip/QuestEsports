# `frontend/components/support/`

Owns the authenticated user's support inbox, conversation list, thread, and composer. Components call the user-scoped support API through `frontend/lib/support.ts`; realtime events only trigger persisted-data reconciliation.

`SupportProvider`, mounted inside AuthProvider, owns the complete-inbox unread
conversation count and memory-only drafts. Its account key discards state on
sign-out/account change. Navbar and UserMenu consume the same badge; failed
refreshes retain the last known count. Read acknowledgements invalidate both
the account badge and NotificationBell through `quest:support-read`.

The inbox groups active/resolved conversations and follows all user-list pages.
Desktop uses a list/detail panel; mobile shows only the list, selected thread,
or explicit new composer. Thread reads acknowledge the last rendered message
only while the document is visible. Background refresh preserves readable
content, and stale account/conversation responses cannot replace current data.

`SupportHelpLink` opens the composer from registration/payment/account errors.
It can seed editable public tournament context in account-scoped memory,
without overwriting an existing draft or putting private data into URLs.
The composer retains drafts on failed sends and in-site navigation, clears on
success or explicit Clear draft, and warns before closing an active draft.

Support messages may include up to three validated image attachments. Files are
kept only in the active composer state; persisted messages render the backend's
authenticated `contentUrl` and never expose upload bytes in drafts or routes.
