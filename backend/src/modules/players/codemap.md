# backend/src/modules/players/

## Responsibility

Player identity as competitive infrastructure, and the public face of it.

- `discord-identity.service.js` — a player's Discord account: linking,
  reverse lookup by snowflake, and read-through to `OAuthAccount` during the
  expand phase.
- `player-profile.service.js` — the public profile projection served at
  `GET /api/players/:publicId`.

## The projection boundary

`player-profile.service.js` is a **projection, never a model dump**. The
adjacent data is unusually sensitive for a public page: `registration_members`
carries the contact details submitted with a registration, `players` joins
to a `User`, and `game_accounts.external_id` is a PUUID — a stable
cross-service key the audit policy already treats as sensitive.

The rule: a field is included only if it is **already public elsewhere** — a
Riot ID appears on the leaderboard, a team name appears on a bracket. Everything
else is omitted *by construction*, not filtered afterwards. The `select` passed
to Prisma never asks for the sensitive columns, because a projection that
fetches them and strips them later is one careless refactor from leaking.
`tests/player-profile.service.test.js` asserts on the `select` itself for
exactly that reason.

Discord is reported as `discordLinked: true/false`. "Reachable on Discord" is
the useful public fact; the snowflake is not, and it links a Quest player to an
account outside Quest.

## Rules encoded here

- **Unpublished tournaments never appear.** A draft event is staff-only, and
  leaking one through a player's history is a disclosure nobody would think to
  look for.
- **Only `approved` registrations count.** A pending entry is not yet a fact,
  and a rejected one is arguably private.
- **Coaching is not "played".** `PLAYING_ROLES` is captain, player and
  substitute; a coached event is real but does not count as a tournament played.
- **History shows the name committed at the time**, from the
  `RegistrationMember` snapshot, so a later Riot rename cannot rewrite it. A
  NULL snapshot renders as `null` rather than falling back to today's name — it
  honestly means "predates snapshots", not "no account".

## Enumeration

`publicId` is a predictable sequence (`QPID-000001`, `QPID-000002`, …), so the
route is enumerable by design. It is rate limited, but the real defence is the
projection: walking the sequence yields only what a bracket page already shows.
Keep it that way — anything added here is added to every player at once.

## Rankings

`ranking-sync.service.js` refreshes `player_rankings` from the external
leaderboard in ONE pass, not one call per player: the upstream is rate limited,
and a player's POSITION is a property of the board rather than of the player, so
it can only be known by walking the board in order.

Every failure degrades to "keep the previous cache". An unavailable upstream
skips the sync entirely, a player missing from the board is left alone rather
than zeroed, and one failing row does not abandon the rest. A ranking is
decoration on a profile and must never be why a profile fails.

A position read from a partially walked board is stored as NULL. A number that
is quietly wrong is worse than an absent one.

The profile exposes `syncedAt` with every ranking. This cache exists so the page
survives the upstream being unreachable, which makes "possibly stale" the normal
case rather than an error state — a rank rendered without saying when it was
read claims more freshness than it has.

## Not yet here

Team profiles. `SavedTeam` has no public identifier — it is unique per captain
by name, not globally — so a public team URL needs a slug decision (generation,
collisions across captains) that is its own change.
