# Tournament Coach Slot Design

## Scope

Add tournament-configurable coach support to the existing Quest Esports team registration flow without creating a parallel registration system or changing competitive roster semantics.

## Existing architecture

- Public registration is rendered by `ConfiguredTournamentRegistrationForm`.
- Registration submission is multipart `POST /api/tournaments/:slug/registrations`.
- `registration.service.js` normalizes and validates the captain and roster, then persists `TeamRegistration` and `RegistrationMember` rows in a serializable transaction.
- `RegistrationMemberRole` already includes `COACH`; saved-team management already supports that role.
- Admin registration corrections use `PATCH /api/admin/team-registrations/:registrationId/roster`.
- Admin details and exports load the shared `TEAM_REGISTRATION_INCLUDE` and map registrations centrally.

## Data model and settings

1. Add `Tournament.allowCoach Boolean @default(false)` and `Tournament.coachRequired Boolean @default(false)` with database defaults/migration.
2. Reject invalid tournament settings where `coachRequired` is true while `allowCoach` is false.
3. Add a nullable `phone` field to `RegistrationMember` for coach contact numbers. Existing rows remain valid.
4. Persist a submitted coach as a `RegistrationMember` with `role: COACH`, separate from the player/substitute UI and payload. Its existing registration relation supplies the tournament/team scope.
5. When coaches are disabled, public submission rejects non-empty coach data and admin correction rejects coach additions. Existing registrations without coach rows remain unchanged.

## Registration flow

- Public tournament data includes both coach settings.
- Team registration renders a separate card after the player roster titled `TEAM COACH — OPTIONAL` when `allowCoach` is true.
- Coach fields use existing registration controls: full name, email, contact number, Discord, and game ID/IGN.
- A completely empty optional coach is omitted. A partially populated coach is invalid. A required coach requires all coach fields.
- Frontend sends coach JSON only when coaches are enabled; backend repeats the setting, shape, length, email, and game-identity validation.
- Coach role is never included in active-player, substitute, min/max roster, numbering, or configured player-field validation.

## Invitations, payment, and eligibility

- Player and substitute invitations continue through the existing saved-team flow.
- A registration coach does not create a player invitation and does not block roster verification or payment availability.
- Verification and pending-invite counts filter to captain/player/substitute members.
- Capacity and approval/rejection behavior remain registration-level behavior and require no new coach status.
- Saved-team synchronization preserves existing coach role support and does not turn the coach into a roster position counted against player limits.

## Admin flow

- Admin details expose a separate Coach section; the numbered roster remains player/captain/substitute-only.
- The existing roster correction endpoint accepts a separate `coach` object or `null`, normalizes it, and upserts/removes the `COACH` member while preserving player validation and saved-team behavior.
- Coach edits do not require a verified Quest player account or player invitation.
- The admin UI supports add, edit, and remove using the existing PATCH flow and styling.

## Lists and exports

- Summary and public registration counts exclude `COACH`.
- Where useful, summaries show a compact coach name/indicator without changing player counts.
- The registration export receives separate Coach Name, Coach Email, Coach Contact, Coach Discord, and Coach Riot ID columns.
- The roster-member export excludes coach rows; coach data cannot occupy a player column.

## Compatibility

- Defaults are false, so existing tournaments do not show a coach section or accept coach data.
- Existing registrations have no coach row and continue through existing validation, approval, payment, and export paths.
- Existing player/substitute rows and saved-team role handling retain their IDs/relations wherever possible.

## Verification

Backend tests will cover default settings, enabled/disabled/optional/required submissions, malformed and partial coaches, count isolation, admin add/edit/remove, legacy registrations, approval behavior, and export columns. Frontend checks will cover conditional rendering, form payload omission, required-field behavior, admin editing, TypeScript, and production build. Regression checks will cover minimum/maximum rosters, substitutes, saved teams, payment gating, and public/admin counts.
