# backend/src/modules/games/

## Responsibility

Two related but distinct concerns live here.

`game.service.js` owns **game identity**: the canonical `Game` record and the
alias table that resolves every spelling of a title onto it. Identity only — no
artwork, no ordering, no publication state.

`game-category.service.js` owns **game presentation**: the artwork, logo,
display order and publication flag behind the public game pages. A
`GameCategory` now points at the `Game` it presents through a nullable
`game_id`.

Keeping them apart is deliberate. A title exists whether or not anyone has
uploaded artwork for it, and an unpublished category must not make the title
itself disappear from tournaments or rulebooks.

## Identity and aliases

`Game.slug` carries the same values as the `GameAccountGame` enum, so the enum
and the table agree by construction rather than by convention. Adding a title
stays additive: one row, one enum value, one adapter.

`GameAlias` exists because normalising free text is not enough. "COD Mobile"
normalises to `cod-mobile`, which is not the established public slug `codm` —
without an alias it would spawn a second title for a game that already exists.
Resolution order is always **canonical slug first, then alias**.

`normalizeGameKey` must stay identical to the SQL normaliser in
`prisma/migrations/20260824210000_add_canonical_game/migration.sql`. If they
diverge, rows the migration mapped resolve differently at runtime.
`tests/game.service.test.js` asserts both halves.

`resolveGameId` returns `null` for an unknown title rather than throwing. During
the expand phase callers still have the legacy text column to fall back on, and
a title Quest has not seen before is a reason to review, not to fail a request.

## Data flow

- `GET /api/games` — active titles, cached like the category list.
- `GET /api/admin/games` — includes inactive titles; admin only.

Both are registered in `src/lib/openapi.js`; the suite fails if a mounted route
is undocumented.

## Migration state

`game_id` is nullable everywhere and no read path depends on it yet. The legacy
`game` text columns are still authoritative. Moving reads across, then dropping
those columns, is the contract step — see `backend/prisma/codemap.md`.
