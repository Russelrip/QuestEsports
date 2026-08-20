# Saved-Team Coach Roles and Tournament Role Separation

## Goal

Persist coaches as first-class saved-team members with the same reusable
identity fields as players, carry saved-team coaches into tournament
registrations, and prevent one person from being both a coach and a player in
the same tournament.

## Current behavior

- `RegistrationMemberRole` already includes `COACH`.
- Saved-team members already accept `COACH` in the managed-team parser, but the
  public saved-team create flow stores every non-captain as `PLAYER`.
- Saved-team members do not persist a phone number, even though registration
  coaches require one.
- Tournament registrations append the coach separately after player/captain
  email uniqueness has been checked.
- Existing registration validation does not compare coach identity with
  captain/player identity, either within one submission or against another
  active registration in the same tournament.

## Design

### Saved-team data model

Add a nullable `phone` field to `SavedTeamMember`. The field is nullable for
backward compatibility and applies to every role, including existing players.
Keep the existing `COACH` enum value and `(teamId, role, memberOrder)` role
position constraint.

Saved-team create/edit payloads will accept `PLAYER`, `SUBSTITUTE`, and
`COACH` roles. Coach members will persist name, email, phone, Discord, and
Riot ID. Existing saved teams and members remain valid without a phone.

### Registration data flow

When a saved team is selected for a team registration, its persisted coach
member is copied into the registration as a `COACH` member with all saved
identity fields. Coaches remain outside active-player and substitute counts.

Existing explicit registration coach input remains supported. If a saved-team
coach is loaded, the form may display and edit it before submission; the
submitted registration is the authoritative snapshot and existing tournament
registrations are not retroactively rewritten.

### Role separation

Role conflicts are scoped to one tournament:

1. Within a submitted registration, a coach cannot share a normalized email or
   normalized Riot ID with the captain, a player, or a substitute.
2. An active registration cannot add a captain/player/substitute whose
   normalized email or Riot ID is already used by a coach in another active
   registration for the same tournament.
3. An active registration cannot add a coach whose normalized email or Riot ID
   is already used by a captain/player/substitute in another active
   registration for the same tournament.
4. Rejected registrations do not block reuse. A person may have a different
   role in a different tournament.

Email comparisons use the existing normalized email representation. Riot ID
comparisons use trimmed, case-insensitive normalized text and ignore blank
values. Error responses identify the conflict as a coach/player role conflict
instead of returning a generic database duplicate message.

### UI and API

- Saved-team create/edit forms expose role selection and coach contact fields.
- Admin saved-team roster displays and edits coach phone, Discord, and Riot ID
  like the corresponding player fields.
- Registration forms load a saved coach and preserve the separate coach section
  so coaches are visibly distinct from the numbered player roster.
- Registration rejection is shown next to the coach/player conflict with an
  actionable message.

## Data migration and compatibility

- Add the nullable `saved_team_members.phone` column through an additive
  migration.
- Do not backfill saved-team coach data from historical registrations
  automatically; those records may represent different captains or teams.
- Do not alter existing tournament registration snapshots.
- Existing saved-team invitations retain their current status when only role
  details are edited.

## Verification

Add coverage for:

- Creating and editing saved-team coaches with all identity fields.
- Loading a saved coach into a registration and persisting it as `COACH`.
- Coach exclusion from active-player and substitute counts.
- Same-registration coach/player conflict by email and Riot ID.
- Same-tournament cross-registration coach/player conflicts.
- Rejected-registration reuse and different-tournament role reuse.
- Backward compatibility for saved members with a null phone.

Run backend unit tests, Prisma migration/schema checks, and the relevant
frontend type/lint/build checks before completion.
