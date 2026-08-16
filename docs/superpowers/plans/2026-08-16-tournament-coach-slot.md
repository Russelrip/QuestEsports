# Tournament Coach Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tournament-configurable, logically separate coach registration support across public registration, persistence, admin editing, counts, and exports without changing player roster semantics.

**Architecture:** Reuse the existing `RegistrationMember` table and already-defined `COACH` role. Add `allowCoach`/`coachRequired` tournament settings and a nullable member `phone`; keep coach state/payload/admin controls separate while filtering `COACH` from every player-only calculation and invitation/payment gate.

**Tech Stack:** Next.js 16, React 19, TypeScript, Express 5, Prisma 6, PostgreSQL, Node test runner, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-08-16-tournament-coach-slot-design.md`

## Global Constraints

- Defaults are false, so existing tournaments do not show a coach section or accept coach data.
- Coach data persists as `RegistrationMember` with `role: COACH`; do not create a parallel registration system.
- Coach data does not affect maximum/minimum player counts, substitutes, numbering, invitations/payment gating, eligibility, approval calculations, or player-count displays.
- Existing registrations without coach rows must continue to work without a data migration/backfill.
- Public and admin backend validation is authoritative; frontend validation is only an additional user experience.
- Follow existing Quest Esports styling and existing admin endpoint/UI patterns; do not redesign surrounding pages.

## File Map

- `backend/prisma/schema.prisma` and a new Prisma migration: persist tournament flags and nullable registration-member phone.
- `backend/src/modules/tournaments/tournament.service.js`: normalize/save settings and expose them in public/admin tournament responses.
- `backend/src/modules/tournaments/registration.service.js`: normalize, validate, persist, and re-submit coach data while excluding it from roster gates.
- `backend/src/modules/teams/team.service.js`: keep saved-team synchronization and verification/invite behavior coach-safe.
- `backend/src/modules/admin/admin.service.js` and `admin.controller.js`: map coach data, support separate coach roster corrections, counts, and export columns.
- `backend/tests/registration*.test.js`, `admin.service.test.js`, and `team.service.test.js`: regression and behavior coverage.
- `frontend/lib/tournaments.ts`, `frontend/lib/admin.ts`, and `tournament-editor-model.ts`: shared API/form types and settings serialization.
- `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx`: conditional coach state, fields, payload, and client validation.
- `frontend/components/admin/TournamentEditor.tsx` and `AdminRegistrationsManager.tsx`: settings and registration admin UI.

---

### Task 1: Persist and expose tournament coach settings

**Files:**
- Modify: `backend/prisma/schema.prisma:575-578,1218-1245`
- Create: `backend/prisma/migrations/20260816130000_add_tournament_coach_settings/migration.sql`
- Modify: `backend/src/modules/tournaments/tournament.service.js:mapTournament, normalizeTournamentInput`
- Modify: `backend/tests/registration-configuration.test.js` and `backend/tests/tournament.service.test.js`
- Modify: `frontend/lib/tournaments.ts:227-232`
- Modify: `frontend/lib/admin.ts:TournamentFormValues` and `buildTournamentFormData`
- Modify: `frontend/components/admin/tournament-editor-model.ts:19-86`
- Modify: `frontend/components/admin/TournamentEditor.tsx:316-409`

**Interfaces:**
- Produces `Tournament.allowCoach: boolean` and `Tournament.coachRequired: boolean` for public and admin consumers.
- Produces `TournamentFormValues.allowCoach: boolean` and `TournamentFormValues.coachRequired: boolean` in the existing multipart editor submission.
- Database defaults are `allow_coach = false`, `coach_required = false`, and `RegistrationMember.phone` is nullable.

- [ ] **Step 1: Write failing backend settings tests.** Assert normalized input defaults missing flags to false, accepts true/false values, rejects `coachRequired=true` with `allowCoach=false`, and maps both flags in public tournament output.
- [ ] **Step 2: Run the focused backend test.**
  ```powershell
  npm test -- --test-name-pattern="coach settings"
  ```
  Expected: FAIL because the fields are not yet normalized or mapped.
- [ ] **Step 3: Add the Prisma fields and migration.** Add the two tournament booleans with false defaults and nullable `RegistrationMember.phone`; use the repository’s timestamped SQL migration style and do not backfill existing rows.
- [ ] **Step 4: Implement backend normalization and mapping.** Parse flags using existing boolean helpers, reject the invalid combination, include them in the tournament create/update data, and expose them through the public/admin map functions.
- [ ] **Step 5: Update frontend types/editor state.** Add the fields to `Tournament`, `TournamentFormValues`, initial values, tournament-to-form mapping, and multipart serialization. Add two registration settings checkboxes; disable/reset `coachRequired` when coaches are not allowed.
- [ ] **Step 6: Run settings tests and Prisma generation.**
  ```powershell
  npm run prisma:generate
  npm test -- --test-name-pattern="coach settings"
  ```
  Expected: PASS.

### Task 2: Add coach normalization and persistence to public registration

**Files:**
- Modify: `backend/src/modules/tournaments/registration.service.js:normalizeRegistrationSubmission, createConfiguredRegistration`
- Modify: `backend/src/modules/teams/team.service.js:refreshRegistrationVerificationStatus, syncSavedTeamFromRegistration`
- Modify: `backend/tests/registration.service.test.js`, `registration-configuration.test.js`, and `team.service.test.js`

**Interfaces:**
- Consumes `body.coach` as JSON from multipart requests, with `{ name, email, phone, discord, gameId/riotId }`.
- Produces `submission.coach` as either `null` or normalized `{ name, email, phone, discord, riotId }`.
- Persists `RegistrationMember` rows with `role: COACH`, `memberOrder: 1`, and accepted/no-invite state; player members retain their current invitation state.

- [ ] **Step 1: Write failing normalization tests.** Cover no coach, complete optional coach, partial coach rejection, required coach rejection, disabled tournament rejection, length/email/identity sanitization, and a five-player-plus-coach submission whose player/substitute counts remain valid.
- [ ] **Step 2: Run focused tests and confirm failure.**
  ```powershell
  npm test -- --test-name-pattern="coach|roster count|registration submission"
  ```
- [ ] **Step 3: Add a dedicated coach normalizer.** Parse only one object, normalize text/email, require all coach fields when any field is supplied or `coachRequired` is true, validate max lengths and email, store contact number in `RegistrationMember.phone`, and validate the game identity using the existing game-specific rule.
- [ ] **Step 4: Keep coach out of player validation.** Normalize requested roster members to only `PLAYER` or `SUBSTITUTE`; compute player/substitute counts from those roles; run configured member fields and `validateGameIdentities` only for captain/player/substitute records.
- [ ] **Step 5: Persist coach rows in both create and unpaid-resubmission transactions.** Delete/recreate the one coach row alongside the existing member replacement while preserving player invitation dispatches. If coaches are disabled, reject non-empty coach input before any transaction.
- [ ] **Step 6: Make payment verification coach-safe.** Filter `getRosterVerificationStatus`, pending invite counts, `awaitingTeamVerification`, and `readyForPayment` to non-coach roster members. Keep `COACH` records accepted and do not dispatch invitations for registration coaches.
- [ ] **Step 7: Run registration and team tests.**
  ```powershell
  npm test -- --test-name-pattern="coach|roster count|registration submission|verification"
  ```
  Expected: PASS, including existing invitation and saved-team tests.

### Task 3: Add the public coach section and payload

**Files:**
- Create: `frontend/lib/tournament-coach.ts`
- Modify: `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx:22-120,220-291,494-518`
- Create: `frontend/tests/unit/tournament-coach.test.ts`

**Interfaces:**
- Uses `tournament.allowCoach` and `tournament.coachRequired`.
- Sends `coach` JSON only when `allowCoach` is true and the coach is non-empty.
- Never adds a coach to `members`, `activePlayerCount`, `substituteCount`, or roster member numbering.

- [ ] **Step 1: Add `CoachDraft`, payload, and pure validation helpers in `frontend/lib/tournament-coach.ts`.** The validator returns no issue for an empty optional coach, requires a complete object when any coach field is entered, and requires a complete object when `coachRequired` is true. Export `CoachDraft`, `isCoachEmpty`, and `getCoachValidationMessage` for the component and unit test.
- [ ] **Step 2: Add the helper test and run it.**
  ```powershell
  npm test -- tournament-coach.test.ts
  ```
  Expected: FAIL until the helper exists.
- [ ] **Step 3: Implement coach state and saved-team population.** Initialize empty coach state, populate name/email/Discord/IGN from an existing saved-team `COACH` member when selected, and leave phone empty when the saved-team model has no phone.
- [ ] **Step 4: Render the section after the roster.** Use existing `Card`, `FormField`, and `Input` components; display `TEAM COACH — OPTIONAL` when enabled, show required markers only when required, and include Full Name, Email, Contact Number, Discord Username, and Riot ID/IGN.
- [ ] **Step 5: Update submit validation and FormData.** Block submission on coach validation issues, append `coach` JSON only for enabled/non-empty coach state, and omit it entirely when disabled or empty. Keep all current roster messages and player numbering unchanged.
- [ ] **Step 6: Run frontend checks.**
  ```powershell
  npm run typecheck
  npm test
  ```
  Expected: PASS.

### Task 4: Support admin coach add/edit/remove and separate detail presentation

**Files:**
- Modify: `backend/src/modules/admin/admin.service.js:TEAM_REGISTRATION_INCLUDE, mapTeamRegistration, normalizeAdminRosterMembers, correctTeamRegistrationRoster`
- Modify: `backend/src/modules/admin/admin.controller.js` only if request parsing needs an explicit coach field
- Modify: `backend/tests/admin.service.test.js`
- Modify: `frontend/lib/admin.ts:RegistrationMember, TeamRegistration`
- Modify: `frontend/components/admin/AdminRegistrationsManager.tsx:23-40,405-509,1037-1068`

**Interfaces:**
- PATCH body is `{ members: RosterDraftMember[], coach: CoachDraft | null, syncSavedTeam?: boolean }`.
- Existing callers omitting `coach` preserve the current coach; the admin UI sends `null` to remove it.
- Response includes `registration.coach` as a separate nullable object while `registration.members` contains only captain/player/substitute records for the admin UI.

- [ ] **Step 1: Write failing service tests.** Cover admin add, edit, remove, disabled-tournament rejection, required-coach protection, validation/sanitization, player-count isolation, and legacy registrations with no coach.
- [ ] **Step 2: Run focused admin tests and confirm failure.**
  ```powershell
  npm test -- --test-name-pattern="roster correction|coach"
  ```
- [ ] **Step 3: Extend admin mapping.** Select/map the coach separately, filter `COACH` from the mapped player roster, and make summary `memberCount` count only non-coach members. Expose a compact `coachName` only where the summary query already loads enough data.
- [ ] **Step 4: Normalize the separate coach payload.** Reuse the public coach validation rules, allow no verified account/invitation for a coach, upsert the unique `(registrationId, COACH, 1)` record, and delete it for explicit null. Keep existing captain/player/substitute account and roster validation unchanged.
- [ ] **Step 5: Preserve saved-team behavior.** When synchronization is requested, keep player/substitute structure validation and synchronize the existing coach role without counting it as a competing player. Do not make coach changes alter roster limits.
- [ ] **Step 6: Add admin UI controls.** Keep the existing numbered roster editor untouched; add a separate Coach card with editable fields and Add/Remove actions. Include the coach in the PATCH payload independently and display a separate Coach details section below the roster.
- [ ] **Step 7: Run admin tests and frontend checks.**
  ```powershell
  npm test -- --test-name-pattern="roster correction|coach"
  npm run typecheck
  ```
  Expected: PASS.

### Task 5: Make all counts, public displays, and exports coach-safe

**Files:**
- Modify: `backend/src/modules/admin/admin.service.js:TEAM_REGISTRATION_SUMMARY_SELECT, exportTeamRegistrations`
- Modify: `backend/src/modules/tournaments/tournament.service.js:mapTournamentWithPublicTeams, mapTournamentWithRegistrations`
- Modify: `backend/src/modules/tournaments/bracket.service.js` only if its participant count currently includes coach rows
- Modify: `frontend/components/admin/AdminRegistrationsManager.tsx` list count/indicator rendering
- Modify: `frontend/components/admin/AdminTeamsManager.tsx` only if its tournament registration count is sourced from registration members
- Modify: `backend/tests/admin.service.test.js`, `backend/tests/tournament.service.test.js`, and `backend/tests/bracket.service.test.js`

**Interfaces:**
- Public/admin `memberCount` and `rosterCount` mean competing roster members, never coach rows.
- Excel `Registrations` sheet adds `Coach Name`, `Coach Email`, `Coach Contact`, `Coach Discord`, `Coach Riot ID`.
- Excel `Roster Members` sheet contains only captain/player/substitute rows.

- [ ] **Step 1: Add failing export/count tests.** Construct a registration with five competing members and one coach; assert every count is five, summary/detail exposes coach separately, and workbook sheets contain separate coach columns with no coach roster row.
- [ ] **Step 2: Run the focused tests and confirm failure.**
  ```powershell
  npm test -- --test-name-pattern="export|member count|public teams|coach"
  ```
- [ ] **Step 3: Filter coach rows in public/admin count maps.** Use explicit role filters rather than array length; leave approval/payment/status logic unchanged.
- [ ] **Step 4: Add coach columns and map values in Excel export.** Use the existing `buildExcelWorkbookBuffer` column definitions and blank values for registrations without a coach.
- [ ] **Step 5: Add a compact coach indicator/name to the existing registration list where data is available.** Do not change the roster/player count label or insert coach into the numbered roster table.
- [ ] **Step 6: Run export/count tests.**
  ```powershell
  npm test -- --test-name-pattern="export|member count|public teams|coach"
  ```
  Expected: PASS.

### Task 6: Full regression verification and integration cleanup

**Files:**
- Modify only files required by failing checks; do not perform unrelated refactors.
- Test: all backend/frontend tests, migrations, lint, typecheck, and production build.

- [ ] **Step 1: Generate Prisma client and validate migration state.**
  ```powershell
  npm run prisma:generate
  npm run prisma:migrations:check-pending
  ```
- [ ] **Step 2: Run the complete backend test/lint suite.**
  ```powershell
  npm test
  npm run lint
  ```
- [ ] **Step 3: Run the complete frontend suite.**
  ```powershell
  npm test
  npm run typecheck
  npm run lint
  npm run build
  ```
- [ ] **Step 4: Exercise the required scenarios against the focused tests or local flow.** Verify: five players with/without coach, minimum roster plus coach, disabled/optional/required settings, missing required coach, admin add/edit/remove, legacy registration, counts, approval/rejection, and export.
- [ ] **Step 5: Inspect the final diff for unrelated changes and generated artifacts.** Confirm only the spec, plan, migration, source, and tests are present; do not commit secrets or build output.
