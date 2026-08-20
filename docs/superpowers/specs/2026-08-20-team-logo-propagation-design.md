# Team Logo Propagation Design

## Goal

When an administrator or team captain replaces or removes a team logo, every
local QuestEsports surface that represents the linked team should use the new
logo (or no logo) without rewriting persisted tournament and match snapshots.

The scope includes the team directory/profile, tournament participants and
results, native brackets, matches, match rooms, local Challonge projections,
and admin registration views. External VALORANT/Riot-owned logo data is out of
scope.

## Current boundaries

`SavedTeam.logoName` and `TeamRegistration.teamLogoName` are separate persisted
fields. The saved team is the canonical current record; the registration field
is a fallback snapshot for registrations that become unlinked or historical.

Some consumers already prefer the saved-team logo, but use a truthiness fallback
(`savedTeam.logoName || teamLogoName`). That incorrectly resurrects a stale
registration logo after the canonical logo is removed. The captain/profile
mutation also synchronizes only unpaid linked registrations, which leaves paid
registrations stale.

## Design

### Canonical logo resolution

Introduce one shared effective-logo resolver for local consumers:

1. If a registration is linked to a saved team, return `SavedTeam.logoName` as
   authoritative, including `null`.
2. If the registration is unlinked, return its stored
   `TeamRegistration.teamLogoName` snapshot.

Consumers must not use `||` to fall back from a linked saved-team logo to the
registration snapshot. A canonical `null` means the logo was intentionally
removed.

Use this rule in tournament, bracket, match, match-room, Challonge, admin
registration, and directory projections. Existing bracket and match JSON does
not need a logo rewrite because these surfaces have registration/team identity
links from which the current logo can be resolved.

### Mutations and transaction boundaries

For an explicit logo replacement or removal, both mutation paths will update
the canonical and linked fallback fields in one database transaction:

- `SavedTeam.logoName`
- `TeamRegistration.teamLogoName` for every linked registration, paid or unpaid

Name propagation remains separate from logo propagation. Logo-only changes must
not load or rewrite bracket/schedule name data unnecessarily.

Profile edits that do not include a new file or `removeLogo` must omit
`logoName` from the update. This prevents a no-logo edit from restoring a stale
value during a concurrent logo change. Explicit logo mutations must derive the
current value inside the transaction.

### Cache and file lifecycle

After a successful admin or captain logo mutation, invalidate both `tournaments`
and `foundation` cache tags. Failed mutations must not invalidate caches.

Uploaded replacements keep unique filenames so new responses have new immutable
URLs. The old file remains subject to reference-aware cleanup, but deletion
must occur only after the relevant cache/browser grace period and after
rechecking references. This prevents cached responses from pointing at a file
that was deleted immediately after the update.

### External integration policy

Local Challonge-facing projections resolve the canonical local logo and do not
push a logo change to Challonge. VALORANT/Riot upstream `logo_url` remains an
independent integration-owned value; synchronizing it is not part of this
change.

## Error handling

- A failed transaction preserves the previous canonical logo and leaves the
  newly uploaded file eligible for cleanup.
- A successful replacement commits database references before old-file cleanup
  can run.
- A successful removal returns no logo for linked consumers, even when an old
  registration snapshot exists.
- Unlinked historical registrations retain their snapshot logo.

## Verification

Add regression coverage for:

1. The shared resolver: linked/new, linked/removed-with-stale-snapshot, and
   unlinked/snapshot cases.
2. Admin and captain replacement/removal, including paid and unpaid linked
   registrations.
3. Tournament participants/results, generated native brackets, match lists,
   match rooms, Challonge projections, and admin registration projections.
4. Cache invalidation on successful mutations and no invalidation on failure.
5. No-logo profile edits not overwriting explicit concurrent logo changes.
6. Reference-aware delayed cleanup and preservation of unlinked snapshots.

Run the focused backend admin/team service tests, relevant consumer tests, and
the repository's applicable frontend type/lint/build checks.

## Non-goals

- No schema migration.
- No event bus or logo-version subsystem.
- No direct rewriting of bracket, match, room, or Challonge snapshots.
- No synchronization of external VALORANT/Riot logo metadata.
