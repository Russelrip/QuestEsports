# Teams

## Responsibility

Saved teams, their rosters, and the invitations that fill them. A tournament
roster and a standalone saved team are the same thing here: every team
registration is mirrored into a `SavedTeam` by `syncSavedTeamFromRegistration`,
so `SavedTeamMember` is the one surface an invitation lives on.

## What lives here, and what does not

A saved team is who is on it: role, name, email, and where each invitation
stands. That is all `parseStandaloneMembers` and `parseManagedMembers` read, and
all a new row is written with.

Everything else about a player belongs to that player's account and arrives when
they accept. A captain typing a teammate's Discord handle or game id was always
a guess about somebody else's identity — it could say anything at all, nobody
but the captain could correct it, and it outlived the event it was collected
for. `attachRosterReadiness` resolves each member to their linked account, or to
an address that account has proven it controls, and shows that account's own
Discord handle instead.

A game identifier is a tournament's question, not a team's. It is asked by the
registration form under that tournament's configured rules, stored on the
`RegistrationMember` row and in the registration's own snapshot, and
`syncSavedTeamFromRegistration` deliberately does not carry it back: the same
roster enters a VALORANT event and then a CS event, and a saved id would arrive
as the second form's answer already filled in, from a different game, hoping
somebody noticed. A wrong value you have to spot is worse than a blank field you
have to fill.

`phone`, `discord` and `riotId` remain readable on `SavedTeamMember` for teams
that already carry them, and `updateSavedTeam` carries them across the
delete-and-recreate so an edit does not silently erase them. Nothing new is ever
written into them.

Historical registration data is never rewritten from here. An approved,
rejected or cancelled registration has had its roster settled; acceptance and
later profile or saved-team edits touch only registrations still open to their
roster.

## What an invitation is

A row, not a message. `SavedTeamMember` (mirrored onto `RegistrationMember`)
carries the invitation, and the invitee finds it by signing in.

It used to be answerable only by presenting a token that was emailed, which made
a roster spot exactly as durable as the delivery — an email that never arrived
was a spot nobody could take, and the captain's only recourse was to send it
again and hope. It also left a credential in an inbox, and in whatever chat the
link was forwarded to.

`invitation.service.js` answers one by the invitee's identity instead: the
account the row is linked to, or an address that account has proven it controls.
An unverified address never matches, because signing up with someone else's
address would otherwise hand over their invitations. No token is minted anywhere,
and `inviteTokenHash` is cleared wherever an old one is still carried.

## The Discord requirement

Accepting requires a connected Discord account, for every roster on Quest.

This was briefly enforced when the captain submitted their roster, over every
member. That could not work: the handles are resolved from the invitees' own
linked accounts, so the captain was refused for a gap only somebody else could
close, and had no way to close it on their behalf. It lives on accepting now,
where the person being asked is the person who can act. The captain's own link
is still required at submission — by `attachConnectedDiscordIdentities`, for
every tournament — because that one they can fix.

Declining never asks for it. Someone who does not want the spot should not have
to connect an account in order to say so.

`tournaments.discordRequired` no longer blocks a submission. It remains as the
event's declaration, and the readiness endpoint still reports it, but the rule it
described is now enforced universally at acceptance.

## Expiry

`TeamMemberInviteStatus.expired` is a state. It used to be the absence of a
usable token: data hygiene cleared the token and timestamps on a pending
invitation past its deadline and left the row `pending`, which read correctly
only because responding required the token. With responding keyed on identity
there is no longer a credential whose disappearance enforces the deadline, so
hygiene writes the state instead and keeps the timestamps, which is also what
lets a captain see when an invitation ran out rather than only that it did.

A captain may reopen `pending`, `declined` and `expired`. Not `accepted`: that
spot is taken, and a reminder must not be able to unseat someone who said yes.

## Notices

`invite-notice.service.js` tells an invitee their invitation is waiting, over
channels that cost nothing: an in-app notification with a web push, and a Discord
DM. Nothing here is load-bearing — the invitation is already written down — so
every channel is best effort and `sendTeamInvites` swallows its own failures
rather than rolling back a team that was created successfully.

What it will not do is claim to have reached somebody it did not. `notifyInvite`
reports each channel's outcome and whether the invitee has a Quest account at
all, and `nudgeTeamInvite` passes that back to the captain, who is the remaining
channel: they are teammates and already have a way to talk. The captain-side
roster carries the same answer per member as `hasQuestAccount` / `hasDiscord`,
because a roster that will not confirm is otherwise a mystery to the only person
who can chase it.

No invitation email is sent. `EMAIL_TEMPLATE_TYPES.teamInvite` is retired and
drains rather than retries — see `lib/mail/mail-budget.js` for what the send
allowance is now reserved for.

## The onboarding link

`invite-paths.js` builds the link a captain copies when nothing reached
somebody: `/team-invite`. It is the same link for everybody.

It named the member once — `?member=<row id>` — which bought a scrolled-to
invitation on arrival. It never granted anything; the invitations were selected
by the signed-in identity either way. What it cost was a message. The reference
names a row, and the row is replaced whenever a captain corrects an email or
removes and re-adds somebody, so an older link resolved to nothing and the page
said the invitation was not for that account and to sign in as someone else —
accusatory, plausible, and sometimes rendered directly above the invitation the
reader had come to accept.

What is left is what was underneath it: sign in, and the invitations addressed
to you are listed. The in-app notification and the Discord DM point at the same
page. Nothing to resolve means nothing to resolve wrongly.

The link still starts at the onboarding page rather than the invitations tab,
because the person who needs it usually has no Quest account yet and the tab
would only bounce them to a login they were given no explanation for.

## Propagation

Answering a `SavedTeamMember` invitation propagates to the `RegistrationMember`
rows it stands for, scoped by registrations whose `status` is still open to their
roster — never by payment. A free registration is stored as `paid` the moment it
is created, because capacity counts paid rows, so a payment-scoped propagation
would have left every free roster stuck at pending no matter who accepted.

`registration-verification.js` holds the one implementation of the recomputation
both sides call, which is what stops "verified" from meaning two slightly
different things depending on who moved last.
