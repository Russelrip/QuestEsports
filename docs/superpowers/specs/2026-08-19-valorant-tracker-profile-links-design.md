# VALORANT Tracker Profile Links

## Scope

Add a Tracker Network profile link to each public VALORANT leaderboard row,
including exact Discord-search results. This phase does not call Tracker's API,
change Quest ranking/stat values, or expose any credentials. Tracker API-backed
rankings and stats remain a later phase gated on approved credentials and a
documented provider contract.

## Design

The existing leaderboard entries already contain a Riot ID as `name` and `tag`.
The frontend will derive the canonical Tracker profile URL from those two
values using a small pure helper:

`https://tracker.gg/valorant/profile/riot/<URL-encoded name#tag>/overview`

The helper will encode the complete Riot ID as one path segment, preventing
special characters in names or tags from changing the destination. The
leaderboard row will render a compact external-link icon adjacent to the player
name. It will open in a new tab with `noopener noreferrer` and an accessible
label identifying the Riot ID and Tracker destination. Existing columns,
search, pagination, and unavailable states remain unchanged.

## Data flow and boundaries

`ValorantPlayerLeaderboardEntry` → frontend URL helper → external Tracker
profile page. No backend route, database field, environment variable, or
upstream request is required. A missing Riot ID is not expected from the current
contract; if either component is empty, the helper returns no link and the row
falls back to the current text-only rendering.

The future API phase must use a server-side provider module with credentials
stored only in backend configuration, caching and rate-limit handling, and a
stable Quest projection. It must not depend on undocumented Tracker endpoints
without approved access.

## Verification

- Unit-test URL construction, including spaces, `#`, unicode, and reserved
  characters.
- Update leaderboard component contract tests to assert the external link,
  target, rel attributes, and accessible label.
- Run the focused frontend tests and the repository's frontend type/lint check
  if available.
