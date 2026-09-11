# `frontend/app/support/`

Owns the authenticated support inbox route and conversation deep links. Access is enforced by the backend and the client presents a sign-in prompt for guests.

`/support` is the list/no-selection state, `/support/new` explicitly opens the
composer, and `/support/[conversationId]` opens the persisted conversation.
Creation navigates through the Next router with `?sent=1` for a durable receipt.
Guest sign-in links retain the exact inbox/composer/conversation destination.
Support and Contact are exempt from the Discord connection gate so account
linking problems cannot prevent contacting support. Conversation ownership
remains enforced by the support API.
