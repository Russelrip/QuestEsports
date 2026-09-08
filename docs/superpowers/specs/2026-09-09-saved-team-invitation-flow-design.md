# Saved-team invitation flow simplification

## Status

Approved design; implementation pending.

## Problem

Saved teams currently mix generic roster membership with player-specific
contact and game identity fields. The captain-facing flow also contains stale
email-delivery claims, and a player without a Quest account has no reliable
way to find the durable invitation. Authentication redirects can lose the
invitations destination during signup, verification, OAuth, or Discord
linking.

The existing backend already has the important security properties: an
invitation is a durable database row, email delivery is retired, acceptance
requires an authenticated user with a verified matching email and linked
Discord, and concurrent responses are conditionally serialized. The change
must preserve those properties while separating generic saved-team data from
tournament-specific identity data.

## Goals

1. Make saved-team create/edit accept only role, name, and email for each
   member.
2. Keep old optional phone, Discord, and Riot values readable without using
   them as new captain-maintained identity.
3. Link an accepted invitation to the accepting Quest user and use that user
   as the live source for safe account presentation.
4. Keep game IDs out of generic saved teams and pending invitations. Collect
   them only for tournaments whose rules require them, storing them in
   registration-member data and immutable historical snapshots.
5. Provide a member-specific, manually shareable onboarding route that is
   navigation-only and never an acceptance credential.
6. Preserve the full safe internal invitations destination through all
   authentication and account-linking steps.
7. Make delivery status truthful and retain in-app/Discord best-effort
   notifications without adding team-invitation email jobs.
8. Preserve expiration, renewal, acceptance, decline, concurrency, and
   registration-propagation behavior.

## Non-goals

- Restoring or adding team-invitation email.
- Anonymous invitation viewing or acceptance.
- Accepting without verified-email matching.
- Removing the existing Discord requirement for acceptance.
- Automatic Riot, leaderboard, Discord, Steam, or other game-ID lookup.
- Broad deletion of legacy database columns or rewriting historical rows.

## Existing flow and data boundary

Saved-team creation/update writes `SavedTeam` and `SavedTeamMember` rows. New
non-captain members are pending invitations with a 72-hour expiry. Notices
are best effort and may create an in-app notification or attempt a Discord
DM; the invitation row does not depend on either channel. The retired
`teamInvite` mail type must remain drained/disabled.

Invitation listing and response are identity-based. The backend matches a
linked user or the authenticated user's verified normalized email. Acceptance
requires linked Discord; decline does not. The service atomically consumes a
pending invitation and propagates only to open registration-member records.

The live boundary is:

- **Saved team:** role, captain-entered pending name/email, linked Quest user,
  invitation lifecycle, and safe general account presentation.
- **Tournament registration:** tournament-specific game identifier entered by
  the authenticated captain, validation for that tournament's configured
  game/rules, and registration-member data.
- **Historical registration snapshot:** immutable evidence of the identifier
  submitted/committed for that registration. Acceptance or later profile and
  saved-team edits must not rewrite approved, rejected, cancelled, or otherwise
  historical snapshots.

Existing legacy fields remain readable for compatibility. New saved-team
writes do not populate phone, Discord, Riot, or other game-ID fields, and
acceptance does not synchronize game identities into generic roster rows.

## Onboarding link and security model

The captain's copy action produces a route such as:

```text
/team-invite?member=<non-secret-member-reference>
```

The reference is a routing hint only. It is not accepted by any anonymous
endpoint as authority, is not an email credential, and is not sufficient to
read private invitation data. The signed-out page renders only generic
onboarding instructions with Sign in and Create account actions. It does not
resolve or display team, captain, player, or email details anonymously.

The reference is carried through a validated internal redirect to:

```text
/profile?tab=invitations&member=<reference>
```

After authentication, the backend remains the source of truth. It uses the
authenticated user, verified normalized email, invitation status, and
expiration before returning or responding to an invitation. The UI may use
the reference to focus a returned invitation, but it cannot make a mismatched
or unverified account appear authorized. A mismatch receives a clear generic
message instructing the user to sign in with the exact invited email without
revealing unnecessary private information.

The link may safely be forwarded because possession alone never grants
viewing or acceptance authority. The invitation's email is not placed in the
link. Signup can prefill an email only when that value is already safely
available from the authenticated/local flow; the onboarding reference itself
must not disclose it.

## Authentication continuation

Use the existing safe-redirect normalization for the complete internal
destination. Preserve it through:

- password login;
- password signup;
- email verification and the required post-verification login;
- Google and Discord OAuth;
- Discord account linking.

Only path-only, same-origin Quest destinations are accepted. External URLs,
protocol-relative URLs, encoded separators, and unsafe fallback values remain
rejected. Successful authentication returns directly to the Invitations tab,
not the generic profile dashboard.

## Captain and player behavior

Captain roster rows show account and delivery state based on actual outcomes:

- A Quest-account member may be reminded through in-app/Discord channels and
  may have a copied onboarding link.
- A member without a Quest account is explicitly shown as having no account
  and gets a Copy onboarding link action.
- “Invitation sent” is rendered only when a real notification channel
  succeeded. Copying a link is never reported as delivery.
- Renewal reopens the pending 72-hour window for eligible states, preserves
  the no-email contract, and makes an old navigation link lead to the current
  invitation flow without granting authority.
- Captains and players can see that an invitation expired; expired invitations
  cannot be accepted and direct the player to ask the captain to renew.

Players opening the route while signed out see generic onboarding text, Sign
in, and Create account. The flow explains that the exact assigned email is
required. After authentication, an unverified matching account is sent to
verification, a verified matching account can view the invitation, and a
different verified email receives an explicit mismatch state. Discord linking
preserves the invitation destination; declining remains available without
Discord.

## Implementation units

### Backend

- Tighten saved-team request validation/mapping to role, name, and email while
  retaining tolerant legacy reads.
- Ensure acceptance links the saved member to the accepting user and maps
  live safe presentation from that user without trusting captain-entered
  Discord/Riot identity.
- Add/adjust member-reference navigation metadata and authenticated mismatch
  handling without an anonymous private-data endpoint.
- Keep notice delivery best effort and expose explicit channel/account results
  to the captain; never enqueue `teamInvite` mail.
- Preserve conditional invitation response, expiry, renewal, Discord gate, and
  open-registration-only propagation.
- Keep registration game-ID validation and persistence tournament-scoped and
  snapshot-safe.

### Frontend

- Remove phone, Discord, Riot/IGN, and other game-specific inputs from generic
  saved-team create/edit forms.
- Keep tournament registration identifiers in the tournament-specific form,
  shown only when the configured game/rules require them.
- Replace stale email claims in registration, profile, notices, privacy copy,
  README, and documentation.
- Add the safe onboarding route/page and member-specific copy action.
- Preserve the invitations redirect through login, signup, verification, OAuth,
  and Discord linking.
- Render account mismatch, unverified, expired, no-account, delivery, and
  Discord-required states accurately.

### Persistence and documentation

No destructive legacy-column migration is required. Additive schema changes
are permitted only if the existing public member-reference model cannot be
used safely as a navigation hint. Any migration must be nullable/additive and
must not rewrite historical roster or registration data. Update the teams
codemap to state the live-versus-historical boundary if the implementation
changes that data flow; update the Prisma codemap only if a migration is
actually added.

## Verification requirements

Focused tests must cover:

1. Saved-team create/edit accepts only role, name, and email.
2. Legacy optional values still load and do not become required writes.
3. No captain-maintained Discord/Riot identity is copied on acceptance.
4. No-account invitations persist and show no false delivery status.
5. Copy links are member-specific navigation hints, not anonymous authority.
6. Signed-out links preserve the invitations destination through login,
   signup, verification, OAuth, and Discord linking.
7. Signup/email continuation preserves the safe destination where applicable.
8. Matching verified users can view/accept; unverified and mismatched users
   cannot accept and receive useful messages.
9. Discord is required for acceptance but not decline.
10. Expiry blocks acceptance; renewal reopens 72 hours without email.
11. Create, renew, and accept never enqueue a team-invitation email while
    account verification, password reset, and email-change mail remain intact.
12. Acceptance updates only appropriate open registration members.
13. Historical registration identifiers and snapshots remain unchanged.
14. Saved teams can be reused across games, and only tournament rules request
    game identifiers.
15. No automatic game-ID lookup is introduced.

Run backend unit/integration tests, frontend unit/e2e tests, TypeScript type
checking, linting, and focused auth-redirect/invitation acceptance tests.
