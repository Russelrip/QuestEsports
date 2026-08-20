# Saved-Team Coach Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist coach details on saved teams, carry them into registrations, and prevent coach/player identity overlap within the same tournament.

**Architecture:** Extend the existing `SavedTeamMember` model with nullable phone data and use its existing `COACH` role. Keep registration snapshots independent, add a transaction-safe role-conflict check in the tournament registration service, and update the existing saved-team and registration forms rather than introducing a second team system.

**Tech Stack:** Prisma/PostgreSQL, Node.js services and `node:test`, Next.js/React/TypeScript, existing multipart/FormData APIs.

**Spec:** `docs/superpowers/specs/2026-08-19-saved-team-coach-roles-design.md`

## Global Constraints

- Role conflicts are scoped to the same tournament; a person may have a different role in another tournament.
- Coaches remain outside active-player and substitute counts.
- Add the nullable `saved_team_members.phone` column through an additive migration.
- Do not rewrite existing tournament registration snapshots or automatically backfill historical coaches into saved teams.
- Existing saved-team invitations retain their status when role details are edited.
- Use normalized email and trimmed, case-insensitive Riot ID matching; blank Riot IDs do not participate in conflicts.
- Existing `COACH` role support and `(teamId, role, memberOrder)` uniqueness must remain intact.

---

### Task 1: Add saved-team member phone storage

**Files:**
- Modify: `backend/prisma/schema.prisma:1490-1517`
- Create: `backend/prisma/migrations/20260819190000_add_saved_team_member_phone/migration.sql`
- Test/verify: Prisma/schema verification commands

**Interfaces:**
- Produces nullable `SavedTeamMember.phone`, mapped to `phone` in the database.
- Does not change existing role enums, keys, or registration tables.

- [ ] **Step 1: Add the nullable Prisma field**

Add `phone String?` to `SavedTeamMember` beside `emailNormalized` and `discord`, with no default and no uniqueness constraint.

- [ ] **Step 2: Add the additive SQL migration**

Create the migration with:

```sql
ALTER TABLE "saved_team_members"
ADD COLUMN "phone" TEXT;
```

Do not edit an applied migration or reset the database.

- [ ] **Step 3: Validate the schema and migration**

Run from `backend`:

```bash
npx prisma validate
npm run prisma:migrations:check-pending
```

Expected: schema validation succeeds and the new migration is recognized without destructive-reset warnings.

---

### Task 2: Persist coach roles and contact fields in saved teams

**Files:**
- Modify: `backend/src/modules/teams/team.service.js:225-530`
- Modify: `backend/src/modules/admin/admin.service.js:1980-2267`
- Modify: `frontend/lib/teams.ts:7-145`
- Modify: `frontend/components/registration/RegistrationForm.tsx:1-120`
- Modify: `frontend/components/auth/TeamManagementPanel.tsx:22-180`
- Test: `backend/tests/team.service.test.js`

**Interfaces:**
- `SavedTeamMember` API responses expose `phone`.
- Public create/update payload members accept `{ role, name, email, phone?, discord?, riotId? }`.
- Admin saved-team update persists the same fields and preserves existing member IDs/invites.

- [ ] **Step 1: Write failing backend tests for saved coach persistence**

Add tests that create/update a team with one `COACH` member and assert:

```js
assert.equal(createdMembers.find((member) => member.role === "COACH").phone, "0770000000");
assert.equal(updatedMember.role, "COACH");
assert.equal(updatedMember.discord, "coach-discord");
assert.equal(updatedMember.riotId, "CoachName#123");
```

Also assert that editing an existing member keeps its invite status and member ID.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npm test -- tests/team.service.test.js
```

Expected: the new coach phone/role assertions fail before implementation.

- [ ] **Step 3: Extend public member parsing and creation**

Update `parseStandaloneMembers` to accept role, phone, Discord, and Riot ID. Validate role against `PLAYER`, `SUBSTITUTE`, and `COACH`; validate name/email for all roles and length-limit optional phone/Discord/Riot ID. Preserve the captain exclusion and unique normalized-email checks.

When creating `SavedTeamMember` rows, persist the parsed role, phone, Discord, and Riot ID. Continue treating the authenticated owner as the single `CAPTAIN` row.

- [ ] **Step 4: Extend public member update behavior**

Update `parseManagedMembers` and `updateSavedTeam` to persist `phone` for every role. Keep role-specific member ordering and existing invitation fields; do not generate a new invite when an existing member is only edited.

- [ ] **Step 5: Extend admin saved-team mapping and update behavior**

Include `phone` in `mapAdminSavedTeamDetail`, `SAVED_TEAM_MEMBER_SELECT`, and update normalization. Ensure admin updates do not alter linked registration snapshots unless the existing team-name synchronization path already requires it.

- [ ] **Step 6: Update frontend team types and editor**

Add `phone?: string | null` to `SavedTeamMember` and `phone?: string` to managed member inputs. Update `RegistrationForm.tsx` so new saved-team members can choose `PLAYER`, `SUBSTITUTE`, or `COACH` and enter the coach phone, Discord, and Riot ID. Add a phone input to `TeamManagementPanel.tsx`, preserve role selection for coaches, and send phone in the FormData member JSON. Keep the coach visually distinct but use the same editable identity fields as players.

- [ ] **Step 7: Run focused tests and lint**

Run:

```bash
npm test -- tests/team.service.test.js
npm run lint -- --no-warn-ignored
```

Expected: saved-team tests pass and lint reports no new errors.

---

### Task 3: Load saved coaches into tournament registrations

**Files:**
- Modify: `frontend/lib/teams.ts:7-18`
- Modify: `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx:187-216,260-278`
- Modify: `backend/src/modules/teams/team.service.js:1093-1314`
- Test: `backend/tests/registration-configuration.test.js`

**Interfaces:**
- `populateSavedTeam()` maps a saved `COACH` member to the existing coach draft, including phone.
- Registration payload continues to send the coach as a separate `coach` object, while backend persistence stores it as a `COACH` registration member.

- [ ] **Step 1: Add a failing saved-coach hydration test**

Exercise the saved-team mapping with a coach containing phone, Discord, and Riot ID and assert the registration draft receives all three values. Assert the coach is not included in the numbered `members` array.

- [ ] **Step 2: Run the focused registration tests**

Run:

```bash
npm test -- tests/registration-configuration.test.js
```

Expected: the new saved-coach phone assertion fails before implementation.

- [ ] **Step 3: Add phone to the frontend mapping**

Change `SavedTeamMember` and `populateSavedTeam()` so the coach draft receives `phone: savedCoach.phone || ""`. Keep players/substitutes in `members` and the coach in `coach`.

- [ ] **Step 4: Persist coach phone during saved-team synchronization**

Update `syncSavedTeamFromRegistration` so every `SavedTeamMember` create branch writes `phone: member.phone || null`. Preserve `COACH` as `COACH`, carry Discord/Riot ID unchanged, and do not change player counts or invitation semantics.

- [ ] **Step 5: Run registration tests**

Run:

```bash
npm test -- tests/registration-configuration.test.js tests/registration.service.test.js
```

Expected: existing coach-count behavior remains passing and the new hydration test passes.

---

### Task 4: Enforce same-tournament coach/player separation

**Files:**
- Modify: `backend/src/modules/tournaments/registration.service.js:487-604,814-984,1080-1126`
- Create: `backend/src/modules/tournaments/role-conflict.service.js`
- Modify: `backend/src/modules/admin/admin.service.js:841-916,997-1205,1645-1715,1821-1864`
- Modify: `backend/src/modules/payments/payment.service.js:976-1040,1082-1169`
- Modify: `backend/src/modules/tournaments/coach.validation.js:23-38` if identity normalization is shared there
- Test: `backend/tests/registration-configuration.test.js`
- Test: `backend/tests/registration.service.test.js`
- Test: `backend/tests/admin.service.test.js`
- Test: `backend/tests/payment.service.test.js`

**Interfaces:**
- Add an internal helper with this shape:

```js
assertNoCoachPlayerRoleConflict({
  tx,
  tournamentId,
  members,
  excludeRegistrationId = null,
});
```

It throws `HttpError(409, "This person cannot be both a coach and a player in the same tournament.")` on an email or nonblank normalized Riot ID conflict.

- [ ] **Step 1: Add failing local-conflict tests**

Add tests where the submitted coach shares a normalized email or case-insensitive Riot ID with the captain/player. Assert the clear 409 role-conflict message.

- [ ] **Step 2: Add failing cross-registration tests**

Mock active registrations in the same tournament containing a `COACH` member and assert a new player with the same email/Riot ID is rejected. Add the inverse case: an existing player blocks a new coach. Assert a rejected registration does not block reuse and a different tournament does not block reuse.

- [ ] **Step 3: Run the new tests to confirm failure**

Run:

```bash
npm test -- tests/registration-configuration.test.js tests/registration.service.test.js
```

Expected: new role-conflict tests fail before implementation.

- [ ] **Step 4: Implement local role conflict validation**

Build the complete submitted member set, including the captain and normalized coach, before the existing email uniqueness check. Compare coach identity against captain/player/substitute identity by normalized email and case-insensitive trimmed Riot ID. Keep coaches excluded from player/substitute counts.

- [ ] **Step 5: Implement transaction-scoped cross-registration validation**

Move the role identity helper into the shared `role-conflict.service.js` module. Within the existing serializable transactions, load active registrations for the same tournament (excluding the current registration during retries) and their member role/email/Riot ID fields. Compare coach identities to captain/player/substitute identities in both directions before creating/updating the registration. Do not include rejected registrations.

- [ ] **Step 6: Use the same validation in initial, retry, and payment-continuation paths**

Apply the helper before public create/retry/payment paths and before admin Game ID edits, admin roster/coach correction, waitlist promotion/payment override, expired-payment reopening, and late PayHere acceptance. Any path that activates a registration or changes an active member identity must use the same transaction-scoped check.

- [ ] **Step 7: Preserve saved-team phone in admin correction and add mutation-path tests**

When `correctTeamRegistrationRoster` recreates saved-team members, persist `phone: member.phone ?? existingMember?.phone ?? null`. Add tests covering coach and legacy/null-phone preservation, admin identity edits, waitlist/payment transitions, and payment-service reopening/late acceptance conflicts.

- [ ] **Step 8: Run focused and full backend tests**

Run:

```bash
npm test -- tests/registration-configuration.test.js tests/registration.service.test.js
npm test -- tests/admin.service.test.js tests/payment.service.test.js
npm test
```

Expected: all tests pass, including existing coach-count and payment-retry coverage.

---

### Task 5: Improve registration UI conflict handling

**Files:**
- Modify: `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx`
- Modify: `frontend/lib/teams.ts`
- Test/verify: frontend type, lint, and build checks

**Interfaces:**
- The form continues to use the existing `coach` draft and displays the backend role-conflict message without replacing it with a generic registration error.

- [ ] **Step 1: Add visible coach/player conflict copy**

When the API returns the role-conflict 409, show: `This person cannot be both a coach and a player in the same tournament. Update the coach or player details before submitting again.` Keep the form values intact for correction.

- [ ] **Step 2: Make saved-team coach fields visible and editable**

Ensure a selected saved team with a coach displays the coach name, email, phone, Discord, and Riot ID in the existing separate coach section. Do not add the coach to the numbered player roster.

- [ ] **Step 3: Run frontend checks**

Run from `frontend`:

```bash
npm run lint
npm run build
```

Expected: both commands complete successfully.

---

### Task 6: Update codemaps and verify migration safety

**Files:**
- Modify: `backend/prisma/codemap.md`
- Modify: `backend/src/modules/tournaments/codemap.md`
- Modify: `frontend/components/admin/codemap.md`
- Modify: `frontend/app/admin/codemap.md`
- Test/verify: migration status, schema validation, backend tests, frontend checks

- [ ] **Step 1: Document the new data flow**

Record that saved teams may contain `COACH` members with nullable phone data, saved coaches hydrate registration coach drafts, and same-tournament role conflicts are enforced transactionally.

- [ ] **Step 2: Run migration and schema verification**

Run from `backend`:

```bash
npx prisma validate
npm run prisma:migrations:check-pending
npm run prisma:security:verify
```

Expected: the additive migration is valid and no security verification regressions appear.

- [ ] **Step 3: Run the final test matrix**

Run:

```bash
cd backend
npm test
cd ../frontend
npm run lint
npm run build
```

Record failures with their exact output; do not claim completion if any command fails.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git status --short
git diff --check
git diff -- docs/superpowers/specs/2026-08-19-saved-team-coach-roles-design.md docs/superpowers/plans/2026-08-19-saved-team-coach-roles.md backend/prisma backend/src/modules/teams backend/src/modules/tournaments frontend/components frontend/lib
```

Confirm only the approved coach-role scope changed and no secrets or live-data exports were added.
