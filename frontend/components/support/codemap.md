# `frontend/components/support/`

Owns the authenticated user's support inbox, conversation list, thread, and composer. Components call the user-scoped support API through `frontend/lib/support.ts`; realtime events only trigger persisted-data reconciliation.
